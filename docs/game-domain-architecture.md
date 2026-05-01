# 游戏领域架构设计

本文档单独描述 VIPRPG-ZH-Archive 的“游戏资料”和“版本归档”领域模型。它不重复说明 R2 去重存储、Cloudflare 部署、用户体系和站内信实现；这些内容仍以主架构文档和 OpenNext 开发路径为准。

相关文档：

- [RPG Maker 2000/2003 去重存储库架构计划](./rpg-maker-2000-2003-deduplicated-storage-plan.md)
- [OpenNext 应用与 Cloudflare 基础设施开发路径](./opennext-cloudflare-development-path.md)

本文档定义当前唯一的游戏领域模型。

## 1. 设计目标

当前游戏资料模型需要解决四个问题：

1. 系列作品需要统一管理页面。
2. 前作、后作、外传、同世界观、重制版等作品关系需要显式记录。
3. “游戏本身”和“某次发布版本”不能混为一谈，否则同一作品的汉化版、修正版、活动投下版、再打包版会越来越难管理。
4. 元数据会持续增长，例如主要登场角色、投下场合、标签、作者、来源链接、版权备注等，不能把所有东西都硬塞进一个越来越大的作品表。

因此当前模型拆成：

```text
Series
  系列或集合，例如同一企划、同一世界观、同一作者系列。

Work
  作品本身。它是玩家、搜索和资料页面看到的主要对象。

Release
  作品的一条玩家可识别的版本分支，例如原版、重制版、修正版、活动投下版。

ArchiveVersion
  本站实际归档的一份可下载文件快照，同时记录语言、校对、修图等归档状态。
```

用一句话概括：

```text
Series 管一组 Work；Work 管资料；Release 管版本分支和发布日期；ArchiveVersion 管本站保存的具体归档。
```

## 2. 核心对象解释

### 2.1 Series

`Series` 表示系列、合集、企划或世界观集合。

例子：

- 某作者连续制作的一组作品。
- 同一世界观下的多个 RPG Maker 作品。
- 某个活动或企划下官方整理的系列。

Series 本身不直接下载。它的用途是管理和展示：

- 系列介绍。
- 系列内作品排序。
- 正传、外传、同世界观、合集收录等关系。

### 2.2 Work

`Work` 表示作品本身，是公开游戏资料页面的核心。

Work 应回答：

- 这是什么作品？
- 它的中文名、原名、别名是什么？
- 作者是谁？
- 它大概是什么引擎、题材、标签？
- 它与其他作品有什么关系？
- 它有哪些公开发布版本可以下载？

Work 不应该直接保存文件清单。文件清单属于 ArchiveVersion。

### 2.3 Release

`Release` 表示作品的一条可被玩家识别的版本分支。

常见 Release：

- 原版发布。
- 修正版。
- Maniacs Patch 适配版。
- 活动投下版。
- 再发布版。

Release 应回答：

- 这是哪个作品的哪个发布版本？
- 它基于原版、重制版还是其他基底？
- 它的版本标识是什么？
- 发布时间是什么？
- 来源链接是什么？

Release 不等同于独立补丁包。架构仍然不以“补丁包增量继承”作为归档目标。这里的 Release 指的是一个版本分支的资料层；语言、校对、修图和具体文件状态下放到 ArchiveVersion。

### 2.4 ArchiveVersion

`ArchiveVersion` 表示本站实际保存的一份文件快照。

同一个 Release 可以有多个 ArchiveVersion，例如：

- 第一次导入时漏了某个白名单类型，之后用新白名单重新导入。
- 重新计算 manifest 或修正路径编码策略。
- 管理员发现原导入损坏，重新从同一来源归档。

ArchiveVersion 应回答：

- 本站现在保存了哪些文件？
- 这份归档是什么语言？
- 是否校对、修图？
- 它是该 Release 下哪个归档方案？
- manifest SHA-256 是什么？
- 使用了哪个文件白名单版本？
- 有多少文件进入归档？
- 排除了多少白名单外文件？
- 需要多少 R2 Get 才能重组下载？
- 其 core pack 和 blob 引用是什么？

ArchiveVersion 发布后应当不可变。若需要修正，应创建新的 ArchiveVersion，并把同一 `archive_key` 的当前下载指向新快照。

### 2.5 Blob / CorePack / Manifest

这三者仍沿用去重存储架构：

- `Blob`：按 SHA-256 内容寻址的独立文件对象，主要用于可复用静态资源和运行时文件。
- `CorePack`：一个游戏发布快照独有的小文件集合，通常包含地图、数据库、ini 等核心文件。
- `Manifest`：ArchiveVersion 的完整文件清单，记录路径、文件哈希、大小、来源 blob 或 core pack entry。

重要边界：

- 静态资源索引不应该包含文件名。
- 文件名和相对路径只存在于 `archive_version_files` 和 manifest 中。
- 同一个 blob 可以在不同 ArchiveVersion 中以不同文件名出现。
- R2 不保存完整游戏 ZIP。

## 3. 关系图

```text
series
  1 ── n work_series n ── 1 works

works
  1 ── n work_titles
  1 ── n releases
  1 ── n work_characters n ── 1 characters
  1 ── n work_tags n ── 1 tags
  1 ── n work_relations n ── 1 works

releases
  1 ── n archive_versions
  1 ── n release_events n ── 1 events
  1 ── n release_staff n ── 1 creators
  1 ── n release_tags n ── 1 tags

archive_versions
  1 ── n archive_version_files
  n ── 1 releases

archive_version_files
  n ── 1 blobs 或 core_packs
```

## 4. D1 表结构

下面是当前游戏领域表，后续实现只围绕这些表开发。

### 4.1 作品和系列

```sql
CREATE TABLE works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  original_title TEXT NOT NULL UNIQUE,
  chinese_title TEXT,
  sort_title TEXT,
  description TEXT,
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

CREATE TABLE series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_original TEXT,
  description TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'published', 'hidden', 'deleted')
  ) DEFAULT 'draft',
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE work_series (
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position_number REAL,
  position_label TEXT,
  relation_kind TEXT NOT NULL CHECK (
    relation_kind IN ('main', 'side', 'collection_member', 'same_setting', 'other')
  ) DEFAULT 'main',
  notes TEXT,
  PRIMARY KEY (series_id, work_id)
);

CREATE INDEX idx_work_series_order
  ON work_series(series_id, position_number, position_label);
```

说明：

- `works.original_title` 是作品身份的自然唯一键；数据库外键仍使用 `id` 作为技术主键。
- `works.chinese_title` 是可选中文名；为空时展示层使用原名。
- `works.uses_maniacs_patch` 跟随作品本体，因为 Maniacs Patch 会影响作品运行时假设，而不是某个文件归档快照。
- `works.icon_blob_sha256` 和 `works.thumbnail_blob_sha256` 是 Work 层的单图引用；为空时展示层按引擎使用缺省图。
- `work_titles` 只保存可多值的别名；原名和中文名是 Work 的明确列。
- `series` 与 `works` 是多对多关系，因为一个作品可能既属于作者系列，也属于活动合集。
- `position_number` 用于排序，允许 `1.5` 这类外传插入位置；`position_label` 用于显示“外传”“前日谈”等人工标签。

### 4.2 作品关系

```sql
CREATE TABLE work_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  to_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN (
      'prequel',
      'sequel',
      'side_story',
      'same_setting',
      'remake',
      'remaster',
      'fan_disc',
      'alternate_version',
      'translation_source',
      'inspired_by',
      'other'
    )
  ),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (from_work_id, to_work_id, relation_type),
  CHECK (from_work_id <> to_work_id)
);

CREATE INDEX idx_work_relations_from
  ON work_relations(from_work_id, relation_type);

CREATE INDEX idx_work_relations_to
  ON work_relations(to_work_id, relation_type);
```

说明：

- 前作、后作这类关系是有方向的。
- 若需要在页面上双向显示，可以由应用层根据 `relation_type` 生成反向文案。
- `translation_source` 用于表达“此作品或此发布基于另一个作品”，但若关系只属于某个汉化 Release，应该优先记录在 Release 层。

### 4.3 发布版本和归档快照

```sql
CREATE TABLE releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  release_key TEXT NOT NULL,
  release_label TEXT NOT NULL,
  base_variant TEXT NOT NULL CHECK (
    base_variant IN ('original', 'remake', 'other')
  ) DEFAULT 'original',
  variant_label TEXT NOT NULL DEFAULT 'default',
  release_type TEXT NOT NULL CHECK (
    release_type IN (
      'original',
      'translation',
      'revision',
      'localized_revision',
      'demo',
      'event_submission',
      'patch_applied_full_release',
      'repack',
      'other'
    )
  ) DEFAULT 'original',
  release_date TEXT,
  release_date_precision TEXT NOT NULL CHECK (
    release_date_precision IN ('year', 'month', 'day', 'unknown')
  ) DEFAULT 'unknown',
  source_name TEXT,
  source_url TEXT,
  executable_path TEXT,
  rights_notes TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'published', 'hidden', 'deleted')
  ) DEFAULT 'draft',
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  UNIQUE (work_id, release_key)
);

CREATE INDEX idx_releases_work_status
  ON releases(work_id, status, release_date);

CREATE TABLE archive_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  archive_key TEXT NOT NULL,
  archive_label TEXT NOT NULL,
  archive_variant_label TEXT NOT NULL DEFAULT 'default',
  language TEXT NOT NULL,
  is_proofread INTEGER NOT NULL DEFAULT 0,
  is_image_edited INTEGER NOT NULL DEFAULT 0,
  manifest_sha256 TEXT NOT NULL,
  manifest_r2_key TEXT NOT NULL UNIQUE,
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
  is_current INTEGER NOT NULL DEFAULT 0,
  uploader_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'published', 'hidden', 'deleted')
  ) DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  deleted_at TEXT,
  UNIQUE (release_id, archive_key, archive_label),
  UNIQUE (release_id, archive_key, manifest_sha256)
);

CREATE INDEX idx_archive_versions_release
  ON archive_versions(release_id, archive_key, status, is_current);

CREATE UNIQUE INDEX idx_archive_versions_one_current
  ON archive_versions(release_id, archive_key)
  WHERE is_current = 1 AND status = 'published';
```

说明：

- `releases` 负责玩家能理解的版本分支和发布日期。
- `archive_versions` 负责本站导入、下载重组、语言、校对/修图状态和具体文件快照。
- `patch_applied_full_release` 表示“已经打好补丁的完整发布物”，不是独立补丁包支持。
- `release_key` 是同一 Work 下的稳定唯一键，由 `base_variant + release_type + variant_label` 生成；`release_label` 只负责显示。
- `base_variant` 表示该发布分支基于原版、重制版或其他基底。
- `variant_label` 是区分同类版本分支的短文本，例如 `原版`、`重制版`、`官方修正版`、`默认版`。
- `archive_key` 是同一 Release 下的稳定唯一归档分支键，由 `language + 校对/修图状态 + archive_variant_label` 生成。
- `archive_variant_label` 用来区分同语言、同校对/修图状态下的 A 方案、B 方案或不同上传者整理方案。
- `language`、`is_proofread`、`is_image_edited` 属于 ArchiveVersion，因为它们描述的是这份可下载归档，而不是作品版本分支本身。
- `is_current` 表示某个 Release 下某个 `archive_key` 当前默认下载的归档快照。
- 发布后的 ArchiveVersion 不应原地改 manifest。修正导入应创建新行，再切换 `is_current`。

### 4.4 归档文件清单

```sql
CREATE TABLE archive_version_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_version_id INTEGER NOT NULL REFERENCES archive_versions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  path_sort_key TEXT NOT NULL,
  path_bytes_b64 TEXT,
  role TEXT NOT NULL CHECK (
    role IN ('map', 'database', 'asset', 'runtime', 'metadata', 'other')
  ),
  file_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('blob', 'core_pack')),
  blob_sha256 TEXT REFERENCES blobs(sha256),
  core_pack_id INTEGER REFERENCES core_packs(id),
  pack_entry_path TEXT,
  mtime_ms INTEGER,
  file_mode INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (archive_version_id, path),
  CHECK (
    (storage_kind = 'blob'
      AND blob_sha256 IS NOT NULL
      AND core_pack_id IS NULL
      AND pack_entry_path IS NULL)
    OR
    (storage_kind = 'core_pack'
      AND blob_sha256 IS NULL
      AND core_pack_id IS NOT NULL
      AND pack_entry_path IS NOT NULL)
  )
);

CREATE INDEX idx_archive_version_files_version
  ON archive_version_files(archive_version_id, path_sort_key);

CREATE INDEX idx_archive_version_files_file_sha256
  ON archive_version_files(file_sha256);

CREATE INDEX idx_archive_version_files_blob_sha256
  ON archive_version_files(blob_sha256);

CREATE INDEX idx_archive_version_files_core_pack
  ON archive_version_files(core_pack_id);
```

说明：

- 路径只属于某个 ArchiveVersion。
- blob 表不记录“它曾经叫什么文件名”，避免静态资源索引膨胀和语义混乱。
- 若同一内容在 A 游戏叫 `Monster.png`，在 B 游戏叫 `Enemy.png`，它们仍应指向同一个 blob。

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

CREATE TABLE release_staff (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (
    role_key IN ('author', 'translator', 'proofreader', 'image_editor', 'publisher', 'repacker', 'other')
  ),
  role_label TEXT,
  notes TEXT,
  PRIMARY KEY (release_id, creator_id, role_key)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_original TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('viprpg', 'contest', 'collection', 'personal_release', 'other')
  ) DEFAULT 'viprpg',
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  source_url TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE release_events (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entry_label TEXT,
  entry_number TEXT,
  notes TEXT,
  PRIMARY KEY (release_id, event_id)
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

CREATE TABLE release_tags (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('admin', 'uploader', 'imported')) DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (release_id, tag_id)
);
```

说明：

- “主要登场角色”应进入 `characters` + `work_characters`，而不是写成逗号分隔文本。
- “投下场合”通常属于 Release，因此用 `release_events`。
- 作者可同时挂在 Work 和 Release 上。原作者属于 Work；发布方、活动整理方、再发布方通常属于 Release；汉化、校对、修图人员若只对应某份归档，应记录在 ArchiveVersion 的扩展元数据或后续专门关系表中。
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

CREATE TABLE release_media_assets (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  media_asset_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  sort_order INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, media_asset_id)
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

CREATE TABLE release_external_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (
    link_type IN ('official', 'source', 'download_page', 'patch_note', 'other')
  ) DEFAULT 'source',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

说明：

- 上传表单中明确选择的图标、缩略图、浏览图作为普通 blob 存入 R2。
- Work 的图标和缩略图是单值字段：`works.icon_blob_sha256`、`works.thumbnail_blob_sha256`。
- Work 的浏览图可以有多张，因此通过 `media_assets.kind = 'preview'` + `work_media_assets` 建立排序关系。
- 游戏目录内的 `screenshots/` 文件夹、根目录下文件名包含 `screenshot` / `screenshots` 的文件，以及根目录 `null.txt`，按导入策略强制排除，不自动作为媒体资产入库。
- Work 的封面图和 Release 的截图可能不同，因此分开关联。
- 外部链接不放进 JSON，便于统一显示、检查失效链接和做来源审计。

## 5. SQLite / D1 下的可扩展元数据策略

SQLite 不是 MongoDB，但这不是坏事。游戏资料库更需要稳定关系、可审计修改、可迁移数据，而不是任意形状的文档。

建议采用四层策略。

### 5.1 第一层：稳定字段

凡是会经常筛选、排序、展示、做权限判断的字段，应当成为明确列。

例子：

- `works.original_title`
- `works.chinese_title`
- `works.original_release_date`
- `archive_versions.language`
- `works.uses_maniacs_patch`
- `archive_versions.manifest_sha256`
- `archive_versions.estimated_r2_get_count`

这些字段不适合放进 JSON，因为它们会参与查询、索引和管理界面。

### 5.2 第二层：规范化关系表

凡是“一对多”或“多对多”的资料，应建关系表。

例子：

- 主要登场角色：`characters` + `work_characters`
- 投下场合：`events` + `release_events`
- 标签：`tags` + `work_tags` / `release_tags`
- 作者和汉化人员：`creators` + staff 表
- 系列成员：`series` + `work_series`

这样做的好处：

- 可以反查“某角色出现在哪些作品”。
- 可以生成“某活动收录作品列表”。
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

新的导入流程应从“创建一个游戏版本”改成“选择资料归属，再提交归档快照”。

推荐流程：

1. 上传者在浏览器选择文件夹或本地 ZIP。
2. 浏览器执行白名单过滤、SHA-256 计算、core pack 生成和 manifest 草案生成。
3. 上传者选择已有 Work，或创建新的 Work 草稿。
4. 上传者选择已有 Release，或创建新的 Release 草稿。
5. 上传者填写 ArchiveVersion 的语言、校对/修图状态和归档标识。
6. 前端调用 preflight，询问哪些 blob / core pack 已存在。
7. 前端只上传缺失 blob 和本次 core pack。
8. 前端提交 ArchiveVersion commit。
9. 服务端写入 `archive_versions`、`archive_version_files`、manifest R2 对象和统计信息。
10. 管理员或有权限用户发布 Work / Release / ArchiveVersion。

关键规则：

- 上传权限仍由用户角色决定，`uploader` 及以上可进入上传流程。
- 注册账户审核、角色调整和通知由用户体系与站内信处理，不属于游戏领域表。
- 不上传完整游戏 ZIP 到 R2。
- 不让 Worker 解完整游戏包作为主流程。
- 导入阶段不设置固定文件数或大小上限，但必须保存文件数量、归档大小、排除统计和预计 R2 Get。

## 7. 下载流程

公开下载不应该直接使用 Work 或 Release 的文件字段，而是从用户选择的 ArchiveVersion 或 Release 下某个 `archive_key` 的 current ArchiveVersion 开始。

流程：

```text
GET /games/{work_slug}/releases/{release_id}/download
  -> 查询 release
  -> 按 archive_key 找到 is_current = 1 的 published archive_version
  -> 读取 manifest
  -> 从 core pack 和 blob 流式重组 ZIP
  -> 尝试写入 Workers Cache/CDN 边缘缓存
  -> 不写入 R2 完整 ZIP
```

也可以提供更稳定的内部下载端点：

```text
GET /api/archive-versions/{archive_version_id}/download
```

当用户从作品页点下载时，页面先让用户选择语言/处理状态对应的归档分支，再使用该 `archive_key` 的 current ArchiveVersion。管理员需要复现旧快照时，可以从归档管理页指定 ArchiveVersion 下载。

## 8. 页面和 API

### 8.1 公开页面

```text
/games
/games/{work_slug}
/games/{work_slug}/releases/{release_id}
/series
/series/{series_slug}
/characters/{character_slug}
/events/{event_slug}
/tags/{tag_slug}
```

说明：

- 公开 URL 仍可以叫 `/games`，因为对用户来说作品就是游戏。
- 内部代码和数据库建议使用 `works`，避免模型上把作品和归档文件混淆。

### 8.2 管理页面

```text
/admin/works
/admin/works/{work_id}
/admin/series
/admin/series/{series_id}
/admin/releases/{release_id}
/admin/archive-versions/{archive_version_id}
/admin/characters
/admin/events
/admin/tags
```

管理端需要支持：

- 合并重复 Work。
- 调整 Work 所属 Series。
- 编辑 Work 关系。
- 管理 Release。
- 切换 Release 当前 ArchiveVersion。
- 查看 ArchiveVersion 文件统计、排除统计和预计下载成本。

### 8.3 API

```text
GET    /api/works
POST   /api/works
GET    /api/works/{id}
PATCH  /api/works/{id}

GET    /api/series
POST   /api/series
PATCH  /api/series/{id}
POST   /api/series/{id}/works

POST   /api/works/{id}/relations
DELETE /api/work-relations/{relation_id}

GET    /api/works/{id}/releases
POST   /api/works/{id}/releases
PATCH  /api/releases/{id}

POST   /api/releases/{id}/archive-versions
PATCH  /api/archive-versions/{id}
POST   /api/archive-versions/{id}/publish
POST   /api/archive-versions/{id}/make-current
GET    /api/archive-versions/{id}/download
```

上传相关 API 可以继续复用现有存储端点：

```text
PUT  /api/blobs/{sha256}
PUT  /api/core-packs/{sha256}
POST /api/imports/preflight
POST /api/imports/{id}/commit
```

commit 的目标是 `work_id`、`release_id` 和新建的 `archive_version`。

## 9. 当前落地路径

已经固定的落地方式：

1. `0001_init_archive_schema.sql` 直接创建当前账户、站内信、存储和游戏领域完整 schema。
2. 上传 commit 写入 `works + releases + archive_versions + archive_version_files`。
3. 下载重组从 `archive_versions` 读取 manifest 和文件索引。
4. 公开 URL 可以继续叫 `/games`，但内部领域命名使用 `works`。

## 10. 查询示例

### 10.1 作品详情页

需要读取：

```text
works
work_titles
work_series + series
work_relations
work_characters + characters
work_tags + tags
releases
archive_versions where is_current = 1
work_media_assets + media_assets
```

页面重点是资料聚合，不直接扫描文件清单。

### 10.2 系列页

```sql
SELECT
  w.id,
  w.slug,
  w.original_title,
  w.chinese_title,
  ws.position_number,
  ws.position_label,
  ws.relation_kind
FROM work_series ws
JOIN works w ON w.id = ws.work_id
WHERE ws.series_id = ?
  AND w.status = 'published'
ORDER BY ws.position_number, ws.position_label, w.sort_title, w.original_title;
```

### 10.3 角色登场作品

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

### 10.4 归档分支当前下载快照

```sql
SELECT *
FROM archive_versions
WHERE release_id = ?
  AND archive_key = ?
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
- 同一 Work 下 Release key 唯一；Release label 可随显示策略调整。
- 同一 Release 下 `archive_key + archive_label` 唯一。
- 同一 Release 的同一 `archive_key` 同时只能有一个 published current ArchiveVersion。
- ArchiveVersion 发布后 manifest 不可变。
- ArchiveVersion 删除应软删除，不应立即删除 blob 或 core pack。
- 删除 Work 时应先确认 Release 和 ArchiveVersion 的处理策略。
- blob 和 core pack 的 GC 必须通过引用扫描决定，不能因为某个 Work 删除就直接删除 R2 对象。
- 文件路径只在 ArchiveVersion 文件清单和 manifest 中管理。
- 完整游戏 ZIP 不进入 R2。

## 13. 推荐默认决策

为减少后续实现时的分歧，建议固定以下默认值：

- 对外仍使用“游戏”称呼，对内使用 `Work`。
- 一个作品可以有多个 Release。
- 一个 Release 可以有多个 ArchiveVersion；每个 `archive_key` 只有一个 current。
- 上传一个新的版本分支时，默认创建 Release；若只是新增语言、校对/修图方案或重新导入同一方案，创建 ArchiveVersion。
- 活动投下信息挂在 Release，不挂在 Work。
- 作者原作者挂在 Work；发布分支相关人员挂在 Release；只对应某份归档的汉化、校对、修图人员后续应挂在 ArchiveVersion 扩展关系上。
- 主要登场角色挂在 Work。
- 标签先支持 Work 和 Release 两层；文件级标签不做。
- `extra_json` 只保存低频显示字段和暂未定型字段。

## 14. 最小落地顺序

建议下一阶段按这个顺序推进：

1. 新增 `works` / `releases` / `archive_versions` 的 DB helper。
2. 管理端增加 Work 草稿创建和列表。
3. 上传 commit 先要求选择 Work 和 Release。
4. commit 写入 `archive_versions` 和 `archive_version_files`。
5. 下载端从 `archive_versions` 读取 manifest。
6. 增加 Series 管理。
7. 增加 Work relations。
8. 增加 Characters / Events / Tags。

这个顺序的重点是先修正核心边界，再逐步丰富 VNDB 风格资料功能。
