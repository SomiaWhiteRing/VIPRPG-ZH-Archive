# 游戏领域架构设计

本文档单独描述 VIPRPG-ZH-Archive 的“游戏资料”和“版本归档”领域模型。它不重复说明 R2 去重存储、Cloudflare 部署、用户体系和站内信实现；这些内容仍以主架构文档和 OpenNext 开发路径为准。

相关文档：

- [RPG Maker 2000/2003 去重存储库架构计划](./rpg-maker-2000-2003-deduplicated-storage-plan.md)
- [OpenNext 应用与 Cloudflare 基础设施开发路径](./opennext-cloudflare-development-path.md)
- [认证与权限管理系统统一基线](./authentication-authorization-baseline-plan.md)

本文档定义当前唯一的游戏领域模型。

## 1. 设计目标

当前游戏资料模型需要同时保持玩家可理解的资料边界和可验证的归档边界：

1. `Work` 是作品身份、公开资料和权限归属的唯一业务对象。
2. `ArchiveVersion` 是直接挂在 Work 下的不可变文件快照；同一 Work 可以保留原版、多个译本和并行修订版本。
3. 语言、原创标记、引擎信息、作者、角色、标签、普通关联和翻译关联都必须有明确的数据归属。
4. 文件路径只属于 manifest；D1 只保存可查询的资料、统计和对象引用，避免把文件索引复制成另一套事实。

当前模型只有两层领域对象：

```text
Work
  作品本身。它是玩家、搜索、资料页和上传权限看到的主要对象。

ArchiveVersion
  直接归属于 Work 的一份可下载文件快照，记录语言、校对、修图、来源和清单统计。
```

`Work` 回答“这是什么游戏”，`ArchiveVersion` 回答“本站保存并发布了哪一份文件”。

## 2. 核心对象解释

### 2.1 Work

`Work` 表示作品本身，是公开游戏资料页面的核心。它包含原名、中文名、别名、简介、原作日期、引擎族、引擎备注、语言、是否本站原创、图像引用和发布状态。

Work 还拥有作者/制作人员、角色、标签、普通关联、翻译关联、目录成员和外部链接。作品身份使用全局唯一 `slug` 和原名约束，关联表使用 `work_id` 外键。

Work 不直接保存文件清单。文件清单和每次归档的来源、校对/修图状态属于 ArchiveVersion。

### 2.2 ArchiveVersion

`ArchiveVersion` 表示本站实际保存的一份文件快照，直接引用一个 Work。一个 Work 可以有多个已发布快照，例如原版、中文译本、英语译本或不同的平行整理方案；每个 Work 最多有一个 published current 快照。

ArchiveVersion 记录：

- 归档名称、来源名称、来源网址、可执行入口和授权备注；
- 是否校对、是否修图；
- manifest SHA-256、文件策略版本、打包器版本和来源类型；
- 总文件数、总大小、排除统计、core pack 统计和预计 R2 Get；
- `is_current`、发布/回收站状态以及上传者。

发布后不原地修改 manifest 或文件引用。需要修正时创建新的 ArchiveVersion，再由管理端切换 current；删除 current 后由服务层选择同一 Work 的最新 published 快照接任。

### 2.5 Blob / CorePack / Manifest

这三者仍沿用去重存储架构：

- `Blob`：按 SHA-256 内容寻址的独立文件对象，主要用于可复用静态资源和运行时文件。
- `CorePack`：一个游戏发布快照独有的小文件集合，通常包含地图、数据库、ini 等核心文件。
- `Manifest`：ArchiveVersion 的完整文件清单，记录路径、文件哈希、大小、来源 blob 或 core pack entry。

重要边界：

- 静态资源索引不应该包含文件名。
- 文件名和相对路径只存在于 R2 manifest 中；D1 不再镜像完整文件行。
- 同一个 blob 可以在不同 ArchiveVersion 中以不同文件名出现。
- R2 不保存完整游戏 ZIP。

## 3. 关系图

```text
works
  1 ── n archive_versions
  1 ── n work_titles
  1 ── n work_characters n ── 1 characters
  1 ── n work_staff n ── 1 creators
  1 ── n work_tags n ── 1 tags
  1 ── n work_relations n ── 1 works
  1 ── n translation_relations n ── 1 works
  1 ── n work_media_assets n ── 1 media_assets
  1 ── n work_external_links

archive_versions
  1 ── n archive_version_blob_refs n ── 1 blobs
  1 ── n archive_version_core_pack_refs n ── 1 core_packs

catalogs
  1 ── n catalog_items n ── 1 works
```

## 4. D1 表结构

下面是当前游戏领域表，后续实现只围绕这些表开发。

### 4.1 作品和归属

```sql
CREATE TABLE works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  original_title TEXT NOT NULL UNIQUE,
  chinese_title TEXT,
  sort_title TEXT,
  description TEXT,
  is_original INTEGER NOT NULL DEFAULT 0 CHECK (is_original IN (0, 1)),
  language TEXT NOT NULL DEFAULT 'zh-CN',
  original_release_date TEXT,
  original_release_precision TEXT NOT NULL CHECK (
    original_release_precision IN ('year', 'month', 'day', 'unknown')
  ) DEFAULT 'unknown',
  engine_family TEXT NOT NULL CHECK (
    engine_family IN ('rpg_maker_2000', 'rpg_maker_2003', 'mixed', 'unknown', 'other')
  ) DEFAULT 'unknown',
  engine_detail TEXT,
  uses_maniacs_patch INTEGER NOT NULL DEFAULT 0,
  icon_blob_sha256 TEXT REFERENCES blobs(sha256),
  thumbnail_blob_sha256 TEXT REFERENCES blobs(sha256),
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'published', 'hidden', 'deleted')
  ) DEFAULT 'draft',
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE INDEX idx_works_status_title
  ON works(status, sort_title, original_title);

CREATE TABLE work_titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  language TEXT,
  title_type TEXT NOT NULL CHECK (
    title_type IN ('alias')
  ),
  is_searchable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (work_id, title, title_type)
);

CREATE INDEX idx_work_titles_title
  ON work_titles(title);

CREATE TABLE work_uploaders (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (work_id, user_id)
);

CREATE INDEX idx_work_uploaders_user
  ON work_uploaders(user_id, work_id);
```

说明：

- `works.original_title` 是作品身份的自然唯一键；数据库外键仍使用 `id` 作为技术主键。
- `works.chinese_title` 是可选中文名；为空时展示层使用原名。
- `works.uses_maniacs_patch` 跟随作品本体，因为 Maniacs Patch 会影响作品运行时假设，而不是某个文件归档快照。
- `works.icon_blob_sha256` 和 `works.thumbnail_blob_sha256` 是 Work 层的单图引用；为空时展示层按引擎使用缺省图。
- `work_titles` 只保存可多值的别名；原名和中文名是 Work 的明确列。
- `work_uploaders` 只记录共同上传者和创建时间，不区分 owner/editor；具体权限仍由统一授权边界和 Work 所有权规则决定。

### 4.2 作品关系

```sql
CREATE TABLE work_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  to_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN (
      'adaptation',
      'prequel',
      'sequel',
      'same_setting',
      'alternative_setting',
      'alternative_version',
      'character',
      'collaboration',
      'version',
      'main_version',
      'collection',
      'in_collection'
    )
  ),
  vice_versa INTEGER NOT NULL DEFAULT 0 CHECK (vice_versa IN (0, 1)),
  relation_order REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (from_work_id, to_work_id, relation_type, vice_versa),
  CHECK (from_work_id <> to_work_id)
);

CREATE INDEX idx_work_relations_from
  ON work_relations(from_work_id, relation_type);

CREATE INDEX idx_work_relations_to
  ON work_relations(to_work_id, relation_type);
```

说明：

- 前作、后作这类关系是有方向的。
- 具有自然反向关系的类型由服务层在同一 D1 batch 中写入正向和反向行；`vice_versa = 1` 的行只允许独立排序或随正向行删除。
- `collaboration` 是单向关系，不自动生成反向行。
- 翻译语义使用 `translation_relations`，因为它还需要校验两端语言和原版/译版角色。

### 4.3 归档快照

```sql
CREATE TABLE archive_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  archive_label TEXT NOT NULL,
  is_proofread INTEGER NOT NULL DEFAULT 0,
  is_image_edited INTEGER NOT NULL DEFAULT 0,
  source_name TEXT,
  source_url TEXT,
  executable_path TEXT,
  rights_notes TEXT,
  manifest_sha256 TEXT NOT NULL,
  file_policy_version TEXT NOT NULL,
  packer_version TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('browser_folder', 'browser_zip', 'preindexed_manifest')
  ),
  source_name TEXT,
  source_file_count INTEGER NOT NULL DEFAULT 0,
  source_size_bytes INTEGER NOT NULL DEFAULT 0,
  excluded_file_count INTEGER NOT NULL DEFAULT 0,
  excluded_size_bytes INTEGER NOT NULL DEFAULT 0,
  total_files INTEGER NOT NULL DEFAULT 0,
  total_size_bytes INTEGER NOT NULL DEFAULT 0,
  unique_blob_size_bytes INTEGER NOT NULL DEFAULT 0,
  core_pack_count INTEGER NOT NULL DEFAULT 0,
  core_pack_size_bytes INTEGER NOT NULL DEFAULT 0,
  estimated_r2_get_count INTEGER NOT NULL DEFAULT 0,
  web_play_file_count INTEGER NOT NULL DEFAULT 0,
  web_play_size_bytes INTEGER NOT NULL DEFAULT 0,
  is_current INTEGER NOT NULL DEFAULT 0,
  uploader_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'published', 'hidden', 'deleted')
  ) DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  deleted_at TEXT,
  purged_at TEXT,
  UNIQUE (work_id, manifest_sha256)
);

CREATE INDEX idx_archive_versions_work
  ON archive_versions(work_id, status, is_current, created_at);

CREATE UNIQUE INDEX idx_archive_versions_one_current
  ON archive_versions(work_id)
  WHERE is_current = 1 AND status = 'published';
```

说明：

- `archive_versions` 直接归属于 Work；不存在单独的发布分支或归档分支键。
- `language` 和 `is_original` 是 Work 的资料字段；校对、修图和来源字段描述具体文件快照。
- `manifest_sha256` 在同一 Work 下唯一，避免重复发布相同清单。
- `is_current` 表示该 Work 的默认下载快照；同一 Work 同时只能有一个 published current。
- 发布后的 ArchiveVersion 不原地修改 manifest。修正导入应创建新行，再切换 `is_current`。
- 发布后的 ArchiveVersion 不应原地改 manifest。修正导入应创建新行，再切换 `is_current`。

### 4.4 归档对象引用

```sql
CREATE TABLE archive_version_blob_refs (
  archive_version_id INTEGER NOT NULL REFERENCES archive_versions(id) ON DELETE CASCADE,
  blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  PRIMARY KEY (archive_version_id, blob_sha256)
) WITHOUT ROWID;

CREATE INDEX idx_archive_version_blob_refs_blob
  ON archive_version_blob_refs(blob_sha256);

CREATE TABLE archive_version_core_pack_refs (
  archive_version_id INTEGER NOT NULL REFERENCES archive_versions(id) ON DELETE CASCADE,
  core_pack_id INTEGER NOT NULL REFERENCES core_packs(id),
  PRIMARY KEY (archive_version_id, core_pack_id)
) WITHOUT ROWID;

CREATE INDEX idx_archive_version_core_pack_refs_core_pack
  ON archive_version_core_pack_refs(core_pack_id);
```

说明：

- 文件级路径、CRC32、文件 SHA-256、文件大小、mtime 和 core pack entry 只属于 R2 manifest。
- 引用表只表达 ArchiveVersion 对 blob / core pack 的保活关系，用于 GC、清理预演和对象一致性检查。
- blob 表不记录“它曾经叫什么文件名”，避免静态资源索引膨胀和语义混乱。
- 若同一内容在 A 游戏叫 `Monster.png`，在 B 游戏叫 `Enemy.png`，它们仍应指向同一个 blob。
- `archive_versions.web_play_file_count` 和 `archive_versions.web_play_size_bytes` 是从 manifest 派生的常用统计，避免在线游玩元数据接口每次读取 R2 manifest。
- GC 不能只看归档引用；Work 图标、缩略图和 `media_assets` 引用也必须保活对应 blob。

### 4.5 角色、作者、活动、标签

```sql
CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  primary_name TEXT NOT NULL,
  original_name TEXT,
  description TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE work_characters (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (
    role_key IN ('main', 'supporting', 'cameo', 'mentioned', 'other')
  ) DEFAULT 'supporting',
  spoiler_level INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER,
  notes TEXT,
  PRIMARY KEY (work_id, character_id)
);

CREATE TABLE creators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  original_name TEXT,
  website_url TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE work_staff (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (
    role_key IN ('author', 'scenario', 'graphics', 'music', 'translator', 'editor', 'publisher', 'other')
  ),
  role_label TEXT,
  notes TEXT,
  PRIMARY KEY (work_id, creator_id, role_key)
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  namespace TEXT NOT NULL CHECK (
    namespace IN ('genre', 'theme', 'character', 'technical', 'content', 'other')
  ) DEFAULT 'other',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE work_tags (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('admin', 'uploader', 'imported')) DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (work_id, tag_id)
);

CREATE TABLE catalogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('published', 'deleted')) DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE catalog_items (
  catalog_id INTEGER NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  sort_order REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (catalog_id, work_id)
);
```

说明：

- “主要登场角色”应进入 `characters` + `work_characters`，而不是写成逗号分隔文本。
- 作者和制作人员统一挂在 `Work` 的 `work_staff`；不实现按发布分支拆分的人员层。
- 目录使用 `catalogs` + `catalog_items`，用于人工编排和排序，不改变 Work 或 ArchiveVersion 身份。
- 标签长期应规范化。上传阶段可以先收文本草稿，但发布前应尽量映射到 `tags`。

### 4.6 媒体资产和外部链接

```sql
CREATE TABLE media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  kind TEXT NOT NULL CHECK (
    kind IN ('icon', 'cover', 'preview', 'screenshot', 'banner', 'other')
  ),
  title TEXT,
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE work_media_assets (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  media_asset_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  sort_order INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, media_asset_id)
);

CREATE TABLE work_external_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (
    link_type IN ('official', 'wiki', 'source', 'video', 'download_page', 'other')
  ) DEFAULT 'other',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

```

说明：

- 上传表单中明确选择的图标、缩略图、浏览图作为普通 blob 存入 R2。
- Work 的图标和缩略图是单值字段：`works.icon_blob_sha256`、`works.thumbnail_blob_sha256`。
- Work 的浏览图可以有多张，因此通过 `media_assets.kind = 'preview'` + `work_media_assets` 建立排序关系。
- 游戏目录内的 `screenshots/` 文件夹、根目录下文件名包含 `screenshot` / `screenshots` 的文件，以及根目录 `null.txt`，按导入策略强制排除，不自动作为媒体资产入库。
- 媒体资产统一通过 Work 关联；ArchiveVersion 的文件内容仍只由 manifest 和对象引用表达。
- 外部链接不放进 JSON，便于统一显示、检查失效链接和做来源审计。

## 5. SQLite / D1 下的可扩展元数据策略

SQLite 不是 MongoDB，但这不是坏事。游戏资料库更需要稳定关系、可审计修改、可迁移数据，而不是任意形状的文档。

建议采用四层策略。

### 5.1 第一层：稳定字段

凡是会经常筛选、排序、展示、做权限判断的字段，应当成为明确列。

例子：

- `works.original_title`
- `works.chinese_title`
- `works.language`
- `works.is_original`
- `works.original_release_date`
- `works.uses_maniacs_patch`
- `archive_versions.archive_label`
- `archive_versions.manifest_sha256`
- `archive_versions.estimated_r2_get_count`

这些字段不适合放进 JSON，因为它们会参与查询、索引和管理界面。

### 5.2 第二层：规范化关系表

凡是“一对多”或“多对多”的资料，应建关系表。

例子：

- 主要登场角色：`characters` + `work_characters`
- 作者和制作人员：`creators` + `work_staff`
- 标签：`tags` + `work_tags`
- 普通关联：`work_relations`
- 原版与译版：`translation_relations`
- 人工编排目录：`catalogs` + `catalog_items`

这样做的好处：

- 可以反查“某角色出现在哪些作品”。
- 可以生成按顺序编排的目录作品列表。
- 可以统一标签命名。
- 可以避免同一个作者被写成多个不同字符串。

### 5.3 第三层：低频 display-only JSON

`extra_json` 只用于低频、暂时无法确认是否值得建表的字段。

适合放入 `extra_json`：

- 临时备注。
- 早期导入时保留的原始字段。
- 只展示、不筛选、不排序的补充资料。
- 尚未定型的实验性元数据。

不适合放入 `extra_json`：

- 角色列表。
- 标签。
- 发布日期。
- 语言。
- 下载入口。
- 是否使用 Maniacs Patch。
- 任何需要建立索引或批量统计的字段。

当某个 JSON 字段开始被频繁使用，应通过 migration 把它提升为正式列或关系表。

### 5.4 第四层：后续可选的自定义字段系统

如果将来真的需要管理员自定义字段，可以追加：

```text
custom_field_definitions
custom_field_values
```

但初版不建议直接做 EAV 自定义字段系统。EAV 会让查询、验证、迁移和界面都复杂化。只有当管理者确实需要“无需发版即可新增字段”时，再引入它。

## 6. 上传和导入流程

新的导入流程是“选择或创建 Work，再提交 ArchiveVersion 快照”。

推荐流程：

1. 上传者在浏览器选择文件夹或本地 ZIP。
2. 浏览器执行白名单过滤、SHA-256 计算、core pack 生成和 manifest 草案生成。
3. 上传者选择已有 Work，或创建新的 Work 草稿；新建流程默认引擎为 `rpg_maker_2000`。
4. 上传者填写 ArchiveVersion 的名称、来源、校对/修图状态和授权备注。
6. 前端调用 preflight，询问哪些 blob / core pack 已存在。
7. 前端只上传缺失 blob 和本次 core pack。
8. 前端提交 ArchiveVersion commit。
9. 服务端写入 `archive_versions`、对象引用表、manifest R2 对象和统计信息。
10. 服务端在通过统一授权边界后发布 Work 和 ArchiveVersion。

关键规则：

- 上传、发布和私有内容读取能力只按统一认证授权基线的 permission key 与领域约束判定；游戏领域表不按角色名推导能力。
- 注册账户审核、角色调整和通知由用户体系与站内信处理，不属于游戏领域表；具体规则只见统一认证授权基线。
- 不上传完整游戏 ZIP 到 R2。
- 不让 Worker 解完整游戏包作为主流程。
- 导入阶段不设置固定文件数或大小上限，但必须保存文件数量、归档大小、排除统计和预计 R2 Get。

## 7. 下载流程

公开下载不应该直接使用 Work 的文件字段，而是从 Work 的 published current ArchiveVersion 开始。

流程：

```text
GET /api/archive-versions/{archive_version_id}/download
  -> 校验 Work、ArchiveVersion 全链 published 且快照为 current
  -> 读取 manifest
  -> 从 core pack 和 blob 流式重组 ZIP
  -> 尝试写入 Workers Cache/CDN 边缘缓存
  -> 不写入 R2 完整 ZIP
```

作品页可先选择语言或平行译本，再跳转到目标 ArchiveVersion；管理员需要复现旧快照时，可从归档管理页指定 ArchiveVersion 下载。

## 8. 页面和 API

### 8.1 公开页面

```text
/games
/games/{work_slug}
/characters
/creators
/creators/{creator_slug}
/catalogs
/catalogs/{catalog_slug}
/tags
```

说明：

- 公开 URL 仍可以叫 `/games`，因为对用户来说作品就是游戏。
- 内部代码和数据库建议使用 `works`，避免模型上把作品和归档文件混淆。

### 8.2 管理页面

```text
/admin/works
/admin/works/{work_id}
/admin/archive-versions/{archive_version_id}
/admin/characters
/admin/creators
/admin/tags
/admin/maintenance
```

管理端需要支持：

- 合并重复 Work。
- 编辑 Work 关系。
- 编辑翻译关联和目录。
- 切换 Work 当前 ArchiveVersion。
- 查看 ArchiveVersion 文件统计、排除统计和预计下载成本。

### 8.3 API

```text
GET    /api/works/lookup
POST   /api/works/{id}/relations
PATCH  /api/work-relations/{relation_id}
DELETE /api/work-relations/{relation_id}
POST   /api/works/{id}/translation-relations
PATCH  /api/translation-relations/{relation_id}
DELETE /api/translation-relations/{relation_id}

GET    /api/catalogs
POST   /api/catalogs
PATCH  /api/catalogs/{id}
POST   /api/catalogs/{id}/items
PATCH  /api/catalogs/{id}/items
DELETE /api/catalogs/{id}/items

GET    /api/archive-versions/{id}/web-play
GET    /api/admin/gc/dry-run
POST   /api/admin/gc/sweep
```

上传相关 API 可以继续复用现有存储端点：

```text
PUT  /api/blobs/{sha256}
PUT  /api/core-packs/{sha256}
POST /api/imports/{importJobId}/preflight
POST /api/imports/{id}/commit
```

commit 的目标是一个 `work_id` 和新建或复用的 `archive_version`；Work 创建、共同上传者绑定和任务绑定在同一 D1 batch 中完成。

## 9. 当前落地路径

已经固定的落地方式：

1. `0001_init_archive_schema.sql` 直接创建当前账户、站内信、存储和游戏领域完整 schema。
2. 上传 commit 写入 `works + archive_versions + archive_version_blob_refs + archive_version_core_pack_refs`。
3. 下载重组从 `archive_versions` 定位 R2 manifest，再由 manifest 读取文件级清单。
4. 公开 URL 可以继续叫 `/games`，但内部领域命名使用 `works`。

## 10. 查询示例

### 10.1 作品详情页

需要读取：

```text
works
work_titles
work_relations
translation_relations
work_characters + characters
work_staff + creators
work_tags + tags
archive_versions where is_current = 1
work_media_assets + media_assets
catalogs + catalog_items
```

页面重点是资料聚合，不直接扫描文件清单。

### 10.2 角色登场作品

```sql
SELECT
  w.id,
  w.slug,
  w.original_title,
  w.chinese_title,
  wc.role_key,
  wc.spoiler_level
FROM work_characters wc
JOIN works w ON w.id = wc.work_id
WHERE wc.character_id = ?
  AND w.status = 'published'
ORDER BY wc.role_key, w.original_title;
```

### 10.3 Work 的当前下载快照

```sql
SELECT *
FROM archive_versions
WHERE work_id = ?
  AND status = 'published'
  AND is_current = 1
LIMIT 1;
```

## 11. 搜索策略

初版可以使用普通索引和 `LIKE` 实现搜索：

- `works.original_title`
- `works.chinese_title`
- `work_titles.title`
- `creators.name`
- `tags.name`
- `characters.primary_name`

标签和登场角色都可以成为检索条件，但它们不共用同一张标签表。普通题材、类型、整理用标签进入 `tags`；登场角色进入 `characters` + `work_characters`，公开列表用独立的角色筛选参数反查作品。

当前实现约定：

- `/characters` 展示公开角色索引，条目进入 `/games?character={slug}` 查看登场作品。
- `/tags` 展示公开标签索引，条目进入 `/games?tag={slug}` 查看关联作品；角色不再作为普通标签录入。
- `/catalogs` 和 `/catalogs/{slug}` 展示人工编排目录及作品排序。
- `/admin/characters`、`/admin/creators`、`/admin/tags` 维护本体资料；重复角色、作者和标签通过合并到目标 slug 处理。
- `/admin/works/{workId}` 维护 Work 和这些关系表的连接：`work_characters`、`work_staff`、`work_relations`、`translation_relations`、`work_media_assets`。

当数据量增大后，建议追加一个物化搜索表：

```text
work_search_documents
  work_id
  title_text
  creator_text
  tag_text
  character_text
  updated_at
```

每次 Work、Title、Tag、Character、Staff 变更时刷新该表。这样可以避免每次搜索都跨很多关系表 join。

不要把搜索依赖建立在 `extra_json` 上。JSON 可以保留补充信息，但不应成为主要检索结构。

## 12. 数据一致性规则

必须由数据库约束或服务层保证：

- Work 的 slug 全局唯一。
- Work 的原名全局唯一，是人工判断“同一作品”的自然键。
- Work 的 `slug` 和原名是唯一身份约束；共同上传者由 `work_uploaders` 记录，不区分成员角色。
- 同一 Work 下 `manifest_sha256` 唯一。
- 同一 Work 同时只能有一个 published current ArchiveVersion。
- ArchiveVersion 发布后 manifest 不可变。
- ArchiveVersion 删除应进入回收站，不应立即删除 blob 或 core pack；技术上写入 `status = 'deleted'`。删除 current ArchiveVersion 后，服务层应在同一 Work 下自动选择最新 published 版本接任。
- 还原回收站中的 ArchiveVersion 时恢复为 `published`，但不抢占已有 current；仅在 Work 没有 current 时自动补为 current。
- 删除 Work 时应先确认其 ArchiveVersion 和对象引用的处理策略。
- blob 和 core pack 的 GC 必须通过引用扫描决定，不能因为某个 Work 删除就直接删除 R2 对象。
- 回收站中的 ArchiveVersion 在最终清理前仍保留对象引用表和 manifest，可以还原；最终清理后写入 `purged_at`、删除对象引用和 manifest，不能再还原。之后对应 blob/core pack 若没有其他归档或媒体引用，会进入 GC sweep。
- GC sweep 只把候选对象临时标记为 `purging`；R2 删除成功后标记为 `purged`，失败则恢复 `active`，以便下一轮重试。
- 上传端只把 `active` 对象视为已存在，不能覆盖正在 `purging` 的对象。
- 文件路径只在 ArchiveVersion manifest 中管理。
- 完整游戏 ZIP 不进入 R2。

## 13. 推荐默认决策

为减少后续实现时的分歧，建议固定以下默认值：

- 对外仍使用“游戏”称呼，对内使用 `Work`。
- 一个 Work 可以有多个 ArchiveVersion；每个 Work 只有一个 current。
- 新增语言、校对/修图方案或重新导入同一作品时创建 ArchiveVersion，不复制 Work。
- 作者和制作人员挂在 Work；具体文件来源、校对和修图状态挂在 ArchiveVersion。
- 主要登场角色挂在 Work。
- 标签只支持 Work 层；文件级标签不做。
- `extra_json` 只保存低频显示字段和暂未定型字段。

## 14. 最小落地顺序

建议下一阶段按这个顺序推进：

1. 建立 `works` / `archive_versions` 的 DB helper。
2. 管理端增加 Work 草稿创建和列表。
3. 上传 commit 选择或创建 Work。
4. commit 写入 `archive_versions` 和对象引用表。
5. 下载端从 `archive_versions` 读取 manifest。
6. 增加 Work relations 和 translation relations。
7. 增加 Characters / Creators / Tags。
8. 增加 catalogs 和管理端维护入口。

这个顺序的重点是先修正核心边界，再逐步丰富 VNDB 风格资料功能。
