# 游戏领域架构

本文定义作品资料、作品关系、目录和归档版本的领域边界。D1 的当前字段、索引和 trigger 以 `migrations/0001_init_archive_schema.sql` 为准；本文不复制完整 SQL。

归档对象与文件完整性见[去重存储架构](./archive-storage.md)，认证和 ownership 规则见[认证与权限基线](./authentication-authorization.md)。

## 1. 核心模型

```text
Work
  作品身份与公开资料
  -> titles / creators / characters / tags / media / links
  -> work relations / translation relations / catalogs
  -> engagement stats / user play-favorite entries / comments
  -> ArchiveVersion 0..n

ArchiveVersion
  一份不可变文件快照
  -> manifest
  -> blob/core pack references
```

模型只有 Work 和 ArchiveVersion 两层。系列、发行层或翻译层不作为额外主实体；它们由 Work 之间的普通关系、翻译关系和目录表达。

### Work

Work 回答“这是什么作品”。它拥有：

- 原名、中文名、别名和简介；
- 用户自定义标题与正文的“更多信息”；
- 语言、原始发布日期、引擎、原创声明和翻译声明；
- 封面、浏览图和外部链接；
- 作者/制作人员、登场角色和标签；
- 普通作品关系、翻译关系、目录成员和共同上传者；
- `processing | published | hidden | deleted` 状态；`processing` 只表示服务器正在处理上传，不是用户保存的作品草稿。

`works.id` 是作品唯一身份。原名和中文名只用于展示与搜索，可以重复；公开路由使用永久不变的数值 ID。

所有保存入口使用同一日期解析器，接受真实有效的 `YYYY`、`YYYY-MM`、`YYYY-MM-DD`，精度由输入推导。上传者必须填写；管理员可以清空为 `null + unknown`，不能单独修改精度。

### ArchiveVersion

ArchiveVersion 回答“本站保存了哪份文件”。它直接归属于一个 Work，并记录：

- 来源；
- manifest SHA-256、文件策略、打包器和来源类型；
- 源文件、排除、纳入、blob、core pack、Web Play 和成本统计；
- 上传者、published/current、deleted/purged 生命周期。

发布后的 manifest 与对象引用不原地修改。文件发生变化时创建新的 ArchiveVersion，再显式切换 current。

## 2. 关系与资料对象

### 标题与上传者

- `work_titles` 保存可搜索别名；原名与中文名仍在 Work 稳定字段中。
- `work_uploaders` 表示可以对该 Work 执行 own-scope 维护的用户，不等同于 ArchiveVersion 的单次 `uploader_id`。创建作品时登记上传者；此后仅管理员可增删维护者。维护者须有上传权限，在“我的上传”、新版本上传及归档 own-scope 操作中与原上传者相同。
- 创建新 Work 的上传者在 commit 中同时成为共同上传者；复用 Work 时必须经过 ownership 或 any-scope 授权。

### 普通作品关系

`work_relations` 表示 adaptation、prequel/sequel、same setting、alternative、character、collaboration、version/main version 和 collection/in collection 等关系。

- 关系不能指向自身。
- 有明确反向语义的关系由服务层创建一条系统反向记录；反向记录只能独立排序，不能脱离正向记录改语义。
- 同一逻辑关系只能存在一次；数据库索引与 `app/.server/db/relations.ts` 共同防止正反重复。
- collaboration 没有自动反向语义时按显式记录处理。
- `created_by_user_id` 记录创建者；公共入口保留添加，已有关系只允许管理员修改和删除。

关系类型与反向映射的唯一实现位于 `app/.server/db/relations.ts` 和 `lib/labels.ts`。

### 翻译关系

翻译关系把多个独立 Work 组织为原作与译本，不把译文压进同一 Work：

- 关联双方语言必须不同。
- 一个关系组最多有一个 original，其余成员是 translation。
- 同一 Work 在整个关系组中的角色必须一致。
- 双方仍保持独立资料、归档版本、上传者和公开状态。
- 创建、排序和删除通过 translation relation 服务执行，不能直接操作反向记录。

语言差异、唯一 original 和角色一致性同时由服务层和 D1 trigger 保护。

### 目录

作品页选择器与“我的目录”在 SQL 中先按 owner 和目录状态过滤，再搜索、计数和分页；选择器支持搜索与翻页，不从全站截取后筛选。

- Catalog 是用户拥有的有序 Work 集合，不是系列实体或系统分类法。
- `catalog_items` 保存默认值为 `0` 的非负整数排序值和可选备注，同一 Work 在一个目录中只能出现一次；目录先按排序值升序、再按 `work_id` 降序排列。
- own-scope 操作由 `owner_user_id` 决定；管理员 any-scope 仍经过目录服务。
- 公开页面只显示 published 目录中的可公开浏览作品（`public_works`）。

### 互动与评论

- `work_engagement_stats` 保存近似浏览数；`user_work_entries` 保存登录用户最近游玩时间和收藏时间。下载与在线游玩在用户记录中统一为一次游玩。
- `comments` 必须且只能指向作品、作者、角色三者之一；公开查询要求目标为 published Work、公开作者或角色。评论使用主楼加同主楼平铺回复：回复回复仍绑定原主楼，`reply_to_comment_id` 只用于展示回复对象，不形成第三层层级。
- 主评论对外展示条目内楼号，不展示数据库 ID。楼号按创建时间、ID 正序计算，隐藏和删除的主评论仍占楼号；楼中楼不占主楼号。角色、作者条目的主评论按创建时间正序展示，游戏（含游玩页）按创建时间倒序展示，同一时刻以 ID 保持稳定顺序；游标方向与排序一致。
- 评论正文是纯文本和角色脸图表情；评论可编辑、软删除、隐藏和点赞。删除主楼会让整楼退出公开查询，作者自己的记录仍可见。
- 作品、作者、角色和游玩页的短评论楼中楼默认随主楼返回并按创建时间正序展示前 5 条；超过 5 条显示“查看全部 N 条回复”。展开后在楼内每页展示 10 条，支持上一页、下一页和收起；收起恢复前 5 条，不影响主楼分页。楼内分页数量包含删除占位；作品评论总数和公开个人页通过 `public_comments` 只计可读正文，要求目标、主楼、当前评论公开且两位作者均未被禁用（注销用户历史内容可见）；新增回复后自动展开并定位其实际所在页，加载失败保留当前内容并允许重试。
- 脸图表情采用不可变格子引用，个人库与默认清单分别管理；下架素材显示占位，取消收藏和角色解绑不影响历史引用。详见[表情库契约](./face-emoji-library.md)。评分及评分快照不属于当前模型。

### 作者、角色与标签

- Creator 表示作者或制作人员身份，保存唯一当前头像；`creator_aliases` 保存可搜索的历史署名和其他别名，`work_staff` 保存其在具体 Work 中的职责与本作署名。作者关联始终使用 Creator ID，作品页面显示本作署名，作者列表与作者详情展示头像。译者同样关联 Creator，以 `work_staff.role_key = "translator"` 保存本作署名并进入人物作品索引。默认制作职务为作者、策划、程序、剧本、美术、音乐和其他，仅收录直接参与本作创作的人；通用素材提供者不自动列入制作人员。
- 公开作者列表使用桌面两列、窄屏单列的轻量名片，展示头像、名称、别名、可选简介与去重后的公开参与作品数，不展示关联作品名称、封面或链接。未设置头像时沿用作者头像占位规则。仅包含至少参与一部 `public_works` 中可公开浏览作品的人物；名称与别名均可搜索，命中别名优先展示。默认按名称排序，也可按公开作品数降序排列，每页 30 位，总数使用相同公开与搜索条件独立统计。
- Character 表示角色身份，保存规范日语名和中文主名；`character_aliases` 保存可搜索的日语、中文别名及来源。
- `work_characters` 的每一行表示一次角色登场，保存该作品选用的中文展示名、头像、剧透级别、顺序和备注；同一 Character 可在一个 Work 中以不同形态重复登场，筛选仍使用 Character ID，不使用展示名反查身份。
- Tag 是规范化分类；`work_tags.source` 仅保存关联的建立来源，不限制已有资料编辑权。提交完整标签集合时删除遗漏项，保留未变关系的来源，新增关系记录当前入口。
- Creator 以 ID 区分身份，规范名和别名按规范化后的名称唯一，同一名称不能归属不同人物；输入已收录名称直接复用人物。Character original name、Character alias 和 Tag name 的唯一性及大小写规则以 migration 为准；不同角色可以共享中文译名。
- 上传表单提交已有角色 ID 和本作品展示名；修改已有角色的中文展示名时，未收录的名称在作品提交事务中添加为该 ID 的中文别名，不改动角色主名或身份。新建角色时同时提交日语名和中文名，由服务端在游戏提交事务中复用角色、新增别名或创建角色。

### 媒体与外链

- `media_assets` 按 Blob 内容唯一保存文件资料；`work_media_assets.role = cover | preview` 是作品图片用途的唯一来源。每部作品至多一张封面，创建和发布要求明确指定一张；同图可用于不同作品的不同角色。所有缩略图读取 cover，画廊将封面排第一并标注“封面”，其他图片标注“预览图”。作者头像直接引用单个 active blob。
- 合并保留目标封面，来源封面转为预览图；按内容去重，保留目标顺序并追加来源图片。缺少目标封面时拒绝合并。
- 媒体 Blob 必须 active。上传及指定作品／目录图片时只做轻量检查：识别实际文件头、读取尺寸并限制容量（作品／目录最多 20 MiB、最长边 32768、最多一亿像素），不解码像素、不计算图片块 CRC、不扫描压缩数据、不要求结束标记位于文件末尾。保留原素材的尾随数据和辅助色彩块，不据此拒绝图片；这不是文件完整性或可解码性保证。允许 PNG、JPEG、WebP、GIF，以及已有素材使用的未压缩 BMP；不接受直接 SVG、HTML 或无法识别的文件。论坛继续仅允许前四种且最多 2 MiB，头像继续限制 PNG、192×192、512 KiB。作品及通用 Blob 图片读取在权限和状态检查后，只用最多 64 字节文件头确定栅格图片 MIME，保留 `nosniff` 并流式返回原始字节，不信任历史 MIME，也不整张缓冲或重复解析元数据。
- 公开作品图片要求 `public_works` 引用；隐藏作品编辑使用 `/api/works/{workId}/media/{sha256}`，同时验证维护者／私有读取权限和图片所属作品，返回 `private, no-store`。
- `work_external_links` 保存作品上下文中的官方、wiki、来源、视频、下载页或其他链接。作品来源是完整的多条 `source` 列表，两种分发方式均可编辑；明确提交空列表才清空。ArchiveVersion 的 `source_url` 只描述该份文件来源；唯一 `download_page` 只表达外部分发。切换分发方式不删除作品来源。
- URL 校验集中在服务端安全 URL helper，不信任表单字符串。

## 3. 数据所有权

| 数据 | 所有者 | 修改方式 |
| --- | --- | --- |
| 作品身份和公开资料 | Work | Work 服务与管理/own-scope API |
| 别名、作者、角色、标签、媒体、外链 | Work | Work 更新事务同步维护 |
| 普通与翻译关系 | 独立关系记录 | 关系服务按创建者或 any-scope 管理 |
| 目录及成员顺序 | Catalog owner | 目录服务 |
| 浏览、游玩与收藏 | 当前用户及其目标 Work | 社区服务；公开查询检查作品状态 |
| 评论与点赞 | 当前用户及其目标 Work、Creator 或 Character | 社区服务；公开查询再次检查目标、主楼与评论用户状态 |
| 角色脸图表情 | 用户管理个人库、管理员管理默认清单 | 社区服务与 blob 生命周期 |
| 文件与来源 | ArchiveVersion | 归档服务；文件变化创建新版本 |
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

external submission
  -> 创建并直接发布 Work
  -> 绑定当前上传者
  -> 写入封面、浏览图和唯一 `download_page` 外链

target.mode=update
  -> 验证目标 Work 与 ownership
  -> 按提交规则合并允许更新的资料
  -> 创建新的 ArchiveVersion
```

已有作品统一从 `/me/uploads/[workId]` 维护，并复用 `/upload` 的上传工作台。2k 系引擎显示“游戏文件”：现有当前归档先作为已就绪信息展示，移除后才显示上传选择器；非 2k 系引擎显示外部下载。只有表单当前仍有游戏文件或外部下载时才锁定另一类引擎，非当前历史 ArchiveVersion 不参与切换判定。

没有选择新游戏文件时，保存只更新 Work 资料并保留当前 ArchiveVersion；选择新游戏文件时，同一次保存通过 `target.mode=update` 更新资料并创建新的 ArchiveVersion。转为外链时，同一 D1 批次取消当前归档并写入外部下载；转回本站归档时，archive commit 在同一批次删除旧外链并设置新当前版本。历史 ArchiveVersion 保留为不可变快照，但不会自动恢复为外链作品的当前版本。

Work 更新与 ArchiveVersion 创建必须在同一 commit 边界完成。不能先发布资料、后补文件引用，也不能因为同名作品自动合并；客户端必须提交明确 `workId`。

commit 的 schema 与校验由 `lib/archive/manifest.ts` 和 `app/.server/db/archive-commit.ts` 发布。前端字段不是领域契约的独立副本。

## 5. 生命周期

### Work

- `processing`：归档提交中的临时状态，不进入公开发现；超过 24 小时没有更新会由定时维护清理。
- `published`：表达公开意图；只有具备匹配引擎的唯一可用下载来源才进入公开列表。下载或游玩仍要求目标 ArchiveVersion 同时 published。
- `hidden`：保留资料但不公开；恢复来源不会将其自动发布。
- `deleted`：仅在管理后台可见和调整，不删除资料或归档文件。维护者经警告弹窗确认后可以删除作品，但删除后无法查看或恢复；只有管理员可恢复。

### ArchiveVersion

- 每个 Work 最多一个 `published + is_current` ArchiveVersion。
- current 必须 published 且未 purged，数据库 trigger 拒绝其他组合。
- 切换 current 由归档服务在同一事务中清除旧值并设置新值。
- 删除 current 后，服务层选择同一 Work 中合法的 published 替代版本；没有替代项时保持无 current。
- deleted 可以在 purge 前 restore；purged 版本不能恢复文件引用。

`public_works` 视图统一派生公开可用性：published 加匹配引擎的唯一当前归档或下载页。最后一个可用归档被移走后保留发布意图，作品退出全部公开浏览、计数及媒体授权；后台显示缺少可用下载来源。恢复合法来源后按原状态决定是否公开。创建与显式发布必须验证来源，已有缺源作品仍可维护资料。已发布历史 ArchiveVersion 的下载／游玩继续按版本服务的完整权限判定，不要求它必须 current。

## 6. 查询边界

### 公开读取

- `/games`、详情、搜索、辅助索引、目录成员及计数、人物／角色作品、关联卡片、评论目标和媒体引用授权统一读取 `public_works`，过滤发生在分页之前。
- `/games/{id}` 只展示可公开浏览作品的公开关系和当前已发布归档。
- 作者和标签索引只显示有关联 `public_works` 的条目；目录自身要求 published，目录成员要求 `public_works`。角色身份独立公开，没有公开作品也可搜索或打开详情；分类浏览按[角色分类](./character-index.md)中的归属规则展示。
- 普通关系的另一端如果不公开，不泄露标题、ID 或关系备注。
- 下载和在线游玩必须再次检查 Work 与 ArchiveVersion，而不是依赖详情页曾经可见。

### 管理读取

- private read permission 决定是否进入管理列表。
- 作品与归档 own-scope 按 `work_uploaders` 判断；已删除作品不向维护者开放。目录 own-scope 按 owner 判断。
- 删除、restore、current 和 any-scope 操作仍由领域服务检查目标状态。

查询实现集中在 `app/.server/db/game-library.ts`、`creator-library.ts`、`taxonomy-library.ts`、`relations.ts` 和 `catalogs.ts`。

## 7. 搜索

`/search` 由 [搜索页 loader](../app/search/page.tsx)按 `scope` 选择作品、讨论版、作者、角色、标签或目录，默认范围为作品。各范围独立查询和分页，不把其他实体混进作品结果。

作品关键词只匹配 Work 原名、中文名和可搜索别名，结果身份始终是 Work ID。作者、角色、标签和目录使用各自的公开查询；讨论版使用[论坛全文索引](./forum-discussion-design.md#8-搜索设计)。

小规模数据直接查询规范化表。只有真实数据量证明查询不可接受时，才引入由这些表生成的物化搜索索引；不得让搜索索引成为可独立编辑的第二份资料。

## 8. 扩展资料

采用三层模型：

1. 经常查询、筛选或校验的字段进入明确列。
2. 多值、可关联或需要完整性的资料进入规范化关系表。
3. 低频、只展示、不参与权限和查询的资料可以进入经过 JSON schema 约束的 `extra_json`。

“更多信息”使用 `works.extra_json.moreInfo` 保存有序的 `{ title: string, body: string }[]`，结构与长度由 `lib/work-more-info.ts` 统一校验；未填写时为空列表。它属于可编辑的 Work 资料，不属于 ArchiveVersion 或不可变 manifest，也不进入搜索索引。

所有资料保存入口以完整列表替换 `moreInfo`，空列表表示清空；其他 `extra_json` 键保持原值。条目没有独立身份、关联或修订历史，权限沿用作品资料维护权限。

没有管理员动态建字段的真实需求前，不引入 EAV、自定义字段系统或通用 entity/attribute 抽象。

## 9. 身份纠错与合并

合并仅在后台执行。人物合并保留目标资料，转移别名、署名和评论；作品合并保留目标资料与下载入口，转移归档、维护者、评论、收藏、目录成员及关联，将来源作品设为 deleted。同文件归档保留目标归档 ID；冲突的署名、目录备注或翻译关系拒绝合并，事务全部撤销。不同语言或引擎的作品不合并。浏览器存档仍按原 Work ID 保存，不随后台合并自动转移。

本站只收录有下载来源的作品，不引入仅资料条目。人物名称唯一，本作署名单独保存；作者表单完整保留多位作者。

同文件归档仅在发布状态和清理阶段一致时自动去重，否则报告冲突的归档 ID，要求管理员先统一状态。最终事务再次限制删除条件，状态变化时整次合并回滚，不自动恢复归档或切换当前版本。合并游玩记录时，两边均未游玩仍保留 NULL；只有一边有时间则保留该值，两边都有时间则取较晚值，不把收藏计为游玩。

作品合并要求来源和目标的翻译声明、原创声明分别一致。冲突时提示先统一声明；最终事务在转移任何关联前再次检查，冲突则整批回滚，不自动修改目标声明。

## 10. 不变量

- Work ID 是作品唯一身份；标题不是唯一键。
- ArchiveVersion 直接属于 Work，不存在中间 Series 或 Release 层。
- 文件路径只属于 manifest；D1 只保存对象引用和统计。
- 同一 Work 最多一个合法 current ArchiveVersion。
- 普通关系不能自关联或逻辑重复。
- 翻译关系语言不同、最多一个 original，且成员角色一致。
- Catalog ownership、关系创建者和 Work uploader 是不同的 own-scope 来源。
- public 查询必须从完整 published 链开始，不能先读私有对象再在 UI 隐藏。
- 废弃领域模型直接从 migration、代码、文档和 seed 中删除，不保留兼容层。

## 11. 验证

测试分层遵循根目录 `AGENTS.md`。敏捷阶段按改动选择最小验收：

- 类型、静态架构或权限规则变化运行 `npm run check`
- 数据约束或稳定领域契约变化运行 `npm test`
- 模型调整时用 `rg` 扫描废弃表、字段、路由和类型残留，结果仅作为当次变更证据
- 对照 `migrations/0001_init_archive_schema.sql` 检查本文不变量，而不是复制 SQL

预生产或发布前统一运行 `npm run verify:preprod`；流程测试和生产构建不作为每次领域编辑的固定门槛。

涉及已有数据或外部 API 契约时必须单独设计迁移；当前无生产数据时直接推进唯一当前模型。
