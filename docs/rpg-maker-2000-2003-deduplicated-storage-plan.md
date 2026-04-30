# RPG Maker 2000/2003 去重存储库架构计划

本文把“游戏在浏览器端预索引后，把可复用静态资源去重存入 R2，游戏只保存独有数据和索引，下载时再按索引重组压缩包”的想法，整理成一套可实现的软件工程方案。

游戏资料、系列、作品关系、发布版本和归档快照的领域模型单独维护在：[游戏领域架构设计](./game-domain-architecture.md)。

当前建议的核心模型是：

- R2 作为内容寻址对象库，按文件内容哈希保存可复用静态资源和需要单独管理的运行时文件，每个唯一内容只存一次。
- 每个 ArchiveVersion 的核心独有文件打成一个 core pack，减少下载重组时的 R2 读取次数。
- D1 作为元数据和关系数据库，记录作品、发布版本、归档快照、文件路径与物理存储对象之间的关系。
- 每个 ArchiveVersion 不是一份完整压缩包，而是一份 manifest：它说明“这个归档快照由哪些路径、哪些文件内容组成”。
- 下载时根据 manifest 从 R2 读取 core pack 和独立 blob，流式重组为 ZIP；完整游戏 ZIP 不进入 R2，只允许作为响应流或可丢弃的 Workers Cache/CDN 边缘缓存存在。
- 导入边界采用单一强制白名单：系统归档“可运行游戏内容”，不在白名单内的文件不进入 canonical manifest。

## 1. 背景和目标

### 1.1 背景

RPG Maker 2000/2003 游戏通常包含以下内容：

- 项目核心数据：`RPG_RT.ldb`、`RPG_RT.lmt`、`Map0001.lmu` 等地图和数据库文件。
- 游戏配置和说明：`RPG_RT.ini`、`Readme.txt`、补丁说明、作者说明等。
- 静态素材目录：`CharSet`、`ChipSet`、`FaceSet`、`Picture`、`Music`、`Sound`、`System`、`Title` 等。
- 运行时和依赖：`RPG_RT.exe`、`Harmony.dll`、字体、补丁 DLL 等。

其中大量 RTP 素材、公共素材、VIPRPG 常用素材会在不同游戏中重复出现。如果每个游戏都把整包原样存入 R2，R2 storage 很快超过免费额度。另一方面，地图和数据库文件虽然通常是独有内容，但数量可能很多，下载时逐个读取会放大 R2 Class B 操作。更合理的方式是：静态素材按文件内容去重，核心独有文件按 ArchiveVersion 打包。

### 1.2 目标

- 降低 R2 存储占用：重复文件只保存一份。
- 降低下载重组的 R2 Class B 读操作：核心小文件以 core pack 形式读取。
- 保留游戏原始目录结构：下载时可重建可运行的游戏目录。
- 支持作品、发布版本和归档快照分层：同一作品可有原版、修正版、汉化版、活动投下版等 Release，每个 Release 可有一个或多个 ArchiveVersion。
- 支持审计和回收：知道每个 blob/core pack 被哪些 ArchiveVersion 引用，能安全清理无人引用对象。
- 适配 Cloudflare Workers + OpenNext + R2 + D1。

### 1.3 非目标

- 不在 D1 中保存文件二进制内容。
- 不把大型 manifest 只作为 D1 JSON 字段存储。
- 不维护 SHA-256 以外的内容摘要作为持久化字段。
- 不把所有文件都打进 core pack；可复用静态素材仍以 blob 方式去重存储。
- 不在 R2 中保存任何完整游戏 ZIP；最终 ZIP 只能作为响应流或可丢弃的 Workers Cache/CDN 边缘缓存存在。
- 不支持把完整 ZIP 上传到 Worker/R2 后再由服务端解包导入；导入固定采用浏览器预索引。
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

把核心独有文件按 ArchiveVersion 打成 core pack：

```text
core-packs/sha256/ab/cd/abcdef...7890.zip
```

然后 D1 记录每个逻辑文件的实际来源：

```text
archive_version_file:
  archive_version_id = 123
  path = "CharSet/Actor01.png"
  file_sha256 = "abcdef...7890"
  storage_kind = "blob"
  blob_sha256 = "abcdef...7890"

archive_version_file:
  archive_version_id = 123
  path = "Map0001.lmu"
  file_sha256 = "123456...7890"
  storage_kind = "core_pack"
  core_pack_id = 456
  pack_entry_path = "Map0001.lmu"
```

也就是说，游戏文件路径和实际存储对象分离。静态素材可以被许多游戏、许多路径引用；核心文件则通过 core pack 减少下载时的对象读取次数。

### 2.3 Core pack 是下载成本优化层

Core pack 的定位是：把某个 ArchiveVersion 独有、但数量较多的小文件合并成一个 R2 对象。它主要优化 R2 Class B 读操作和 Worker subrequest 数量。

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

### 2.4 上传端固定使用浏览器预索引

系统不接受完整 ZIP 上传到 Worker/R2 后再由服务端解包。用户可以选择本地文件夹，也可以选择本地 ZIP，但 ZIP 必须在浏览器端读取和索引，不能作为完整游戏包上传到后端。

固定流程是：

1. 浏览器读取本地文件夹或本地 ZIP。
2. 浏览器计算每个文件的 `sha256`、大小、路径。
3. 前端按规则分类 core 文件、asset 文件、runtime 文件和 excluded 文件。
4. 前端生成 core pack。
5. 前端把 manifest 发给后端做 preflight。
6. 后端查询 D1，返回“哪些 asset/runtime blob 已存在，哪些缺失”。
7. 前端只上传缺失 asset/runtime blob 和本次 ArchiveVersion 的 core pack。
8. 后端写入 Work、Release、ArchiveVersion、core pack 和文件索引。

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
- 大型下载优先命中 Workers Cache/CDN 边缘缓存，或进入异步下载/排队流程；任何完整游戏 ZIP 都不能写入 R2。
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
- 下载重组 ZIP 时，如果一个 ArchiveVersion 需要读取 2000 个 R2 blob，就是约 2000 次 Class B 读操作。
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

### 3.3 Workers Cache / CDN 边缘缓存

Workers Cache 可以缓存 Worker 生成的 `Response`，适合存放“可重新生成、丢失也不影响数据完整性”的下载 ZIP。

约束：

- 边缘缓存不是 R2，不是 canonical storage，也没有可承诺的长期保留时间。
- 缓存通常是 data center-local，不保证一次生成后全球所有地区都命中。
- 缓存对象可能被 Cloudflare 驱逐；缓存未命中时必须能从 manifest、core pack 和 blob 重新生成 ZIP。
- 实现前应重新确认当前计划下 CDN/Cache API 的单对象大小限制；超过限制的 ZIP 只能流式返回，不写入边缘缓存。

影响：

- 热门下载优先使用 Workers Cache/CDN 边缘缓存降低重复 R2 Get 和 Worker CPU。
- 边缘缓存只能作为性能优化层，不能作为存储层。
- 因为完整游戏 ZIP 不进入 R2，缓存命中率不足时只能通过 core pack、下载排队、限流和后续打包策略优化 Class B 成本。

### 3.4 D1

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
Series
  系列、合集、企划或世界观集合。一个作品可以属于多个系列。

Work
  作品本身，是公开游戏资料页和搜索页的主要对象。

Release
  作品的一次公开发布、汉化、修正、活动投下或特定语言版本。

ArchiveVersion
  本站实际归档的一份可下载文件快照，由 manifest + blob + core pack 重建。

Blob
  一个独立文件内容，通常是可复用静态资源或需要单独管理的运行时文件，由 sha256 标识，存放在 R2。

CorePack
  一个核心文件包，由 sha256 标识，存放在 R2，包含某个 ArchiveVersion 的地图、数据库等独有小文件。

ArchiveVersionFile
  某个归档快照中的文件路径索引，指向 Blob 或 CorePack 内的 entry。
  路径只属于 manifest / 文件清单，不属于静态资源 blob。

ImportJob
  一次导入任务，用于追踪上传、校验、索引、发布状态。

DownloadBuild
  一次下载重组、异步下载或边缘缓存预热任务；不对应 R2 中的完整游戏 ZIP。
```

### 4.2 正式 D1 表族

正式游戏领域模型固定为 `works`、`releases`、`archive_versions` 三层。完整领域说明见 [游戏领域架构设计](./game-domain-architecture.md)，当前初始 schema 见 `migrations/0001_init_archive_schema.sql`。

核心表族：

- 作品资料：`works`、`work_titles`、`series`、`work_series`、`work_relations`。
- 发布资料：`releases`、`release_staff`、`release_events`、`release_tags`、`release_external_links`。
- 归档快照：`archive_versions`、`archive_version_files`。
- 可扩展资料：`characters`、`work_characters`、`creators`、`work_staff`、`events`、`tags`、`work_tags`。
- 媒体和来源：`media_assets`、`work_media_assets`、`release_media_assets`、`work_external_links`。
- 存储对象：`blobs`、`core_packs`、`import_jobs`、`download_builds`。

长期边界：

- `Work` 管“这是什么作品”。
- `Release` 管“这次公开发布是什么版本”。
- `ArchiveVersion` 管“本站实际保存了哪份文件快照”。
- `archive_version_files` 和 manifest 管路径；`blobs` 只管内容，不管文件名。
- `download_builds` 指向 `archive_versions`。

### 4.3 字段说明

- `works.slug`：公开 URL 用，例如 `/games/yume-nikki-viprpg-demo`。
- `works.primary_title`：站内主要展示名。
- `works.original_title`：作品原名。
- `work_titles`：保存译名、别名、罗马字、缩写等可搜索标题。
- `series`、`work_series`：系列和作品成员关系。
- `work_relations`：前作、后作、外传、同世界观、重制版等作品关系。
- `releases.release_label`：玩家可识别的发布版本名，例如原版、汉化版、修正版。
- `releases.release_type`：发布类型，例如 `original`、`translation`、`revision`、`event_submission`。
- `releases.uses_maniacs_patch`、`releases.is_proofread`、`releases.is_image_edited`：属于发布版本的布尔元数据。
- `archive_versions.manifest_sha256`：对规范化 manifest JSON 计算哈希，用来判断文件快照是否变化。
- `archive_versions.manifest_r2_key`：manifest 在 R2 中的实际对象位置。
- `archive_versions.file_policy_version`：生成 manifest 时使用的强制白名单版本。
- `archive_versions.total_files`、`archive_versions.total_size_bytes`：进入 canonical manifest 的白名单内文件数和归档大小。
- `archive_versions.unique_blob_size_bytes`：本归档快照需要新增的 blob 大小统计，不包含已存在 blob。
- `archive_versions.core_pack_size_bytes`：本归档快照 core pack 在 R2 中的压缩后大小统计。
- `archive_versions.estimated_r2_get_count`：下载重组预计 R2 Get 次数。
- `archive_version_files.path`：下载重建时的相对路径。
- `archive_version_files.path_bytes_b64`：预留字段；是否保存 ZIP 内原始文件名字节，等最小实现阶段分析真实样本后决定。
- `archive_version_files.role`：文件角色，例如 `map`、`database`、`asset`、`runtime`、`metadata`。
- `archive_version_files.file_sha256`：逻辑文件本身的 SHA-256，不管该文件来自 blob 还是 core pack。
- `archive_version_files.storage_kind`：逻辑文件的物理来源，`blob` 表示直接读取独立 blob，`core_pack` 表示从核心文件包内读取。
- `archive_version_files.pack_entry_path`：core pack 内部 entry 路径，用于下载重组时定位文件。
- `users.role_key`：账户层级，固定为 `super_admin`、`admin`、`uploader`、`user`。权限权重使用宽间隔数值：`user = 100`、`uploader = 400`、`admin = 700`、`super_admin = 1000`，数值越大权限越高，便于未来在中间插入新层级。
- 上传权限由角色推导：`role_key >= uploader` 可以上传，`role_key >= admin` 可以进入用户管理。
- 角色调整必须满足：操作者权重大于目标当前角色，且操作者权重大于目标新角色；操作者不能调整自己。
- `inbox_items`：站内信和行动项。上传者权限申请不再是独立审批字段，而是 `role_change_request` 类型站内信。
- `inbox_item_reads`：按用户记录站内信已读状态；所有站内信入口应显示当前用户未读角标，并支持一键将可见未读项标记为已读。
- `user_role_events`：角色调整审计日志。站内信负责通知和待办展示，审计表负责长期追踪。
- `users.password_hash`：正式账户体系的密码摘要；必须使用带盐、可迁移参数的密码哈希格式，不能保存明文或可逆加密密码。
- `users.email_verified_at`：正式账户体系必须在邮箱验证通过后写入；仅有未验证邮箱不能获得上传能力。
- `email_verification_challenges.code_hash`：只保存注册和找回密码验证码的服务端 HMAC/hash，不保存明文验证码。
- `email_verification_challenges.pending_password_hash`：注册流程中临时保存已哈希的新密码；验证码验证通过后转入 `users.password_hash`，过期 challenge 应清理。
- `user_sessions.session_hash`：正式实现若需要撤销单个会话，session cookie 中只保存随机 session token，D1 中保存 hash 和撤销状态。
- `blobs.sha256`：独立文件内容的主键。
- `blobs.r2_key`：独立文件 blob 的实际 R2 对象位置。
- `core_packs.sha256`：核心文件包自身的内容主键。
- `core_packs.r2_key`：核心文件包的实际 R2 对象位置。
- `import_job_excluded_file_types`：按文件类型记录白名单外排除统计和示例路径，供上传者和管理员审计。
- `download_builds.cache_key`：Workers Cache/CDN 边缘缓存 key，只用于命中可丢弃缓存，不是 R2 对象路径。

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
    sha256/
      ab/
        cd/
          abcdef...7890.json
```

说明：

- `blobs/` 是可复用静态资源和独立运行时文件的长期主存储。
- `core-packs/` 是核心文件包的长期主存储，用于减少下载重组时的 R2 读取次数。
- `manifests/` 存完整规范化 manifest，便于导出、审计、备份。
- R2 bucket 中不设置任何完整游戏 ZIP 的缓存路径或原包暂存路径。
- 校验失败的上传对象直接拒绝或标记导入任务失败，不进入长期 R2 存储。

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

Manifest key 生成规则：

```ts
function manifestKey(sha256: string) {
  return `manifests/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.json`;
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

Core pack 固定采用“每个 ArchiveVersion 一个核心包”的粒度。也就是说，一个归档快照内的 `RPG_RT.ldb`、`RPG_RT.lmt`、`RPG_RT.ini` 和 `Map*.lmu` 一起打包。初版不做按类型或地图编号范围分组。

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

Manifest 是一个 ArchiveVersion 的完整文件清单。它应当可单独导出，并足以重建目录树。

示例：

```json
{
  "schema": "viprpg-archive.manifest.v1",
  "work": {
    "slug": "sample-game",
    "title": "Sample Game"
  },
  "release": {
    "label": "1.0",
    "type": "original"
  },
  "archiveVersion": {
    "label": "initial-import",
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
用户选择游戏文件夹或本地 ZIP
  -> Worker 校验用户角色为 uploader/admin/super_admin
  -> 浏览器枚举文件
  -> 浏览器按强制白名单区分 included/excluded
  -> 浏览器计算 sha256/size/path
  -> 浏览器按规则分类 core/asset/runtime/excluded
  -> 浏览器生成 core pack
  -> POST /api/imports/preflight
  -> Worker 查询 D1 blobs 和 core_packs
  -> 返回 missing asset/runtime blobs 和 missing core packs
  -> 浏览器只上传缺失 asset/runtime blobs 和 core pack
  -> Worker 校验并写入 R2 blobs/core-packs
  -> POST /api/imports/{id}/commit
  -> Worker 写入 works、releases、archive_versions、core_packs 和 archive_version_files
  -> 写入 draft 或发布状态
```

优点：

- 重复素材不重复上传。
- 核心文件包只上传一次，并在下载重组时只产生一次 R2 读取。
- Worker 不需要解完整 ZIP。
- 更容易做分块、断点续传、进度显示。

注意：

- 上传接口只允许 `uploader`、`admin`、`super_admin` 调用，`uploader_id` 由服务端自动记录。
- 不设置固定的单游戏文件数或大小硬上限；大型导入通过后台任务、分块提交、可恢复状态和管理端配额控制风险。
- 导入前必须显示原目录大小、白名单内归档大小、白名单外排除大小、预计新增 R2 存储和预计下载 R2 Get 次数。
- 浏览器端 hash 只能作为预检依据，后端仍要验证上传内容。
- 对单个小文件，可由 Worker 接收上传流并计算 SHA-256 后写入 R2。
- Core pack 上传后，后端至少要校验 pack 自身 SHA-256、文件数量、未压缩大小、entry 路径和 manifest 是否一致。
- 对大文件，可使用分片上传或客户端直传，但目标仍然只能是缺失 blob 或 core pack，不能是完整游戏包。

### 8.2 不支持的导入方式

明确不支持：

- 把完整游戏 ZIP 上传到 Worker 后解包。
- 把完整游戏 ZIP 暂存到 R2。
- 后台任务读取完整 ZIP 再拆分为 blob/core pack。
- 管理员通过上传原包绕过浏览器预索引。

管理员批量导入旧资源时，也应使用同一套浏览器预索引流程；不能把原始完整 ZIP 写入 R2。

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

Core pack 是一个版本核心文件集合，由浏览器先生成，再上传给 Worker。

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
GET /api/archive-versions/{archiveVersionId}/download
  -> 查询 archive_version_files
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
- 实时下载前必须估算 R2 Get 次数、Worker subrequest、预计输出大小和是否适合边缘缓存；接近限制时进入异步下载/排队流程，不写入 R2 完整 ZIP。

### 10.2 Workers Cache / CDN 边缘缓存

```text
GET /downloads/{archive_version_id}/{manifest_sha256}/{packer_version}.zip
  -> caches.default.match(cache_key)
  -> 命中则直接返回缓存响应
  -> 未命中则流式重组 ZIP
  -> 适合缓存时 caches.default.put(cache_key, response.clone())
```

策略：

- URL 必须包含 `manifest_sha256` 和 `packer_version`，保证缓存 key 不可变。
- 第一次下载直接重组；如果响应大小和请求条件适合缓存，则写入 Workers Cache/CDN 边缘缓存。
- 后续同一边缘节点命中缓存时，不再读取 R2 core pack 和 blob。
- 缓存未命中或被驱逐时，重新按 manifest 重组。
- 大于当前 CDN/Cache API 单对象限制的 ZIP 直接流式返回，不尝试边缘缓存。

权衡：

- 不增加 R2 storage，也不破坏 canonical 数据模型。
- 缓存不保证持久、不保证全球同步，不能作为唯一可用的下载来源。
- 热门游戏下载可以减少大量 R2 Class B 操作和 CPU，但命中率需要通过日志观察。

建议默认：

- 所有可缓存下载响应都使用不可变 URL 和长 `Cache-Control`。
- 小众版本只依赖自然缓存命中，不做额外预热。
- 热门版本可以做边缘缓存预热或下载排队优化，但不写入 R2 完整 ZIP。

## 11. API 草案

### 11.1 导入

```text
POST /api/imports
  创建导入任务；要求 uploader/admin/super_admin

POST /api/imports/{id}/preflight
  输入文件 hash manifest 和上传元数据
  输出已存在/缺失 blob 和 core pack 列表

PUT /api/blobs/{sha256}
  上传单个缺失 blob

PUT /api/core-packs/{sha256}
  上传单个缺失 core pack

POST /api/imports/{id}/commit
  写入 Work、Release、ArchiveVersion、core pack、文件索引、manifest

GET /api/imports/{id}
  查看导入进度和错误
```

### 11.2 作品、发布和归档快照

```text
GET /api/works
GET /api/works/{id}
POST /api/works
PATCH /api/works/{id}

GET /api/series
POST /api/series
PATCH /api/series/{id}
POST /api/series/{id}/works

POST /api/works/{id}/relations
DELETE /api/work-relations/{relationId}

GET /api/works/{id}/releases
POST /api/works/{id}/releases
PATCH /api/releases/{id}

POST /api/releases/{id}/archive-versions
PATCH /api/archive-versions/{id}
POST /api/archive-versions/{id}/publish
POST /api/archive-versions/{id}/make-current
```

### 11.3 下载

```text
GET /api/archive-versions/{archiveVersionId}/download
GET /api/downloads/{downloadBuildId}
POST /api/archive-versions/{archiveVersionId}/download-jobs
POST /api/archive-versions/{archiveVersionId}/warm-edge-cache
```

### 11.4 管理

```text
GET /api/admin/blobs/{sha256}/references
GET /api/admin/core-packs/{sha256}/references
GET /api/admin/users
POST /api/admin/users/{userId}/role
GET /api/inbox
POST /api/inbox/{itemId}/resolve
POST /api/inbox/{itemId}/read
POST /api/inbox/read-all
POST /api/admin/gc/mark
POST /api/admin/gc/sweep
```

## 12. 前端导入界面

导入界面需要支持：

- 仅 `uploader`、`admin`、`super_admin` 可进入上传流程；普通用户通过站内信提交上传者角色申请。
- 选择文件夹。
- 选择本地 ZIP，并在浏览器端解包预索引；完整 ZIP 不上传到 Worker/R2。
- 显示原目录文件数和大小、白名单内归档文件数和大小、白名单外排除文件数和大小、已存在大小、需上传大小、预计节省空间。
- 显示核心文件检测结果：`RPG_RT.ldb`、`RPG_RT.lmt`、`Map*.lmu`。
- 显示 core pack 文件数、压缩前大小、压缩后大小、预计减少的 R2 读取次数。
- 显示运行时文件统计：`exe`、`dll`、补丁程序作为普通独立 blob 保留。
- 显示白名单外文件类型汇总和示例路径。
- 对预计下载 R2 Get 次数很高的版本提示下载成本风险，并建议启用边缘缓存观察、排队下载或后续打包策略优化。
- 支持中断后继续上传缺失 blob 和 core pack。
- commit 前必须选择或创建 Work 和 Release，并填写对应元数据：原名、译名、作者、原作发布日期、标签文本、图标、浏览图、简介、是否使用 Maniacs Patch、是否校对、是否修图。
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
- 同一版本中如果出现仅大小写不同的路径，应进入人工确认或导入失败并提示上传者修正。

## 14. 删除和垃圾回收

不要在删除 ArchiveVersion 时立即删除 blob 或 core pack。因为 blob 可能被其他归档快照引用，core pack 也可能被多个归档快照复用。

推荐流程：

1. 删除 ArchiveVersion 只做软删除，`archive_versions.status = 'deleted'`。
2. GC mark：扫描所有非 deleted/purged 归档快照引用的 blob 和 core pack。
3. GC sweep：找出未被引用的 blob/core pack，且超过宽限期。
4. 删除 R2 blob 和 R2 core pack。
5. 将 D1 `blobs.status`、`core_packs.status` 改为 `purged` 或删除记录。

宽限期建议：

```text
7 至 30 天
```

原因：

- 防止误删。
- 给数据库备份、恢复和人工复核留时间。

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
storage_dedup = sum(unique_blob_size) + sum(core_pack_size) + sum(manifest_size)
```

完整游戏 ZIP 不进入 R2，因此不作为 R2 storage 成本项。Workers Cache/CDN 边缘缓存是可丢弃缓存，不纳入 canonical 存储容量模型。

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
- Core pack 上传：每个 ArchiveVersion 通常 1 次 R2 Put，属于 Class A。
- 已存在 blob/core pack 不需要 R2 Put。
- 完整游戏 ZIP 不上传到 Worker/R2，不产生原包暂存的 R2 存储和删除流程。

下载一个包含 1000 个文件的游戏：

- 未使用 core pack 的逐文件重组：约 1000 次 R2 Get，属于 Class B。
- 使用 core pack 后：约 `1 + asset_blob_count + runtime_blob_count` 次 R2 Get。
- Workers Cache/CDN 边缘缓存命中：不读取 R2；未命中则按上一条重新读取 core pack 和 blob。

结论：

- 去重可以显著降低 storage。
- Core pack 可以降低核心小文件带来的 Class B 操作。
- 但“按素材 blob 重组下载”仍会增加 Class B 操作。
- 热门游戏需要尽量命中 Workers Cache/CDN 边缘缓存，否则下载量上来后 Class B 操作会成为主要成本。
- 大型或高热度游戏不能通过完整 ZIP R2 缓存兜底，应优先观察边缘缓存命中率、优化 core pack/打包策略，并配合下载排队和运营限流。

## 16. 安全和版权策略

### 16.1 运行时文件

原包中的 `RPG_RT.exe`、DLL 和补丁程序完整保留。它们作为普通独立 blob 存储，不进入 core pack，也不做额外运行时策略。

建议：

- `RPG_RT.ini` 进入 core pack。
- `exe`、`dll` 文件按原路径进入最终下载包，并作为普通独立 blob 存储。
- 安全风险主要通过上传权限控制，而不是对运行时文件做额外内容分级。

### 16.2 RTP 和素材版权

RTP 和第三方素材可能有授权限制。去重存储不改变版权责任。

建议：

- 为资源来源建立 metadata。
- 对官方 RTP 资源考虑“需要用户自备 RTP”的下载模式。
- 对无法确认授权的资源保留后台可见，不进入公开下载。

### 16.3 滥用防护

- 上传接口需要登录和权限；`uploader`、`admin`、`super_admin` 可上传，普通用户必须先通过站内信申请调整为 `uploader`。
- 单用户每日上传大小限制。
- 单用户、单时间窗口、单队列的运营配额和并发限制。
- 强制白名单文件类型和路径校验。
- 大型导入进入后台队列，失败可恢复，不要求单次 Worker 请求完成。
- 记录 `uploader_id` 和 `uploaded_at`，便于追踪和回收。

### 16.4 账户、验证码和发信

当前实现中的“输入邮箱即登录”只能作为 Phase B 权限壳，不作为正式账户体系。正式账户体系固定为密码登录：

- 常规登录使用邮箱 + 密码，不发送验证码，不使用 magic link。
- 验证码只用于注册邮箱验证和找回密码；不作为日常登录的第二种入口，避免登录状态、验证码状态和密码状态之间产生竞态。
- 注册和找回密码验证码有效期建议 10 分钟；同一 challenge 消费后立即失效。
- 单个 challenge 最多允许 5 次验证尝试；超过后要求重新发起注册或找回密码流程。
- 登录接口需要按邮箱、IP/UA 指纹做失败次数限制；连续失败后写入 `failed_login_count` 和 `locked_until`，短窗口可用 Workers Rate Limiting binding 辅助。
- 注册、找回密码、重发验证码表单必须接入 Turnstile，并在 Worker 端调用 Siteverify 校验；常规密码登录可在失败次数较多时再要求 Turnstile。
- 密码必须服务端哈希后保存。哈希字符串需要包含算法、参数、盐和摘要，便于后续提升参数或迁移算法；不能保存明文密码、可逆加密密码或裸 SHA-256。当前 Workers Web Crypto 对 PBKDF2 iteration 存在运行时上限，初版固定为 PBKDF2-SHA256 100000 次迭代。
- 发信优先使用 Cloudflare Email Service 的 Workers Email binding，但前提是账户已经启用 Email Sending，并完成发送域验证；Cloudflare Email Routing/Email Workers 只适合转发或发送到已验证目标地址，不能作为公开注册验证码的发信方案。
- 若 Cloudflare Email Service 当前账户不可用、无法向任意收件人投递，或后续投递率/模板/运营能力不足，应切换到 Resend、Postmark 等事务邮件服务。
- 邮件发件域必须使用项目自有域名；`EMAIL_FROM` 固定为已验证 sender，不允许请求参数覆盖发件人。
- 注册邮件包含验证码、过期时间、安全提示和返回注册验证页的回调链接；找回密码邮件包含验证码、过期时间、安全提示和返回密码重置页的回调链接。回调链接只用于把用户带回输入验证码的页面，不在 URL 中携带明文验证码或等价 token。
- 邮件回调链接必须基于配置项 `APP_ORIGIN` 生成，不能直接信任请求的 `Host` header，避免 Host header injection 影响邮件链接。
- 邮件不包含上传权限审批状态等后台信息；发码成功页需要提示用户检查垃圾邮件/广告邮件，并确认 `EMAIL_FROM` 发件人未被拦截。
- 邮箱验证只证明账户归属，不等于上传权限；新注册用户默认为 `user`。
- 管理员 bootstrap 仍可使用 `BOOTSTRAP_ADMIN_EMAIL`，但语义固定为初始超级管理员；该邮箱首次完成验证或登录时提升为 `super_admin`。正式系统中该邮箱也应设置密码并完成邮箱验证，bootstrap 不绕过长期登录安全。

注册流程：

```text
用户提交邮箱 + 密码 + Turnstile token
  -> Worker 调用 Turnstile Siteverify
  -> Worker 校验密码强度和邮箱可用性
  -> Worker 哈希密码，生成 6 位验证码
  -> D1 写入 email_verification_challenges(code_hash, pending_password_hash)
  -> Email binding 发送注册验证码
  -> 用户输入验证码
  -> Worker 校验 hash、过期时间、尝试次数和 consumed_at
  -> 创建或激活 users，写入 password_hash、email_verified_at 和 last_login_at
  -> 签发 session cookie
```

找回密码流程：

```text
用户提交邮箱 + Turnstile token
  -> Worker 调用 Turnstile Siteverify
  -> Rate Limiting binding 校验短窗口发送频率
  -> D1 校验邮箱/IP 长窗口发送频率
  -> 生成 6 位验证码并写入 email_verification_challenges(code_hash)
  -> Email binding 发送找回密码验证码
  -> 用户提交邮箱 + 验证码 + 新密码
  -> Worker 校验验证码状态和新密码强度
  -> Worker 更新 users.password_hash、password_updated_at，清空 failed_login_count/locked_until
  -> 撤销该用户已有 session 或要求重新登录
```

正式 session 策略：

- 初期可以继续使用签名 HTTP-only cookie，但 cookie payload 不应长期保存过多用户信息。
- 如果需要“退出所有设备”“撤销单个登录”“查看登录记录”，改为随机 session token + `user_sessions.session_hash`。
- Cookie 必须设置 `HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`；生产环境禁止非 HTTPS cookie。
- 管理员操作和上传提交必须重新从 D1 读取用户状态，不能只相信 cookie 中的旧角色。

### 16.5 用户层级和站内信

账户层级固定为四级：

| 角色 | 权重 | 能力 |
|---|---:|---|
| `super_admin` | 1000 | 管理 `admin`、`uploader`、`user`，可上传 |
| `admin` | 700 | 管理 `uploader`、`user`，可上传 |
| `uploader` | 400 | 可上传和导入游戏 |
| `user` | 100 | 普通账户，可申请成为上传者 |

规则：

- 权重越大权限越高；数值保留间隔，未来可以加入 `moderator = 600` 等中间层级。
- 管理清单只展示低于当前操作者层级的用户。
- 操作者只能把目标调整为低于自己层级的角色，不能调整自己。
- 超级管理员不能通过后台被创建或提升；新增超级管理员必须走 bootstrap 或一次性运维迁移。
- 上传者权限申请通过站内信 `role_change_request` 表达，不再维护独立的 `pending/approved/rejected` 上传审批字段。
- 角色调整成功后写入 `user_role_events`，并向目标用户发送 `role_change_notice` 站内信，说明操作者、旧层级和新层级。
- 申请被驳回时也发送站内信通知；站内信不是审计日志的替代品。
- 首页、管理页和站内信页的站内信入口显示未读角标；站内信页提供“一键已读”，只标记当前用户可见的未读项。

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
- 实现 `blobs`、`core_packs`、`works`、`releases`、`archive_versions`、`archive_version_files`。
- 实现 `users.role_key`、站内信和角色事件，支持四层角色与上传者申请。
- 实现管理端浏览器预索引导入路径。
- 固定强制白名单和 `file_policy_version`。
- 实现 core pack 生成、manifest 生成和 R2 保存。
- 记录白名单外文件类型汇总、排除大小和示例路径。

暂不做：

- 在线 ZIP 重组。
- 边缘缓存优化。

### Phase 2：浏览器预索引上传

目标：`uploader`、`admin`、`super_admin` 可以通过网页导入游戏。

任务：

- 将 Phase B 临时邮箱登录替换为密码登录；验证码只用于注册和找回密码。
- 实现普通用户通过站内信申请上传者角色，管理员或超级管理员在站内信中处理申请。
- 前端选择文件夹或本地 ZIP；ZIP 只在浏览器端解包预索引。
- 浏览器计算 SHA-256。
- 浏览器生成 core pack。
- Preflight 查询已有 blob 和 core pack。
- 只上传缺失 blob 和 core pack。
- Commit Work 元数据、Release 元数据和 ArchiveVersion 归档快照。
- 上传表单包含原名、译名、作者、原作发布日期、标签文本、图标、浏览图、简介、Maniacs Patch、校对、修图、引擎版本、来源链接/出处、语言、发布状态、可执行入口、版权/授权备注。
- 服务端自动写入 `uploader_id` 和 `uploaded_at`。
- 展示节省空间。
- 展示白名单外排除统计和预计下载 R2 Get 次数。

### Phase 3：下载重组

目标：用户可以下载重建后的 ZIP。

任务：

- 实现 manifest 查询。
- 实现 R2 core pack stream 和 blob stream 到 ZIP stream。
- 下载前估算 R2 Get 次数、Worker subrequest、预计输出大小和是否适合 Workers Cache/CDN 边缘缓存。
- 大型版本或预计读取对象过多时转入异步下载/排队流程，不在单个 Worker 请求中强行实时重组，也不写入 R2 完整 ZIP。

### Phase 4：缓存和成本优化

目标：控制热门下载的 Class B 操作和 Worker CPU。

任务：

- 记录下载次数。
- 使用不可变下载 URL 和 `Cache-Control` 支持 Workers Cache/CDN 边缘缓存。
- 记录边缘缓存命中率、重组耗时、R2 Get 次数和失败原因。
- 对热门版本提供边缘缓存预热和下载排队优化。
- 明确禁止把完整游戏下载 ZIP 写入 R2。

### Phase 5：账户通知、删除和 GC

目标：系统长期可维护。

任务：

- 完善 `email_verification_challenges`、`user_sessions` 和 `auth_audit_logs`。
- 支持 session 撤销、禁用用户和登录审计。
- 站内信通知、角色申请处理和角色调整审计。
- ArchiveVersion 软删除。
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

- 导入 ZIP 时只在浏览器端读取、解包和预索引，不上传完整 ZIP。
- Core pack 优先在浏览器生成，使用 ZIP 低压缩等级，Worker 负责校验和入库。
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
    works/
    releases/
    archive-versions/
    downloads/
```

R2/D1 bindings 通过 Cloudflare 环境注入。服务层封装：

```text
lib/server/storage/blob-store.ts
lib/server/storage/core-pack-store.ts
lib/server/storage/manifest-store.ts
lib/server/db/works.ts
lib/server/db/releases.ts
lib/server/db/archive-versions.ts
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
- 实时下载前做成本预估；接近 Worker subrequest 或 CPU 风险时，改为异步下载/排队流程。
- 热门或大型版本优先提高 Workers Cache/CDN 边缘缓存命中率，并根据日志评估是否需要调整 core pack 或后续引入额外打包层；不使用完整 ZIP R2 缓存。

### 19.3 路径编码导致游戏无法运行

应对：

- 初版先用真实样本分析非 UTF-8 ZIP 文件名，再决定是否启用 `path_bytes_b64`。
- 内部始终保存规范化 UTF-8 路径。
- 对乱码路径或仅大小写不同的路径进入人工确认。

### 19.4 ZIP 重组 CPU 过高

应对：

- 默认 STORE。
- Core pack 解包和最终 ZIP 写入都采用 streaming。
- 热门版本优先命中 Workers Cache/CDN 边缘缓存。
- 大型版本进入异步下载/排队流程，必要时提示管理员优化打包策略。

### 19.5 Core pack 粒度导致跨版本重复存储

应对：

- 固定接受“每个 ArchiveVersion 一个 core pack”的重复，换取实现简单和下载读操作更少。
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
- 用户层级：`super_admin = 1000`、`admin = 700`、`uploader = 400`、`user = 100`；上传权限由角色推导，`uploader` 及以上可上传。
- 上传者申请：普通用户通过站内信创建 `role_change_request`，管理员或超级管理员处理后生成角色事件和通知。
- 规模限制：不设置固定的单游戏文件数或大小硬上限；通过强制白名单、导入队列、分块提交、下载成本预估、边缘缓存、下载排队和运营限流控制风险。
- 文件类型策略：使用单一强制白名单，白名单外文件不进入 canonical manifest；每次导入记录 `file_policy_version` 和排除统计。
- 导入方式：只支持浏览器预索引；本地 ZIP 可以被浏览器读取和索引，但完整 ZIP 不能上传到 Worker/R2，也不能作为临时对象进入 R2。
- 完整游戏下载 ZIP：R2 不保存任何完整游戏 ZIP；最终 ZIP 只能作为响应流或可丢弃的 Workers Cache/CDN 边缘缓存存在。
- Canonical 数据：长期数据只保留 manifest、blob、core pack 和元数据。
- 版本策略：完全不做差量发布或版本继承；下一阶段按 Work / Release / ArchiveVersion 拆分，详见游戏领域架构设计。
- Core pack 粒度：每个 ArchiveVersion 固定一个 core pack，不做按类型或地图编号范围分组。
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
4. 实现四层用户角色、站内信申请和角色调整审计。
5. 做导入页面，支持“文件夹/本地 ZIP + 浏览器预索引”，并执行强制白名单；完整 ZIP 不上传到 Worker/R2。
6. 上传表单写入完整检索元数据，服务端自动记录上传者和上传时间。
7. 导入时记录白名单外文件类型汇总、排除大小、示例路径和 `file_policy_version`。
8. 导入时生成一个 ArchiveVersion 级 core pack，并写入 manifest。
9. 做 manifest 写入和游戏详情页。
10. 做下载重组，并在下载前估算 R2 Get 次数。
11. 对大型或热门版本实现 Workers Cache/CDN 边缘缓存命中统计、预热和下载排队。
12. 统计 core pack 后的实际 Class B 读取次数，并根据下载日志调整缓存策略。

这条路线的优点是：先验证是否真的省空间，再逐步把复杂度加上去，不会一开始就陷入 ZIP 编码、后台任务和缓存策略的细节。

## 22. 参考链接

- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers Cache API: https://developers.cloudflare.com/workers/runtime-apis/cache/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Cloudflare Email Service Workers API: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- Cloudflare Workers Rate Limiting binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
