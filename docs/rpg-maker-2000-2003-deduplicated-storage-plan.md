# RPG Maker 2000/2003 去重存储架构

本文定义归档文件进入 R2、D1、下载流和垃圾回收时必须保持的稳定边界。作品资料和 ArchiveVersion 关系见[游戏领域架构](./game-domain-architecture.md)，在线游玩本地安装见[EasyRPG 架构](./easyrpg-web-play-architecture.md)，Cloudflare 环境操作见[OpenNext 与 Cloudflare 运行手册](./opennext-cloudflare-development-path.md)。

认证、角色和授权只以[认证与权限基线](./authentication-authorization-baseline-plan.md)为准；本文不复制 permission key 或端点清单。

## 1. 目标与非目标

目标：

- 相同内容只保存一次，并用 SHA-256 证明对象身份。
- 保留每个 ArchiveVersion 的完整路径、文件顺序、大小、CRC32 和来源映射。
- 上传、下载、在线游玩和 GC 共用同一套 canonical 对象。
- D1 可判断对象引用、状态和成本，但不复制完整文件目录。
- 任何缺失、损坏或不一致都显式失败，不静默降级为不完整归档。

非目标：

- 不把完整游戏 ZIP、源 ZIP 或上传暂存包保存到 R2。
- 不以文件名、R2 key、ETag 或数据库自增 ID 作为内容身份。
- 不让 D1 成为第二份 manifest。
- 不为网页在线游玩生成另一套 ZIP 或 canonical 文件。
- 不保留已废弃的文件行模型、旧对象路径或兼容写入。

## 2. Canonical 对象

```text
ArchiveVersion
  -> Manifest (一个不可变 JSON)
       -> Blob refs
       -> CorePack refs

R2
  blobs/sha256/...
  core-packs/sha256/...
  manifests/sha256/...

D1
  archive_versions
  blobs / core_packs
  archive_version_blob_refs
  archive_version_core_pack_refs
  import_jobs
  download_builds
```

### Blob

Blob 是按 SHA-256 寻址的单文件对象，主要承载图像、音频、视频、字体、运行时和其他可独立复用的内容。同一个 blob 可以在不同 ArchiveVersion 中以不同路径出现。

### CorePack

CorePack 是一个内容寻址的低压缩 ZIP，用于合并 RPG Maker 数据库、地图和 string script 等大量小核心文件，减少下载重组时的 R2 Get。它是成本优化层，不是新的作品或版本边界。

CorePack 内 entry 仍保留 manifest 路径。修改任一 entry 会产生新的 pack hash；旧 pack 只有在所有 ArchiveVersion 都不再引用后才能清理。

### Manifest

Manifest 是 ArchiveVersion 文件清单的唯一事实来源。当前结构由 `lib/archive/manifest.ts` 的 `ArchiveManifest` 定义，至少包含：

- schema、作品摘要和归档元数据；
- 文件策略与打包器版本；
- 源文件、纳入文件和排除文件统计；
- core pack 的 hash、大小和 entry 数；
- 每个文件的规范化路径、排序键、可选原始路径字节、角色、SHA-256、CRC32、大小、mtime 和 storage mapping。

Manifest 自身按规范 JSON 字节计算 SHA-256。`archive_versions.manifest_sha256` 指向该内容，R2 key 由 hash 派生，不在 D1 另存可变路径。

## 3. 对象键与身份

R2 key 只由 `lib/server/storage/archive-keys.ts` 生成：

- `blobKey(sha256)`
- `corePackKey(sha256)`
- `manifestKey(manifestSha256)`

规则：

1. 接收上传时重新计算 SHA-256，不能信任 URL、header 或客户端声明。
2. R2 ETag 不参与内容身份或完整性判断。
3. 相同 hash 的重复上传是幂等操作；内容或长度不符必须拒绝。
4. D1 记录存在但 R2 对象缺失时标记不一致，不把它当作 existing 返回。
5. 下载和 commit 都从 hash 派生 key，业务代码不拼接 R2 路径。

## 4. 文件策略

文件纳入、角色分类、内容类型和 core pack 选择的唯一实现位于 `lib/archive/file-policy.ts`：

- `FILE_POLICY_VERSION`
- `classifyArchivePath`
- `normalizeArchivePath`
- `contentTypeForArchivePath`

策略只允许 RPG Maker 2000/2003 归档所需的数据库、地图、图像、音频、视频、字体、配置、文本和运行时类型。截图目录、根目录临时截图、`null.txt`、分卷压缩包和不在白名单中的类型不能进入 canonical 归档。

白名单是信任边界。修改规则时必须提升 `FILE_POLICY_VERSION`，扩展浏览器扫描和服务端 commit 校验，并用真实样本验证排除统计；不要在文档中复制扩展名清单。

### 路径与编码

- 路径统一为相对路径和 `/` 分隔，不允许盘符、绝对路径、空段或 `..` 越界。
- 逻辑冲突比较使用规范化排序键；原始路径显示或重建需要时保存 `pathBytesB64`。
- Windows 保留名、大小写冲突和 Unicode 规范化冲突必须在 commit 前拒绝或明确报告。
- 文件名只存在于 manifest 和本地安装索引，不写入 blob key 或 D1 对象表。

## 5. 上传流程

```text
选择文件夹或 ZIP
  -> 浏览器 Worker 枚举和规范化路径
  -> 应用文件策略并记录排除统计
  -> 计算每个文件的 SHA-256 与 CRC32
  -> 生成 core pack 和 manifest
  -> 创建 owned import job
  -> job-scoped preflight 查询 existing / missing
  -> 只上传 missing blob 和 core pack
  -> commit 校验对象、manifest 和元数据
  -> 原子创建或更新 Work，创建 ArchiveVersion 和引用
```

上传任务只在当前标签页会话中执行。服务端 `import_jobs` 记录授权、状态、阶段统计和失败位置，但不承诺浏览器重启后恢复本地文件或继续 Worker。

### Preflight

- 必须绑定当前用户拥有的 active import job。
- 只把 D1 状态有效且 R2 对象存在的 hash 视为 existing。
- 返回缺失对象及必要的上传统计，不接受客户端用 preflight 绕过实际 PUT 校验。

### 对象上传

- blob PUT 校验 hash、长度、owned job 和 preflight 预期。
- core pack PUT 校验外层 hash、ZIP 结构、entry 清单、解压大小和文件数。
- 上传成功后更新 D1 对象状态与 import job 统计；并发相同 hash 必须得到一致结果。
- 对象上传失败可以在同一任务仍有效时重试，已成功对象不重复写入。

### Commit

Commit 是发布引用的唯一边界：

1. 重新解析并验证 manifest schema、文件策略、路径、hash、CRC32 和 storage mapping。
2. 确认所有引用对象在 D1 与 R2 中可用。
3. 校验 Work 目标、上传者权限和 ArchiveVersion 元数据。
4. 在同一 D1 batch 中写入 Work 变更、ArchiveVersion、对象引用和 import job 结果。
5. 只有 commit 成功后，新归档才进入可管理的领域模型；失败不得留下半成品引用。

核心校验集中在 `lib/server/db/archive-commit.ts`，客户端生成结果不构成信任依据。

## 6. 下载重组

公开下载由 `worker/archive-download.mjs` 处理：

```text
published Work + published current ArchiveVersion
  -> 读取 manifest
  -> 并发打开 blob/core pack 对象
  -> 按 manifest 顺序输出 ZIP local header 和文件字节
  -> 写入中央目录
  -> 返回流式 ZIP
```

要求：

- 只允许完整 published 引用链；回收站、purged、draft 或 hidden 对象不能下载。
- 输出顺序由 manifest 固定，相同输入和 builder 版本产生稳定 cache key。
- ZIP 使用 STORE；local header 写入明确 CRC32、compressed size 和 uncompressed size，不依赖 data descriptor。
- 可以预取少量后续对象和缓存单次请求内重复的小 blob，但不能改变输出顺序或把完整 ZIP写回 R2。
- Workers Cache/CDN 是可丢弃派生缓存；`download_builds` 只记录 cache key 和观测数据，不拥有文件内容。
- 构建失败必须记录错误并中止响应，不能跳过缺失 entry 生成“可下载”的残缺 ZIP。

## 7. 在线游玩

在线游玩 fetch 与下载按钮相同的 ZIP URL。浏览器顺序解析 ZIP，把可运行文件写入 OPFS pack，并在完成后丢弃 ZIP；R2 和 D1 不新增 Web Play 文件副本。

本地安装的版本键、IndexedDB 状态、OPFS pack、Service Worker 桥、重试和存档策略由[EasyRPG 在线游玩架构](./easyrpg-web-play-architecture.md)定义。存储层只保证下载 ZIP 与 manifest 可验证且字节稳定。

## 8. 删除与垃圾回收

删除分为领域删除和对象清理：

1. ArchiveVersion 先进入 `deleted`，停止公开下载和游玩。
2. 宽限期内可以 restore；current 删除后由领域服务选择合法替代项。
3. purge 移除 ArchiveVersion 的 manifest 与引用，并记录 `purged_at`。
4. 只有引用计数为零且超过宽限期的 blob/core pack 才能进入 GC 候选。
5. sweep 使用 `active -> purging -> purged` 状态转换；R2 删除失败恢复为 active 并报告。

GC 实现位于 `lib/server/storage/admin-storage-checks.ts` 和 `worker/archive-gc.mjs`。最终 sweep 必须有权限、显式确认、固定批次上限和审计；dry-run 不得产生删除副作用。

禁止根据“某个目录看起来不用了”直接删除 R2 prefix，也禁止只查单个 ArchiveVersion 就判断共享对象无引用。

## 9. 安全与版权

- 上传、preflight、commit 和对象 PUT 都绑定当前用户及 owned import job。
- 文件类型白名单不等于内容安全；ZIP、路径、hash、大小和计数仍需独立验证。
- `.exe`、`.dll` 等运行时可以为离线归档保留，但在线游玩本地安装会跳过不需要的运行时文件。
- 来源属于 ArchiveVersion 元数据；系统不因技术上可去重就推断内容可分发。
- 媒体、下载和在线游玩入口只读取完整 published 引用链。
- 高成本操作必须有数量、大小或批次上限，并留下可查询的失败状态。

## 10. 必须保持的不变量

- 内容身份只有 SHA-256。
- 文件路径只由 manifest 持有。
- D1 只保存对象引用，不保存完整文件行副本。
- R2 不保存完整游戏 ZIP。
- Work 表示作品，ArchiveVersion 表示不可变文件快照。
- 发布后的 manifest 不原地修改；修正通过新 ArchiveVersion 完成。
- 对象只有在全局零引用且满足宽限期时才能清理。
- 未知文件策略、未知 manifest schema 或缺失对象一律失败。

## 11. 验证

变更归档链路时至少执行：

- `npm run check`
- `npm run build`
- `npm run check:domain`
- 本地 D1 reset/seed 后的上传、preflight 和 commit
- manifest SHA-256 与 R2 对象抽验
- 下载 ZIP entry、顺序、CRC32 和总大小验证
- GC consistency/dry-run；只有明确授权时运行 sweep
- 在线游玩安装后确认 OPFS 中没有完整 ZIP

有状态 D1、API、Worker 和 GC 检查串行执行，避免共享状态污染被误判为产品缺陷。

## 12. 参考

- Cloudflare R2: https://developers.cloudflare.com/r2/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- ZIP APPNOTE: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
- Web Crypto `SubtleCrypto.digest`: https://developer.mozilla.org/docs/Web/API/SubtleCrypto/digest
