# 游戏领域架构

本文定义作品资料、作品关系、目录和归档版本的领域边界。D1 的当前字段、索引和 trigger 以 `migrations/0001_init_archive_schema.sql` 为准；本文不复制完整 SQL。

归档对象与文件完整性见[去重存储架构](./rpg-maker-2000-2003-deduplicated-storage-plan.md)，认证和 ownership 规则见[认证与权限基线](./authentication-authorization-baseline-plan.md)。

## 1. 核心模型

```text
Work
  作品身份与公开资料
  -> titles / creators / characters / tags / media / links
  -> work relations / translation relations / catalogs
  -> ArchiveVersion 1..n

ArchiveVersion
  一份不可变文件快照
  -> manifest
  -> blob/core pack references
```

模型只有 Work 和 ArchiveVersion 两层。系列、发行层或翻译层不作为额外主实体；它们由 Work 之间的普通关系、翻译关系和目录表达。

### Work

Work 回答“这是什么作品”。它拥有：

- 原名、中文名、排序名、别名和简介；
- 语言、原始发布日期、引擎、原创标记和 Maniacs Patch 标记；
- 图标、缩略图、浏览图和外部链接；
- 作者/制作人员、登场角色和标签；
- 普通作品关系、翻译关系、目录成员和共同上传者；
- `draft | published | hidden | deleted` 状态。

`works.id` 是作品唯一身份。原名和中文名只用于展示与搜索，可以重复；公开路由使用永久不变的数值 ID。

### ArchiveVersion

ArchiveVersion 回答“本站保存了哪份文件”。它直接归属于一个 Work，并记录：

- 归档名称、来源、可执行入口和授权说明；
- 校对与修图状态；
- manifest SHA-256、文件策略、打包器和来源类型；
- 源文件、排除、纳入、blob、core pack、Web Play 和成本统计；
- 上传者、published/current、deleted/purged 生命周期。

发布后的 manifest 与对象引用不原地修改。文件发生变化时创建新的 ArchiveVersion，再显式切换 current。

## 2. 关系与资料对象

### 标题与上传者

- `work_titles` 保存可搜索别名；原名与中文名仍在 Work 稳定字段中。
- `work_uploaders` 表示可以对该 Work 执行 own-scope 维护的用户，不等同于 ArchiveVersion 的单次 `uploader_id`。
- 创建新 Work 的上传者在 commit 中同时成为共同上传者；复用 Work 时必须经过 ownership 或 any-scope 授权。

### 普通作品关系

`work_relations` 表示 adaptation、prequel/sequel、same setting、alternative、character、collaboration、version/main version 和 collection/in collection 等关系。

- 关系不能指向自身。
- 有明确反向语义的关系由服务层创建一条系统反向记录；反向记录只能独立排序，不能脱离正向记录改语义。
- 同一逻辑关系只能存在一次；数据库索引与 `lib/server/db/relations.ts` 共同防止正反重复。
- collaboration 没有自动反向语义时按显式记录处理。
- `created_by_user_id` 决定 own-scope 更新和删除权限。

关系类型与反向映射的唯一实现位于 `lib/server/db/relations.ts` 和 `lib/labels.ts`。

### 翻译关系

翻译关系把多个独立 Work 组织为原作与译本，不把译文压进同一 Work：

- 关联双方语言必须不同。
- 一个关系组最多有一个 original，其余成员是 translation。
- 同一 Work 在整个关系组中的角色必须一致。
- 双方仍保持独立资料、归档版本、上传者和公开状态。
- 创建、排序和删除通过 translation relation 服务执行，不能直接操作反向记录。

语言差异、唯一 original 和角色一致性同时由服务层和 D1 trigger 保护。

### 目录

- Catalog 是用户拥有的有序 Work 集合，不是系列实体或系统分类法。
- `catalog_items` 保存成员顺序和可选备注，同一 Work 在一个目录中只能出现一次。
- own-scope 操作由 `owner_user_id` 决定；管理员 any-scope 仍经过目录服务。
- 公开页面只显示 published 目录中的 published Work。

### 作者、角色与标签

- Creator 表示作者或制作人员身份；`work_staff` 保存其在具体 Work 中的职责。
- Character 表示角色资料；`work_characters` 保存出演角色、剧透级别、顺序和备注。
- Tag 是规范化分类；`work_tags` 保存来源。
- Creator name、Character primary name 和 Tag name 的唯一性及大小写规则以 migration 为准。
- 上传表单可以提交文本候选，最终映射与合并由服务端执行。

### 媒体与外链

- Work 的 icon/thumbnail 是直接 blob 引用；浏览图等多媒体通过 `media_assets` 与 `work_media_assets` 关联。
- 媒体 blob 必须处于 active 状态，公开读取还要求存在 published Work 引用。
- `work_external_links` 只保存作品上下文中的官方、wiki、来源、视频、下载页或其他链接。
- URL 校验集中在服务端安全 URL helper，不信任表单字符串。

## 3. 数据所有权

| 数据 | 所有者 | 修改方式 |
| --- | --- | --- |
| 作品身份和公开资料 | Work | Work 服务与管理/own-scope API |
| 别名、作者、角色、标签、媒体、外链 | Work | Work 更新事务同步维护 |
| 普通与翻译关系 | 独立关系记录 | 关系服务按创建者或 any-scope 管理 |
| 目录及成员顺序 | Catalog owner | 目录服务 |
| 文件、来源、校对/修图 | ArchiveVersion | 归档服务；文件变化创建新版本 |
| 文件路径与 storage mapping | Manifest | commit 时冻结，不在 D1 逐文件编辑 |
| blob/core pack 生命周期 | 存储层 | 引用检查与 GC |

页面和 route 只做身份与 permission guard；上述服务必须再次校验 ownership、状态与引用完整性。

## 4. 导入与更新

浏览器导入提交 Work 元数据、目标模式和 ArchiveVersion 元数据：

```text
target.mode=create
  -> 创建 Work
  -> 绑定当前上传者
  -> 创建 ArchiveVersion

target.mode=update
  -> 验证目标 Work 与 ownership
  -> 按提交规则合并允许更新的资料
  -> 创建新的 ArchiveVersion
```

Work 更新与 ArchiveVersion 创建必须在同一 commit 边界完成。不能先发布资料、后补文件引用，也不能因为同名作品自动合并；客户端必须提交明确 `workId`。

commit 的 schema 与校验由 `lib/archive/manifest.ts` 和 `lib/server/db/archive-commit.ts` 发布。前端字段不是领域契约的独立副本。

## 5. 生命周期

### Work

- `draft`：管理和有权用户可见，不进入公开发现。
- `published`：可以进入公开列表；下载或游玩仍要求目标 ArchiveVersion 同时 published。
- `hidden`：保留资料和引用，但不公开。
- `deleted`：从普通管理和公共入口退出，等待明确维护操作。

### ArchiveVersion

- 每个 Work 最多一个 `published + is_current` ArchiveVersion。
- current 必须 published 且未 purged，数据库 trigger 拒绝其他组合。
- 切换 current 由归档服务在同一事务中清除旧值并设置新值。
- 删除 current 后，服务层选择同一 Work 中合法的 published 替代版本；没有替代项时保持无 current。
- deleted 可以在 purge 前 restore；purged 版本不能恢复文件引用。

公开下载、Web Play 和媒体访问都检查完整 published 引用链，不把“知道 ID”当作公开授权。

## 6. 查询边界

### 公开读取

- `/games`、搜索和辅助索引只返回 published Work。
- `/games/{id}` 可以展示 published Work 的公开关系和 published ArchiveVersion。
- 作者、角色、标签和目录条目只有存在公开关联时才进入公共结果。
- 普通关系的另一端如果不公开，不泄露标题、ID 或关系备注。
- 下载和在线游玩必须再次检查 Work 与 ArchiveVersion，而不是依赖详情页曾经可见。

### 管理读取

- private read permission 决定是否进入管理列表。
- own-scope 只返回当前用户作为 Work uploader、ArchiveVersion uploader、关系创建者或目录 owner 的对象。
- 删除、restore、current 和 any-scope 操作仍由领域服务检查目标状态。

查询实现集中在 `lib/server/db/game-library.ts`、`creator-library.ts`、`taxonomy-library.ts`、`relations.ts` 和 `catalogs.ts`。

## 7. 搜索

当前搜索源包括 Work 原名、中文名、排序名、别名，以及公开关联的作者、角色和标签。结果身份始终是 Work ID。

小规模数据直接查询规范化表。只有真实数据量证明查询不可接受时，才引入由这些表生成的物化搜索索引；不得让搜索索引成为可独立编辑的第二份资料。

## 8. 扩展资料

采用三层模型：

1. 经常查询、筛选或校验的字段进入明确列。
2. 多值、可关联或需要完整性的资料进入规范化关系表。
3. 低频、只展示、不参与权限和查询的资料可以进入经过 JSON schema 约束的 `extra_json`。

没有管理员动态建字段的真实需求前，不引入 EAV、自定义字段系统或通用 entity/attribute 抽象。

## 9. 不变量

- Work ID 是作品唯一身份；标题不是唯一键。
- ArchiveVersion 直接属于 Work，不存在中间 Series 或 Release 层。
- 文件路径只属于 manifest；D1 只保存对象引用和统计。
- 同一 Work 最多一个合法 current ArchiveVersion。
- 普通关系不能自关联或逻辑重复。
- 翻译关系语言不同、最多一个 original，且成员角色一致。
- Catalog ownership、关系创建者和 Work uploader 是不同的 own-scope 来源。
- public 查询必须从完整 published 链开始，不能先读私有对象再在 UI 隐藏。
- 废弃领域模型直接从 migration、代码、文档和 seed 中删除，不保留兼容层。

## 10. 验证

领域模型变更至少执行：

- `npm run check`
- `npm run build`
- `npm run check:domain`
- 本地 D1 reset/seed 后串行运行关系、翻译、目录和 current 状态检查
- `rg` 扫描已废弃表、字段、路由和类型残留
- 对照 `migrations/0001_init_archive_schema.sql` 检查本文不变量，而不是复制 SQL

涉及已有数据或外部 API 契约时必须单独设计迁移；当前无生产数据时直接推进唯一当前模型。
