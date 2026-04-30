# RPG Maker 2000/2003 去重存储库架构计划

本文把“游戏整包上传后，把可复用静态资源去重存入 R2，游戏只保存独有数据和索引，下载时再按索引重组压缩包”的想法，整理成一套可实现的软件工程方案。

当前建议的核心模型是：

- R2 作为内容寻址对象库，按文件内容哈希保存可复用静态资源和需要单独管理的运行时文件，每个唯一内容只存一次。
- 每个游戏版本的核心独有文件打成一个 core pack，减少下载重组时的 R2 读取次数。
- D1 作为元数据和关系数据库，记录游戏、版本、文件清单、文件路径与物理存储对象之间的关系。
- 每个游戏版本不是一份完整压缩包，而是一份 manifest：它说明“这个游戏版本由哪些路径、哪些文件内容组成”。
- 下载时根据 manifest 从 R2 读取 core pack 和独立 blob，流式重组为 ZIP；热门版本可以额外缓存已组装 ZIP。
- 导入边界采用单一强制白名单：系统归档“可运行游戏内容”，不在白名单内的文件不进入 canonical manifest。

## 1. 背景和目标

### 1.1 背景

RPG Maker 2000/2003 游戏通常包含以下内容：

- 项目核心数据：`RPG_RT.ldb`、`RPG_RT.lmt`、`Map0001.lmu` 等地图和数据库文件。
- 游戏配置和说明：`RPG_RT.ini`、`Readme.txt`、补丁说明、作者说明等。
- 静态素材目录：`CharSet`、`ChipSet`、`FaceSet`、`Picture`、`Music`、`Sound`、`System`、`Title` 等。
- 运行时和依赖：`RPG_RT.exe`、`Harmony.dll`、字体、补丁 DLL 等。

其中大量 RTP 素材、公共素材、VIPRPG 常用素材会在不同游戏中重复出现。如果每个游戏都把整包原样存入 R2，R2 storage 很快超过免费额度。另一方面，地图和数据库文件虽然通常是独有内容，但数量可能很多，下载时逐个读取会放大 R2 Class B 操作。更合理的方式是：静态素材按文件内容去重，核心独有文件按游戏版本打包。

### 1.2 目标

- 降低 R2 存储占用：重复文件只保存一份。
- 降低下载重组的 R2 Class B 读操作：核心小文件以 core pack 形式读取。
- 保留游戏原始目录结构：下载时可重建可运行的游戏目录。
- 支持多个游戏版本：同一游戏可有原版、修正版、汉化版、补丁版。
- 支持审计和回收：知道每个 blob/core pack 被哪些游戏版本引用，能安全清理无人引用对象。
- 适配 Cloudflare Workers + OpenNext + R2 + D1。

### 1.3 非目标

- 不在 D1 中保存文件二进制内容。
- 不把大型 manifest 只作为 D1 JSON 字段存储。
- 不维护 SHA-256 以外的内容摘要作为持久化字段。
- 不把所有文件都打进 core pack；可复用静态素材仍以 blob 方式去重存储。
- 不默认缓存所有重组 ZIP，因为缓存 ZIP 会重新占用 R2 空间。
- 不把游戏目录中的所有杂项文件都视为归档对象；崩溃转储、原始压缩包、工具缓存、工程源文件等必须由白名单策略挡在 canonical 数据之外。

## 2. 关键结论

### 2.1 只用 SHA-256 做内容身份

长期归档系统需要一个稳定、抗碰撞、可跨环境复现的内容身份。为了降低复杂度，系统只维护一套持久化内容摘要：SHA-256。

建议：

- `sha256`：文件内容的主身份，作为 R2 对象 key 和 D1 主键。
- `size_bytes`：和 `sha256` 一起校验，便于快速排查异常。

SHA-256 以外的摘要、ZIP 构建所需的临时校验值不进入核心表结构；如果 ZIP 库需要额外校验值，应在构建 ZIP 时临时计算。

### 2.2 静态素材存 blob，核心文件存 core pack

不要按游戏保存：

```text
games/game-a/full.zip
games/game-b/full.zip
```

建议把可复用静态素材和需要单独管理的运行时文件按内容保存：

```text
blobs/sha256/ab/cd/abcdef...7890
```

把核心独有文件按游戏版本打成 core pack：

```text
core-packs/sha256/ab/cd/abcdef...7890.zip
```

然后 D1 记录每个逻辑文件的实际来源：

```text
game_version_file:
  game_version_id = 123
  path = "CharSet/Actor01.png"
  file_sha256 = "abcdef...7890"
  storage_kind = "blob"
  blob_sha256 = "abcdef...7890"

game_version_file:
  game_version_id = 123
  path = "Map0001.lmu"
  file_sha256 = "123456...7890"
  storage_kind = "core_pack"
  core_pack_id = 456
  pack_entry_path = "Map0001.lmu"
```

也就是说，游戏文件路径和实际存储对象分离。静态素材可以被许多游戏、许多路径引用；核心文件则通过 core pack 减少下载时的对象读取次数。

### 2.3 Core pack 是下载成本优化层

Core pack 的定位是：把某个游戏版本独有、但数量较多的小文件合并成一个 R2 对象。它主要优化 R2 Class B 读操作和 Worker subrequest 数量。

适合放入 core pack：

```text
RPG_RT.ldb
RPG_RT.lmt
Map*.lmu
RPG_RT.ini
```

不适合放入 core pack：

```text
CharSet/
ChipSet/
Picture/
Music/
Sound/
System/
RPG_RT.exe
*.dll
```

静态素材跨游戏复用价值高，应继续按 SHA-256 blob 去重；`RPG_RT.exe` 和 DLL 完整保留为普通独立 blob，不做额外运行时策略。`RPG_RT.ini` 进入 core pack。

### 2.4 上传端最好先做本地索引

如果用户先上传完整 ZIP，再由 Worker 解包去重，确实可以节省最终 R2 存储，但上传阶段仍会消耗流量、临时存储、Worker CPU 和内存。

更优流程是：

1. 浏览器读取本地文件夹或 ZIP。
2. 浏览器计算每个文件的 `sha256`、大小、路径。
3. 前端按规则分类 core 文件、asset 文件、runtime 文件和 excluded 文件。
4. 前端或本地导入工具生成 core pack。
5. 前端把 manifest 发给后端做 preflight。
6. 后端查询 D1，返回“哪些 asset/runtime blob 已存在，哪些缺失”。
7. 前端只上传缺失 asset/runtime blob 和本版本 core pack。
8. 后端写入游戏版本、core pack 和文件索引。

这样可以同时节省 R2 存储、重复上传成本，并降低下载重组时的 R2 读取次数。

### 2.5 导入边界使用强制白名单

本地扫描证明，真实游戏目录中会混入大量非运行内容，例如崩溃转储、原始压缩包、分卷包、翻译工具缓存、工程源文件和临时脚本。继续扩展黑名单会遗漏边界情况，因此导入策略固定为单一强制白名单。

当前 `file_policy_version = 'rpgm2000-2003-whitelist-v1'` 的允许类型：

```text
.avi
.bmp
.dll
.exe
.flac
.fon
.gif
.ico
.ini
.jpg
.ldb
.lmt
.lmu
.mid
.midi
.mpeg
.mp3
.mpg
.oga
.ogg
.opus
.otf
.png
.ttc
.ttf
.txt
.wav
.wma
.xyz
```

不在白名单内的文件不进入 canonical manifest，也不参与 blob/core pack 存储。导入任务仍应记录排除统计，便于解释“原目录大小”和“归档大小”之间的差异。

### 2.6 本地扫描得到的容量基线

基于 D 盘 177 个候选 RPG Maker 2000/2003 游戏的白名单重扫结果：

| 口径 | 游戏数 | 白名单内归档大小 | 文件数 | 白名单外排除 | 去重后计划存储 | 压缩比 | 节省率 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 原计划限制内样本 | 140 | 10.43 GB | 153,657 | 3.41 GB | 3.83 GB | 0.3670 | 63.30% |
| 不限制文件数和大小 | 177 | 18.52 GB | 419,521 | 5.29 GB | 6.31 GB | 0.3409 | 65.91% |

经验结论：

- R2 storage 不是初期最紧张的资源；即使纳入全部 177 个候选游戏，计划存储也低于 10 GB。
- 单游戏 core pack 低压缩本身只能带来很小空间收益，真正的空间节省来自跨游戏 blob 去重。
- Core pack 的主要价值是减少地图、数据库等核心小文件造成的 R2 Class B 读取次数和 Worker subrequest 数量。
- 下载重组的 Class B 操作和热门游戏下载缓存，比单纯存储容量更值得优先设计。

### 2.7 不设置固定规模上限

本地扫描显示，固定规模上限会把一批可归档且空间收益良好的游戏挡在系统之外。计划改为不设置固定的单游戏文件数或大小硬上限。

新的控制方式是：

- 导入阶段展示原目录大小、白名单内归档大小、白名单外排除大小、文件数、预计新增 R2 存储、预计下载 R2 Get 次数。
- 大型导入使用后台任务、分块提交和可恢复状态，不要求单个 Worker 请求完成所有工作。
- 大型下载优先后台构建或命中缓存 ZIP，避免每次请求都实时读取大量 blob。
- 管理端保留按用户、按时间窗口的上传配额和滥用限流，但这些是运营限额，不是游戏内容规模上限。

## 3. Cloudflare 约束

以下约束按 2026-04-29 查阅 Cloudflare 官方文档整理，后续实现前应再次确认。

### 3.1 R2

R2 Standard storage 免费层：

- Storage：`10 GB-month / month`
- Class A Operations：`1,000,000 requests / month`
- Class B Operations：`10,000,000 requests / month`
- Egress：免费

超出后 Standard storage 当前价格：

- Storage：`$0.015 / GB-month`
- Class A：`$4.50 / million requests`
- Class B：`$0.36 / million requests`

影响：

- 去重主要节省 storage。
- 下载重组 ZIP 时，如果一个游戏需要读取 2000 个 R2 blob，就是约 2000 次 Class B 读操作。
- Core pack 可以把地图、数据库等核心文件的多次读取压缩为 1 次 R2 Get。
- 热门游戏下载次数高时，Class B 操作可能比 storage 更值得优化。

### 3.2 Workers

Workers Paid 当前关键限制：

- CPU time 默认 30 秒，可配置到 5 分钟。
- Memory：128 MB。
- Subrequests：`10,000/request`。
- Response body 没有 Worker 自身强制上限，但 CDN cache 另有限制。

影响：

- 一个下载请求如果需要读取超过 10,000 个 R2 对象，不能在单个 Worker 请求中直接完成。
- Core pack 解包和 ZIP 重组都应采用 streaming，避免把所有文件读入内存。
- ZIP 压缩会消耗 CPU；初版建议用 `STORE` 或低压缩等级，优先保证稳定。

### 3.3 D1

D1 Workers Paid 当前关键限制：

- 单数据库最大 10 GB。
- 单 account D1 总存储最大 1 TB。
- 单次 Worker invocation D1 query 受 subrequest 限制影响，Paid 为 1000。
- 单行、字符串或 BLOB 最大 2 MB。
- 单 SQL 绑定参数最大 100。

影响：

- 不要把几千个文件条目塞进一个 JSON 字段。
- 文件索引应拆成行存储。
- 批量查询 blob/core pack hash 时应分块，每块不超过 100 个参数。
- 大型上传应分 chunk 写入，避免单次请求写几千条导致超限。

## 4. 数据模型

### 4.1 概念模型

```text
Game
  一个游戏条目，例如某个 VIPRPG 作品。

GameVersion
  一个游戏条目的可下载快照。产品策略上，不同版本、修正版、汉化版作为不同 Game 处理，不做差量继承。

Blob
  一个独立文件内容，通常是可复用静态资源或需要单独管理的运行时文件，由 sha256 标识，存放在 R2。

CorePack
  一个核心文件包，由 sha256 标识，存放在 R2，包含某个游戏版本的地图、数据库等独有小文件。

GameVersionFile
  某个游戏版本中的一个文件路径，指向一个 Blob 或 CorePack 内的 entry。

ImportJob
  一次导入任务，用于追踪上传、校验、索引、发布状态。

DownloadBuild
  一次下载重组任务或一个已缓存 ZIP。
```

### 4.2 推荐 D1 表

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_auth_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'uploader')) DEFAULT 'uploader',
  upload_status TEXT NOT NULL CHECK (upload_status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  approved_by_user_id INTEGER REFERENCES users(id)
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_original TEXT,
  author TEXT,
  original_release_date TEXT,
  original_release_precision TEXT NOT NULL CHECK (original_release_precision IN ('year', 'month', 'day', 'unknown')) DEFAULT 'unknown',
  description TEXT,
  tags_text TEXT,
  icon_blob_sha256 TEXT REFERENCES blobs(sha256),
  preview_blob_sha256 TEXT REFERENCES blobs(sha256),
  uses_maniacs_patch INTEGER NOT NULL DEFAULT 0,
  is_proofread INTEGER NOT NULL DEFAULT 0,
  is_image_edited INTEGER NOT NULL DEFAULT 0,
  engine_version TEXT,
  source_name TEXT,
  source_url TEXT,
  language TEXT,
  executable_path TEXT,
  rights_notes TEXT,
  uploader_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE TABLE game_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT,
  manifest_sha256 TEXT NOT NULL,
  file_policy_version TEXT NOT NULL,
  source_file_count INTEGER NOT NULL DEFAULT 0,
  source_size_bytes INTEGER NOT NULL DEFAULT 0,
  excluded_file_count INTEGER NOT NULL DEFAULT 0,
  excluded_size_bytes INTEGER NOT NULL DEFAULT 0,
  total_files INTEGER NOT NULL DEFAULT 0,
  total_size_bytes INTEGER NOT NULL DEFAULT 0,
  unique_size_bytes INTEGER NOT NULL DEFAULT 0,
  core_pack_count INTEGER NOT NULL DEFAULT 0,
  core_pack_size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  UNIQUE (game_id, version_label)
);

CREATE TABLE blobs (
  sha256 TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT,
  original_ext TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  storage_class TEXT NOT NULL DEFAULT 'standard',
  first_seen_game_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE core_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  uncompressed_size_bytes INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL DEFAULT 'zip',
  compression TEXT NOT NULL DEFAULT 'deflate-low',
  storage_class TEXT NOT NULL DEFAULT 'standard',
  first_seen_game_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE game_version_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  path_sort_key TEXT NOT NULL,
  path_bytes_b64 TEXT,
  role TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('blob', 'core_pack')),
  blob_sha256 TEXT REFERENCES blobs(sha256),
  core_pack_id INTEGER REFERENCES core_packs(id),
  pack_entry_path TEXT,
  mtime_ms INTEGER,
  file_mode INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (game_version_id, path),
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

CREATE INDEX idx_game_version_files_version
  ON game_version_files(game_version_id, path_sort_key);

CREATE INDEX idx_game_version_files_file_sha256
  ON game_version_files(file_sha256);

CREATE INDEX idx_game_version_files_blob_sha256
  ON game_version_files(blob_sha256);

CREATE INDEX idx_game_version_files_core_pack
  ON game_version_files(core_pack_id);

CREATE TABLE import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  game_version_id INTEGER REFERENCES game_versions(id) ON DELETE SET NULL,
  uploader_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'created',
  source_name TEXT,
  source_size_bytes INTEGER,
  file_count INTEGER NOT NULL DEFAULT 0,
  excluded_file_count INTEGER NOT NULL DEFAULT 0,
  excluded_size_bytes INTEGER NOT NULL DEFAULT 0,
  file_policy_version TEXT,
  missing_blob_count INTEGER NOT NULL DEFAULT 0,
  missing_core_pack_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE import_job_excluded_file_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_job_id INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  file_type TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_size_bytes INTEGER NOT NULL DEFAULT 0,
  example_path TEXT,
  UNIQUE (import_job_id, file_type)
);

CREATE TABLE download_builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  manifest_sha256 TEXT NOT NULL,
  r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  size_bytes INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT
);
```

### 4.3 字段说明

- `games.slug`：公开 URL 用，例如 `/games/yume-nikki-viprpg-demo`。
- `games.title`：译名或站内展示名。
- `games.title_original`：作品原名。
- `games.original_release_date`：原作发布日期，可只填年份；精度由 `original_release_precision` 标记。
- `games.tags_text`：上传时填写的多标签文本，初版不做规范化标签表。
- `games.icon_blob_sha256`、`games.preview_blob_sha256`：图标和浏览图作为独立 blob 存储。
- `games.uses_maniacs_patch`、`games.is_proofread`、`games.is_image_edited`：上传表单中的布尔元数据。
- `games.uploader_id`、`games.uploaded_at`：上传者和上传时间，由系统自动生成。
- `users.upload_status`：注册用户必须为 `approved` 才能上传；管理员默认具备上传权限。
- `game_versions.manifest_sha256`：对规范化 manifest JSON 计算哈希，用来判断版本文件清单是否变化。
- `game_versions.file_policy_version`：生成 manifest 时使用的强制白名单版本，用于后续审计和策略迁移。
- `game_versions.source_file_count`、`game_versions.source_size_bytes`：原目录或原 ZIP 中枚举到的总文件数和总大小。
- `game_versions.excluded_file_count`、`game_versions.excluded_size_bytes`：被白名单排除的文件数和大小。
- `game_versions.total_files`、`game_versions.total_size_bytes`：进入 canonical manifest 的白名单内文件数和归档大小。
- `game_versions.unique_size_bytes`：本版本需要新增的 blob 大小统计，不包含已存在 blob。
- `game_versions.core_pack_size_bytes`：本版本 core pack 在 R2 中的压缩后大小统计。
- `blobs.sha256`：独立文件内容的主键。
- `blobs.r2_key`：独立文件 blob 的实际 R2 对象位置。
- `core_packs.sha256`：核心文件包自身的内容主键。
- `core_packs.r2_key`：核心文件包的实际 R2 对象位置。
- `game_version_files.path`：下载重建时的相对路径。
- `game_version_files.path_bytes_b64`：预留字段；是否保存 ZIP 内原始文件名字节，等最小实现阶段分析真实样本后决定。
- `game_version_files.role`：文件角色，例如 `map`、`database`、`asset`、`runtime`、`metadata`。
- `game_version_files.file_sha256`：逻辑文件本身的 SHA-256，不管该文件来自 blob 还是 core pack。
- `game_version_files.storage_kind`：逻辑文件的物理来源，`blob` 表示直接读取独立 blob，`core_pack` 表示从核心文件包内读取。
- `game_version_files.pack_entry_path`：core pack 内部 entry 路径，用于下载重组时定位文件。
- `import_job_excluded_file_types`：按文件类型记录白名单外排除统计和示例路径，供上传者和管理员审计。

## 5. R2 对象布局

推荐一个 bucket 起步：

```text
rpg-archive/
  blobs/
    sha256/
      ab/
        cd/
          abcdef...7890

  core-packs/
    sha256/
      12/
        34/
          123456...7890.zip

  manifests/
    games/
      {game_id}/
        {game_version_id}-{manifest_sha256}.json

  imports/
    staging/
      {import_job_id}/
        source.zip

  downloads/
    cache/
      {game_version_id}/
        {manifest_sha256}.zip

  quarantine/
    {import_job_id}/
      ...
```

说明：

- `blobs/` 是可复用静态资源和独立运行时文件的长期主存储。
- `core-packs/` 是核心文件包的长期主存储，用于减少下载重组时的 R2 读取次数。
- `manifests/` 存完整规范化 manifest，便于导出、审计、备份。
- `imports/staging/` 只用于整包导入的临时文件，应配置生命周期自动删除。
- `downloads/cache/` 只存热门或手动固定的重组 ZIP。
- `quarantine/` 用于可疑上传、校验失败或待人工审核文件。

Blob key 生成规则：

```ts
function blobKey(sha256: string) {
  return `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}
```

Core pack key 生成规则：

```ts
function corePackKey(sha256: string) {
  return `core-packs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.zip`;
}
```

## 6. 文件分类规则

文件分类的第一步不是黑名单排除，而是强制白名单过滤。只有 `file_policy_version` 对应白名单内的类型才会进入 manifest、blob 或 core pack。

白名单外文件不进入发布版本，但导入任务必须记录数量、大小、类型和示例路径。这样管理员可以解释原目录大小和归档大小的差异，并在未来有证据地更新白名单。

当前白名单见 2.5。新增类型必须通过一次样本扫描和人工确认后提升 `file_policy_version`，不能临时绕过。

### 6.1 RPG Maker 2000/2003 核心文件

建议把以下文件标为 `role = 'database'` 或 `role = 'map'`，并默认放入 core pack：

```text
RPG_RT.ldb
RPG_RT.lmt
RPG_RT.ini
Map0001.lmu
Map0002.lmu
...
```

注意：`RPG_RT.lmt` 是地图树，通常也属于游戏独有核心数据，不应漏掉。

Core pack 固定采用“一个游戏一个核心包”的粒度。也就是说，一个游戏内的 `RPG_RT.ldb`、`RPG_RT.lmt`、`RPG_RT.ini` 和 `Map*.lmu` 一起打包。初版不做按类型或地图编号范围分组。

Core pack 使用 ZIP 低压缩等级，兼顾 R2 存储占用和 Worker 解包 CPU。

### 6.2 静态素材

以下目录一般标为 `role = 'asset'`：

```text
Backdrop/
Battle/
Battle2/
BattleCharSet/
BattleWeapon/
CharSet/
ChipSet/
FaceSet/
GameOver/
Monster/
Movie/
Music/
Panorama/
Picture/
Sound/
System/
System2/
Title/
```

这些文件最适合内容去重，应继续以独立 blob 存储，不放入 core pack。

### 6.3 运行时和依赖

以下文件建议标为 `role = 'runtime'`：

```text
RPG_RT.exe
Harmony.dll
*.dll
```

策略建议：

- `RPG_RT.exe` 和 DLL 完整保留，按普通独立 blob 存储，不进入 core pack。
- 不对 `exe` / DLL 做额外运行时策略。

### 6.4 白名单外文件

白名单外文件默认不进入发布版本，也不作为 blob 上传。典型例子包括：

```text
*.dmp
*.zip
*.7z
*.7z.001
*.z01
*.bak
*.tmp
*.log
翻译工具缓存
工程源文件
```

导入界面必须提供“白名单外文件”审计列表，至少包括：

- 文件类型。
- 文件数。
- 总大小。
- 示例路径。
- 当前 `file_policy_version`。

如果发现确实影响游戏运行的类型，应通过更新白名单版本解决，而不是为单个导入任务开例外。

## 7. Manifest 设计

Manifest 是一个游戏版本的完整文件清单。它应当可单独导出，并足以重建目录树。

示例：

```json
{
  "schema": "viprpg-archive.manifest.v1",
  "game": {
    "slug": "sample-game",
    "title": "Sample Game"
  },
  "version": {
    "label": "1.0",
    "createdAt": "2026-04-29T00:00:00.000Z",
    "filePolicyVersion": "rpgm2000-2003-whitelist-v1",
    "sourceFileCount": 1200,
    "sourceSize": 58000000,
    "includedFileCount": 980,
    "includedSize": 42000000,
    "excludedFileCount": 220,
    "excludedSize": 16000000
  },
  "corePacks": [
    {
      "id": "core-main",
      "sha256": "1234567890abcdef...",
      "size": 45678,
      "fileCount": 3,
      "format": "zip"
    }
  ],
  "files": [
    {
      "path": "RPG_RT.ldb",
      "role": "database",
      "sha256": "0123456789abcdef...",
      "size": 123456,
      "storage": {
        "kind": "core_pack",
        "packId": "core-main",
        "entry": "RPG_RT.ldb"
      }
    },
    {
      "path": "Map0001.lmu",
      "role": "map",
      "sha256": "2345678901abcdef...",
      "size": 4096,
      "storage": {
        "kind": "core_pack",
        "packId": "core-main",
        "entry": "Map0001.lmu"
      }
    },
    {
      "path": "CharSet/Hero.png",
      "role": "asset",
      "sha256": "abcdef0123456789...",
      "size": 8192,
      "storage": {
        "kind": "blob",
        "blobSha256": "abcdef0123456789..."
      }
    }
  ]
}
```

规范化规则：

- JSON 字段顺序固定。
- `files` 按 `path_sort_key` 排序。
- `corePacks` 按 `sha256` 排序。
- 路径统一使用 `/`。
- 禁止绝对路径、空路径、`..` 路径穿越。
- 如果后续决定记录原始路径编码，将原始字节放入 `path_bytes_b64`。
- `files[].sha256` 永远表示逻辑文件内容哈希；物理存储来源由 `files[].storage` 表示。

## 8. 上传流程

### 8.1 推荐流程：浏览器预索引

```text
用户选择游戏文件夹或 ZIP
  -> Worker 校验用户为管理员或 approved uploader
  -> 浏览器枚举文件
  -> 浏览器按强制白名单区分 included/excluded
  -> 浏览器计算 sha256/size/path
  -> 浏览器按规则分类 core/asset/runtime/excluded
  -> 浏览器或本地 CLI 生成 core pack
  -> POST /api/imports/preflight
  -> Worker 查询 D1 blobs 和 core_packs
  -> 返回 missing asset/runtime blobs 和 missing core packs
  -> 浏览器只上传缺失 asset/runtime blobs 和 core pack
  -> Worker 校验并写入 R2 blobs/core-packs
  -> POST /api/imports/{id}/commit
  -> Worker 写入 games 元数据、game_versions、core_packs 和 game_version_files
  -> 发布或等待审核
```

优点：

- 重复素材不重复上传。
- 核心文件包只上传一次，并在下载重组时只产生一次 R2 读取。
- Worker 不需要解完整 ZIP。
- 更容易做分块、断点续传、进度显示。

注意：

- 上传接口只允许管理员和审核通过的注册用户调用，`uploader_id` 由服务端自动记录。
- 不设置固定的单游戏文件数或大小硬上限；大型导入通过后台任务、分块提交、可恢复状态和管理端配额控制风险。
- 导入前必须显示原目录大小、白名单内归档大小、白名单外排除大小、预计新增 R2 存储和预计下载 R2 Get 次数。
- 浏览器端 hash 只能作为预检依据，后端仍要验证上传内容。
- 对单个小文件，可由 Worker 接收上传流并计算 SHA-256 后写入 R2。
- Core pack 上传后，后端至少要校验 pack 自身 SHA-256、文件数量、未压缩大小、entry 路径和 manifest 是否一致。
- 对大文件，可先进入 staging，再由后台任务验证后 promote 到 `blobs/`。

### 8.2 兼容流程：整包上传导入

```text
用户上传 ZIP
  -> Worker 校验用户为管理员或 approved uploader
  -> R2 imports/staging/{job}/source.zip
  -> 后台任务解包
  -> 对每个文件计算 hash
  -> 按强制白名单分类 included/excluded
  -> 对 included 文件分类 core/asset/runtime
  -> 生成 core pack
  -> 已存在 blob/core pack 只写索引
  -> 缺失 blob/core pack 写入 R2
  -> 导入成功后删除 staging ZIP
```

优点：

- 用户体验接近传统上传。
- 适合管理员批量导入旧资源。

缺点：

- 无法避免重复上传。
- Worker 解包受 CPU 和 128 MB 内存限制。
- ZIP 文件超过请求体限制时需要 multipart upload 或外部导入工具。

建议：

- 初版先实现浏览器预索引。
- 整包导入作为管理员工具，可以放在本地 CLI 或单独的批处理脚本中完成，再调用 API 写入 R2/D1。
- 原始 ZIP 不长期保留；导入成功后删除 staging，只保留 manifest、blob、core pack 和元数据。

## 9. Blob 和 Core Pack 上传校验

### 9.1 Blob 上传

适合大多数 RPG Maker 素材，以及需要单独管理的运行时文件。

```text
PUT /api/blobs/{sha256}
Headers:
  Content-Length: ...
  X-Content-SHA256: ...
```

Worker 行为：

1. 检查 D1 是否已存在 `sha256`。
2. 已存在则直接返回 `200 exists`。
3. 不存在则读取请求 body，流式计算 SHA-256。
4. hash 和路径参数一致时写入 R2。
5. 写入 D1 `blobs`。

### 9.2 并发重复上传

多个用户同时上传同一个缺失 blob 或 core pack 时可能发生竞争。

处理原则：

- `blobs.sha256` 和 `core_packs.sha256` 是唯一键。
- R2 key 由 sha256 决定，重复 put 相同内容是幂等的。
- D1 insert 使用 `INSERT OR IGNORE`。
- 如果 D1 已存在但 R2 缺失，标记为 `status = 'missing'` 并触发修复。

### 9.3 Core pack 上传和校验

Core pack 是一个版本核心文件集合，适合由浏览器或本地 CLI 先生成，再上传给 Worker。

```text
PUT /api/core-packs/{sha256}
Headers:
  Content-Length: ...
  X-Content-SHA256: ...
```

Worker 行为：

1. 检查 D1 是否已存在 `core_packs.sha256`。
2. 已存在则直接返回 `200 exists`。
3. 不存在则读取请求 body，流式计算 SHA-256。
4. 校验 pack SHA-256、大小、文件数量、entry 路径和 manifest 声明一致。
5. 写入 R2 `core-packs/`。
6. 写入 D1 `core_packs`。

初版只支持 ZIP 格式的 core pack，并固定使用低压缩等级。这样可以压缩 `lmu`、`ldb` 等核心文件，同时控制 Worker 解包 CPU。

### 9.4 不信任 R2 ETag

R2/S3 的 ETag 不应作为内容身份依据，尤其在 multipart 场景下。系统应保存并校验自己计算的 `sha256` 和 `size_bytes`。

## 10. 下载与重组流程

### 10.1 直接流式重组

```text
GET /api/games/{slug}/versions/{version}/download
  -> 查询 game_version_files
  -> 按路径排序
  -> R2.get(core_pack.r2_key)
  -> 流式读取 core pack entries
  -> 对每个 asset/runtime blob 执行 R2.get(blob.r2_key)
  -> 写入 ZIP stream
  -> 返回 application/zip
```

优点：

- 不额外占用最终 ZIP 的 R2 storage。
- 核心文件只需要一次 R2 Class B 读取。
- 任意版本随时可下载。

缺点：

- 每个 asset/runtime blob 仍至少一次 R2 Class B 操作。
- Worker 需要解析 core pack 并把 entry 写入最终 ZIP。
- 文件数量太多时会接近 Worker subrequest 限制。
- ZIP 压缩会消耗 CPU。

初版建议：

- ZIP entry 默认使用 `STORE` 或低压缩等级。
- 对已压缩或不值得二次压缩的白名单格式直接 `STORE`：`png`、`jpg`、`gif`、`mp3`、`ogg`、`avi`、`mpg`。
- 读取 core pack 时必须流式处理，不把整个 pack 解到内存。
- 大型版本优先后台构建缓存 ZIP；实时下载路径应在预计 R2 Get 次数或 Worker subrequest 接近上限时自动转入后台任务。

### 10.2 热门 ZIP 缓存

```text
downloads/cache/{game_version_id}/{manifest_sha256}.zip
```

策略：

- 第一次下载直接重组。
- 下载次数超过阈值后，后台生成缓存 ZIP。
- 后续下载只读取一个 ZIP 对象，避免重复读取 core pack 和多个 blob。
- 为缓存 ZIP 设置生命周期或手动 pin。

权衡：

- 缓存 ZIP 会增加 R2 storage。
- 但热门游戏下载会减少大量 Class B 操作和 CPU。

建议默认：

- 小众版本不缓存。
- 热门版本或站长推荐版本缓存。
- 缓存 ZIP 可设置 30 天未访问自动删除。

## 11. API 草案

### 11.1 导入

```text
POST /api/imports
  创建导入任务；要求管理员或 approved uploader

POST /api/imports/{id}/preflight
  输入文件 hash manifest 和上传元数据
  输出已存在/缺失 blob 和 core pack 列表

PUT /api/blobs/{sha256}
  上传单个缺失 blob

PUT /api/core-packs/{sha256}
  上传单个缺失 core pack

POST /api/imports/{id}/commit
  写入游戏元数据、游戏版本、core pack、文件索引、manifest

GET /api/imports/{id}
  查看导入进度和错误
```

### 11.2 游戏和版本

```text
GET /api/games
GET /api/games/{slug}
POST /api/games
PATCH /api/games/{id}

GET /api/games/{slug}/versions
GET /api/games/{slug}/versions/{version}
POST /api/games/{id}/versions/{versionId}/publish
```

### 11.3 下载

```text
GET /api/games/{slug}/versions/{version}/download
GET /api/downloads/{downloadBuildId}
POST /api/games/{id}/versions/{versionId}/build-download
```

### 11.4 管理

```text
GET /api/admin/blobs/{sha256}/references
GET /api/admin/core-packs/{sha256}/references
GET /api/admin/users/pending-uploaders
POST /api/admin/users/{userId}/approve-uploader
POST /api/admin/users/{userId}/reject-uploader
POST /api/admin/gc/mark
POST /api/admin/gc/sweep
```

## 12. 前端导入界面

导入界面需要支持：

- 仅管理员或审核通过的注册用户可进入上传流程。
- 选择文件夹。
- 选择 ZIP。
- 显示原目录文件数和大小、白名单内归档文件数和大小、白名单外排除文件数和大小、已存在大小、需上传大小、预计节省空间。
- 显示核心文件检测结果：`RPG_RT.ldb`、`RPG_RT.lmt`、`Map*.lmu`。
- 显示 core pack 文件数、压缩前大小、压缩后大小、预计减少的 R2 读取次数。
- 显示运行时文件统计：`exe`、`dll`、补丁程序作为普通独立 blob 保留。
- 显示白名单外文件类型汇总和示例路径。
- 对预计下载 R2 Get 次数很高的版本提示“建议生成缓存 ZIP”。
- 支持中断后继续上传缺失 blob 和 core pack。
- commit 前必须填写上传元数据：原名、译名、作者、原作发布日期、标签文本、图标、浏览图、简介、是否使用 Maniacs Patch、是否校对、是否修图。
- 系统自动记录上传者和上传时间。
- 可选补充字段：引擎版本、来源链接/出处、语言、发布状态、可执行入口、版权/授权备注。

建议的状态流：

```text
created
  -> indexing
  -> preflighted
  -> uploading_missing_objects
  -> verifying
  -> committed
  -> published
```

## 13. 路径和编码处理

RPG Maker 2000/2003 旧游戏经常涉及日文、中文和非 UTF-8 ZIP 文件名。这里容易出问题。

必须处理：

- ZIP entry 可能是 Shift-JIS、GBK、Big5 或乱码。
- Windows 路径大小写不敏感，但 ZIP/R2 key 大小写敏感。
- 路径分隔符可能是 `\` 或 `/`。
- 不能允许 `../`、绝对路径、盘符路径。

建议：

- 内部规范路径统一为 UTF-8 字符串和 `/` 分隔。
- 初版先通过真实样本分析非 UTF-8 ZIP 文件名，再决定是否实现 `path_bytes_b64` 原始文件名字节保存。
- `path_bytes_b64` 字段作为预留字段保留，但最小实现不强制写入。
- 建立 `path_sort_key = lower(normalized_path)` 用于排序和冲突检测。
- 同一版本中如果出现仅大小写不同的路径，应进入人工审核。

## 14. 删除和垃圾回收

不要在删除游戏版本时立即删除 blob 或 core pack。因为 blob 可能被其他游戏引用，core pack 也可能被多个版本复用。

推荐流程：

1. 删除游戏版本只做软删除，`game_versions.status = 'deleted'`。
2. GC mark：扫描所有非 deleted/purged 版本引用的 blob 和 core pack。
3. GC sweep：找出未被引用的 blob/core pack，且超过宽限期。
4. 删除 R2 blob 和 R2 core pack。
5. 将 D1 `blobs.status`、`core_packs.status` 改为 `purged` 或删除记录。

宽限期建议：

```text
7 至 30 天
```

原因：

- 防止误删。
- 给数据库备份、恢复、审核留时间。

## 15. 成本模型

### 15.1 存储成本

文档和界面中不要笼统使用“游戏大小”，应明确区分：

- 原目录大小：上传源中枚举到的全部文件大小。
- 白名单内归档大小：进入 manifest 的文件大小，也是 canonical 数据的逻辑大小。
- 白名单外排除大小：因强制白名单策略不进入归档的文件大小。
- 去重后计划存储：唯一 blob、唯一 core pack 和 manifest 的合计大小。

如果整包存储全部源文件：

```text
storage_full = sum(each_game_zip_size)
```

本系统的去重存储：

```text
storage_dedup = sum(unique_blob_size) + sum(core_pack_size) + sum(manifest_size) + optional_cached_zip_size
```

节省比例：

```text
saving = 1 - storage_dedup / storage_full
```

导入界面可以直接显示：

```text
原目录大小：58 MB
白名单内归档大小：42 MB
白名单外排除：16 MB
已存在内容：31 MB
新增 core pack：3 MB
实际新增 R2 存储：11 MB
预计节省：73.8%
```

本地扫描基线说明，白名单和跨游戏去重共同决定最终容量；固定规模限制不是必要的 R2 storage 保护手段。

### 15.2 操作成本

导入一个包含 1000 个文件的游戏：

- Preflight 查询 D1：按 100 hash 分块，约 10 组查询。
- 新 asset/runtime blob 上传：每个缺失文件 1 次 R2 Put，属于 Class A。
- Core pack 上传：每个游戏版本通常 1 次 R2 Put，属于 Class A。
- 已存在 blob/core pack 不需要 R2 Put。
- 导入成功后删除原始 staging ZIP，不把原包作为长期存储成本纳入模型。

下载一个包含 1000 个文件的游戏：

- 未使用 core pack 的逐文件重组：约 1000 次 R2 Get，属于 Class B。
- 使用 core pack 后：约 `1 + asset_blob_count + runtime_blob_count` 次 R2 Get。
- 已缓存 ZIP：约 1 次 R2 Get。

结论：

- 去重可以显著降低 storage。
- Core pack 可以降低核心小文件带来的 Class B 操作。
- 但“按素材 blob 重组下载”仍会增加 Class B 操作。
- 热门游戏需要缓存 ZIP，否则下载量上来后 Class B 操作会成为主要成本。
- 大型或高热度游戏应优先生成 final ZIP cache；这是 Class B 和 Worker CPU 优化，不是功能性附加项。

## 16. 安全和版权策略

### 16.1 运行时文件

原包中的 `RPG_RT.exe`、DLL 和补丁程序完整保留。它们作为普通独立 blob 存储，不进入 core pack，也不做额外运行时策略。

建议：

- `RPG_RT.ini` 进入 core pack。
- `exe`、`dll` 文件按原路径进入最终下载包，并作为普通独立 blob 存储。
- 安全风险主要通过上传权限控制，而不是对运行时文件做内容级审核。

### 16.2 RTP 和素材版权

RTP 和第三方素材可能有授权限制。去重存储不改变版权责任。

建议：

- 为资源来源建立 metadata。
- 对官方 RTP 资源考虑“需要用户自备 RTP”的下载模式。
- 对无法确认授权的资源保留后台可见，不进入公开下载。

### 16.3 滥用防护

- 上传接口需要登录和权限；管理员可上传，注册用户必须通过管理员审核后才能上传。
- 单用户每日上传大小限制。
- 单用户、单时间窗口、单队列的运营配额和并发限制。
- 强制白名单文件类型和路径校验。
- 大型导入进入后台队列，失败可恢复，不要求单次 Worker 请求完成。
- 记录 `uploader_id` 和 `uploaded_at`，便于追踪和回收。

## 17. 实施阶段

### Phase 0：验证样本

目标：证明去重率值得做。

任务：

- 收集 20 到 50 个典型 RPG Maker 2000/2003 游戏。
- 本地脚本扫描文件 hash。
- 输出总大小、唯一 blob 大小、core pack 大小、重复率、文件数量分布。
- 输出白名单内归档大小、白名单外排除大小、文件类型分布。
- 统计素材目录重复率、核心文件数量、core pack 压缩率和预计节省的 Class B 读取次数。

交付：

- `dedup-report.json`
- `dedup-report.md`

### Phase 1：最小可用存储模型

目标：能导入一个本地文件夹，写入 R2/D1，并在后台看到 manifest。

任务：

- 建立 D1 migration。
- 建立 R2 bucket binding。
- 实现 `blobs`、`core_packs`、`games`、`game_versions`、`game_version_files`。
- 实现 `users` 和上传权限字段，支持管理员与审核通过的 uploader。
- 实现本地或管理端导入工具。
- 固定强制白名单和 `file_policy_version`。
- 实现 core pack 生成、manifest 生成和 R2 保存。
- 记录白名单外文件类型汇总、排除大小和示例路径。

暂不做：

- 在线 ZIP 重组。
- 热门缓存。

### Phase 2：浏览器预索引上传

目标：管理员和审核通过的注册用户可以通过网页导入游戏。

任务：

- 实现注册用户上传资格审核。
- 前端选择文件夹/ZIP。
- 浏览器计算 SHA-256。
- 浏览器或本地 CLI 生成 core pack。
- Preflight 查询已有 blob 和 core pack。
- 只上传缺失 blob 和 core pack。
- Commit 游戏元数据和游戏版本。
- 上传表单包含原名、译名、作者、原作发布日期、标签文本、图标、浏览图、简介、Maniacs Patch、校对、修图、引擎版本、来源链接/出处、语言、发布状态、可执行入口、版权/授权备注。
- 服务端自动写入 `uploader_id` 和 `uploaded_at`。
- 展示节省空间。
- 展示白名单外排除统计和预计下载 R2 Get 次数。

### Phase 3：下载重组

目标：用户可以下载重建后的 ZIP。

任务：

- 实现 manifest 查询。
- 实现 R2 core pack stream 和 blob stream 到 ZIP stream。
- 下载前估算 R2 Get 次数、Worker subrequest、预计输出大小和是否已有缓存 ZIP。
- 大型版本或预计读取对象过多时转入后台构建，不在单个 Worker 请求中强行实时重组。

### Phase 4：缓存和成本优化

目标：控制热门下载的 Class B 操作和 Worker CPU。

任务：

- 记录下载次数。
- 超阈值后台生成缓存 ZIP。
- 缓存 ZIP 生命周期清理。
- 管理端 pin/unpin 热门版本。

### Phase 5：审核、删除和 GC

目标：系统长期可维护。

任务：

- 游戏版本软删除。
- Blob mark-and-sweep GC。
- Core pack mark-and-sweep GC。
- 定期一致性检查：D1 blob/core pack 存在但 R2 缺失、R2 对象无 D1 记录。

## 18. 技术选择建议

### 18.1 Hash

- 浏览器：Web Crypto `crypto.subtle.digest('SHA-256', data)`。
- Worker：优先使用 Web Crypto 或流式 digest。
- Node 本地导入脚本：`crypto.createHash('sha256')`。

### 18.2 ZIP

候选库：

- `fflate`：轻量，浏览器和 Worker 都可用。
- `zip.js`：功能较完整，适合处理编码和流。

建议：

- 导入 ZIP 时优先在浏览器或本地 CLI 处理。
- Core pack 优先在浏览器或本地 CLI 生成，使用 ZIP 低压缩等级，Worker 负责校验和入库。
- Worker 在线重组 ZIP 时选择支持 streaming 的库。
- 初版不要追求高压缩率。

### 18.3 OpenNext 路由

建议结构：

```text
app/
  api/
    imports/
    blobs/
    core-packs/
    games/
    downloads/
```

R2/D1 bindings 通过 Cloudflare 环境注入。服务层封装：

```text
lib/server/storage/blob-store.ts
lib/server/storage/core-pack-store.ts
lib/server/storage/manifest-store.ts
lib/server/db/games.ts
lib/server/db/blobs.ts
lib/server/db/core-packs.ts
lib/server/import/manifest.ts
lib/server/import/core-pack.ts
lib/server/download/zip-builder.ts
```

## 19. 风险和应对

### 19.1 D1 写入大量文件索引较慢

应对：

- 分 chunk commit。
- 每个请求写 200 到 500 个文件。
- 使用 import job 状态追踪。

### 19.2 单次下载文件数超过 Worker subrequest 限制

应对：

- 导入阶段不设置固定文件数或大小上限，但必须保存每个版本的预计 R2 Get 次数和白名单内文件数量。
- 核心文件通过 core pack 合并读取。
- 实时下载前做成本预估；接近 Worker subrequest 或 CPU 风险时，改为后台构建缓存 ZIP。
- 热门或大型版本优先使用 final ZIP cache，把下载路径降到一次 R2 Get。

### 19.3 路径编码导致游戏无法运行

应对：

- 初版先用真实样本分析非 UTF-8 ZIP 文件名，再决定是否启用 `path_bytes_b64`。
- 内部始终保存规范化 UTF-8 路径。
- 对乱码路径或仅大小写不同的路径进入人工确认。

### 19.4 ZIP 重组 CPU 过高

应对：

- 默认 STORE。
- Core pack 解包和最终 ZIP 写入都采用 streaming。
- 热门版本缓存 ZIP。
- 大型版本后台构建。

### 19.5 Core pack 粒度导致跨版本重复存储

应对：

- 固定接受“一个游戏一个 core pack”的重复，换取实现简单和下载读操作更少。
- Phase 0 统计多版本核心文件重复率。
- 初版不支持按类型或地图编号范围分组。

### 19.6 Core pack 损坏影响整个版本核心文件

应对：

- 上传时校验 core pack SHA-256、文件数量、未压缩大小和 entry 列表。
- 发布前做一次重建 ZIP dry-run。
- 后台定期抽样校验 core pack 与 manifest 是否一致。

### 19.7 误删共享 blob 或 core pack

应对：

- 只做软删除。
- GC 使用 mark-and-sweep。
- 设置 7 到 30 天宽限期。
- GC 前生成 dry-run 报告。

## 20. 已固定决策

### 20.1 已确认

- 运行时文件完整保留：`RPG_RT.exe` 和 DLL 作为普通独立 blob，不做额外运行时策略；`RPG_RT.ini` 进入 core pack。
- 上传权限：管理员可上传；注册用户必须由管理员审核通过后才能上传；上传记录自动写入 `uploader_id` 和 `uploaded_at`。
- 规模限制：不设置固定的单游戏文件数或大小硬上限；通过强制白名单、导入队列、分块提交、下载成本预估和缓存 ZIP 控制风险。
- 文件类型策略：使用单一强制白名单，白名单外文件不进入 canonical manifest；每次导入记录 `file_policy_version` 和排除统计。
- 原始 ZIP：导入成功后删除 staging ZIP；长期 canonical 数据只保留 manifest、blob、core pack 和元数据。
- 版本策略：完全不做差量发布或版本继承；不同版本作为不同游戏条目处理。
- Core pack 粒度：每个游戏固定一个 core pack，不做按类型或地图编号范围分组。
- Core pack 压缩：使用 ZIP 低压缩等级。
- 检索元数据：上传时填写原名、译名、作者、原作发布日期、标签文本、图标、浏览图、简介、是否使用 Maniacs Patch、是否校对、是否修图。
- 补充元数据：引擎版本、来源链接/出处、语言、发布状态、可执行入口、版权/授权备注。
- 自动元数据：上传者和上传时间由系统生成。

### 20.2 暂缓决策

- 非 UTF-8 ZIP 文件名的原字节级重建暂缓；最小实现阶段先用真实样本分析，再决定是否启用 `path_bytes_b64`。

## 21. 最小实现建议

如果要尽快开始，建议按以下顺序做：

1. 写一个本地扫描脚本，对现有样本游戏计算 SHA-256，先确认真实去重率。
2. 用真实样本检查路径编码，决定最小实现是否需要写入 `path_bytes_b64`。
3. 建 D1 schema、R2 blob key 和 core pack key 规则。
4. 实现管理员和审核通过注册用户的上传权限。
5. 做导入页面，优先支持“文件夹上传 + 浏览器预索引”，并执行强制白名单。
6. 上传表单写入完整检索元数据，服务端自动记录上传者和上传时间。
7. 导入时记录白名单外文件类型汇总、排除大小、示例路径和 `file_policy_version`。
8. 导入时生成一个游戏级 core pack，并写入 manifest。
9. 做 manifest 写入和游戏详情页。
10. 做下载重组，并在下载前估算 R2 Get 次数。
11. 对大型或热门版本实现后台缓存 ZIP。
12. 统计 core pack 后的实际 Class B 读取次数，并根据下载日志调整缓存策略。

这条路线的优点是：先验证是否真的省空间，再逐步把复杂度加上去，不会一开始就陷入 ZIP 编码、后台任务和缓存策略的细节。

## 22. 参考链接

- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
