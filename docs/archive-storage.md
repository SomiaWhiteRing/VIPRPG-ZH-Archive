# RPG Maker 2000/2003 归档存储架构

本文定义归档文件进入 R2、D1、下载流和垃圾回收时必须保持的稳定边界。作品资料和 ArchiveVersion 关系见[游戏领域架构](./game-domain-architecture.md)，在线游玩本地安装见[EasyRPG 架构](./easyrpg-web-play-architecture.md)，Cloudflare 环境操作见[Workers 与 React Router 运行手册](./workers-development.md)。

认证、角色和授权只以[认证与权限基线](./authentication-authorization.md)为准；本文不复制 permission key 或端点清单。

软件安装包使用同一 bucket 的独立 `tools/artifacts/` 命名空间，保持原始字节，不进入游戏去重归档。开启共享播放器的游戏在普通下载 ZIP 中直接引用 Kai Windows EXE 的原始字节。上传、发布、撤回和清理由[资源与软件托管](./resources.md)管理；资源图标复用 blob，其引用纳入手动及定时 GC 保护。

## 1. 目标与非目标

目标：

- 相同内容只保存一次，并用 SHA-256 证明对象身份。
- 保留每个 ArchiveVersion 的完整路径、文件顺序、大小、CRC32 和来源映射。
- 上传、下载、在线游玩和 GC 共用同一套 canonical 对象。
- D1 可判断对象引用、状态和成本，但不复制完整文件目录。
- 任何缺失、损坏或不一致都显式失败，不静默降级为不完整归档。

非目标：

- 不把完整游戏 ZIP 当作 canonical 归档；源 ZIP 和上传暂存包不保存到 R2。热门下载可使用下述有界、可丢弃的 R2 ZIP 缓存。
- 不以文件名、R2 key、ETag 或数据库自增 ID 作为内容身份。
- 不让 D1 成为第二份 manifest。
- 不为网页在线游玩保存另一套 canonical 文件；过滤 ZIP 只作为响应流或可丢弃下载缓存存在。
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

CorePack 是一个内容寻址的低压缩 ZIP，用于合并 RPG Maker 数据库、地图、string script、翻译文件和可选存档等大量小核心文件，减少下载重组时的 R2 Get。它是成本优化层，不是新的作品或版本边界。

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

R2 key 只由 `app/.server/storage/archive-keys.ts` 生成：

- `blobKey(sha256)`
- `corePackKey(sha256)`
- `manifestKey(manifestSha256)`

规则：

1. 接收上传时重新计算 SHA-256，不能信任 URL、header 或客户端声明。
2. SHA-256 决定内容身份和完整性；R2 ETag 仅用于确认已由服务器校验的对象版本是否变化，不替代首次内容校验。
3. 相同 hash 的重复上传是幂等操作；内容或长度不符必须拒绝。
4. D1 记录存在但 R2 对象缺失时标记不一致，不把它当作 existing 返回。
5. 下载和 commit 都从 hash 派生 key，业务代码不拼接 R2 路径。

## 4. 文件策略

文件纳入、角色分类、内容类型和 core pack 选择的唯一实现位于 `lib/archive/file-policy.ts`：

- `FILE_POLICY_VERSION`
- `classifyArchivePath`
- `normalizeArchivePath`
- `contentTypeForArchivePath`

策略只允许 RPG Maker 2000/2003 归档所需的数据库、地图、图像、音频、视频、字体、配置、文本、运行时和可选存档类型。截图目录、根目录临时截图、`null.txt`、分卷压缩包和不在白名单中的类型不能进入 canonical 归档。

高级选项中的“上传存档”默认关闭，只保留在当前上传页内，不写入本地偏好或恢复草稿的选项字段。勾选后，文件夹、ZIP 和 7z 上传均纳入 `.lsd` 存档（扩展名不区分大小写），存档随游戏基础包（CorePack）保存并保留原有相对路径，不作为公共库中的独立 blob，也不参与未引用素材清理；下载 ZIP 和在线安装保留这些文件。

`.po` 翻译文件随游戏基础包（CorePack）收录，保留游戏根目录内的相对路径和文件夹层级，不作为公共库中的独立 blob；扩展名不区分大小写，也不参与未引用素材清理。

白名单是信任边界。修改规则时必须提升 `FILE_POLICY_VERSION`，扩展浏览器扫描和服务端 commit 校验，并用真实样本验证排除统计；不要在文档中复制扩展名清单。

浏览器哈希完成后默认进行[素材引用检查](./resource-cleanup.md)，清理标准素材目录中未引用的图片、音频和视频，包括 RTP、自定义及改名副本，分析不确定时保留。程序、核心数据、字体和文本不参与引用清理。排除记录随 manifest 和恢复草稿保存，source-ready 复用核心 ZIP 校验复核引用；用户可在拖拽区关闭，InfoTooltip 解释范围和影响，选择由浏览器记住。

### 共享 Kai 播放器

上传文件选择区默认开启共享播放器，只剔除根目录 `Player.exe`（忽略大小写）。`archiveVersion.sharedPlayer` 保存被剔除文件的 `{path,size}`，没有匹配文件时省略；`files` 只描述实际归档文件。D1 的 `uses_shared_player` 是提交时生成的下载投影，不保存播放器文件行或固定版本。旧 manifest 和旧归档沿用完整原文件行为，不批量修改历史引用。

普通下载解析固定 slug `easyrpg-kai`、stable、windows-x64 的当前推荐 EXE，以 307 跳转至带 `player=<artifactId>` 的固定下载地址。该地址允许继续读取已被新推荐取代但仍公开、已发布、ready 的原包；撤回或隐藏会停止新请求。ETag、内部 ZIP 缓存键包含播放器 SHA-256；每次读取缓存前重新校验公开链及 R2 对象。包含共享播放器的响应和浮动入口均不提供浏览器长期缓存，完整 ZIP 仍可使用 Worker 内部缓存。没有版本参数且没有 If-Range 的 Range 请求返回 409，避免跨推荐版本拼接。

ZIP 中补入根目录 `Player.exe`，时间戳固定，字节直接流自工具对象。CRC32 在新 EXE 上传确认时由服务器流式计算并保存；历史包缺少 CRC32 时只读计算，按 SHA-256 缓存结果，不在公开下载过程中写工具记录。推荐暂停、格式为 ZIP、文件缺失或校验失败都明确报错，不静默省略播放器。下载大小和 R2 读取估算包含补入文件；归档存储统计仍只计算实际保存的游戏文件。

`web-play-v1` 过滤 ZIP 不补入共享播放器，Android Kai 导入也使用此 profile，其文件列表、哈希和 ZIP 大小均从过滤结果产生。已有归档无需重写即可使用过滤导入，既有已保存的完整归档下载地址继续保持原内容。

### 路径与编码

- 路径统一为相对路径和 `/` 分隔，不允许盘符、绝对路径、空段或 `..` 越界。
- 逻辑冲突比较使用规范化排序键；原始路径显示或重建需要时保存 `pathBytesB64`。
- Windows 保留名、大小写冲突和 Unicode 规范化冲突必须在 commit 前拒绝或明确报告。
- 文件名只存在于 manifest 和本地安装索引，不写入 blob key 或 D1 对象表。

## 5. 上传流程

```text
文件分支：选择文件夹、ZIP 或 7z
  -> 浏览器 Worker 枚举路径、应用文件策略并计算 hash
  -> 生成 core pack
  -> 创建绑定上传者的 import job；已有作品的新版本同时绑定目标 Work
  -> job-scoped preflight 并只上传 missing 对象
  -> 服务端确认 source ready
  -> 写入不含原始游戏文件的 IndexedDB 恢复草稿

资料分支：填写作品资料
  -> 确认资料；进入 commit 前可以撤回

source ready + metadata confirmed
  -> 上传资料图片并生成最终 manifest
  -> 条件更新取得 committing 提交权
  -> commit 校验对象、manifest 和元数据
  -> 原子创建或更新 Work，创建 ArchiveVersion 和引用
```

普通用户只在当前上传页看到任务进度，不提供跨页面任务管理器。source ready 后的草稿可以在同一浏览器、同一账号下跨刷新或浏览器重启恢复；草稿保存路径/hash 描述、core pack 引用、统计，以及持续自动保存的表单原值和资料图片，不保存原始游戏文件。未确认、不完整的资料也会保存；恢复后必须重新确认资料才会提交。浏览器锁保证同一草稿只由一个标签页接管。source ready 前的中断、跨设备接力和长期任务历史不在恢复范围内，服务端陈旧任务在 24 小时后过期。

ZIP 和 7z 都以唯一的 `RPG_RT.lmt` 所在目录为游戏根目录，仅处理该目录中的文件。7z 使用上传 Worker 内的 `7z-wasm` 解压，支持普通及固实压缩，暂不接受加密或分卷文件；内存不足时提示先解压后选择文件夹。标题、封面预读复用同一批文件，避免再次解压。7z 的 manifest / D1 来源标记为 `browser_7z`，下载仍按既有流程重组为 ZIP。

`7z-wasm` 固定为 1.2.0，其 [源码及构建方法](https://github.com/use-strict/7z-wasm#building)由上游提供；随站点发布的许可见 `/licenses/7z-wasm/License.txt` 和 `/licenses/7z-wasm/unRarLicense.txt`。

### Preflight

- 必须绑定当前用户拥有的 active import job。
- 只把 D1 状态有效且 R2 对象存在的 hash 视为 existing。
- 返回缺失对象及必要的上传统计，不接受客户端用 preflight 绕过实际 PUT 校验。

### 对象上传

- blob PUT 校验 hash、长度、owned job 和 preflight 预期。
- core pack PUT 校验外层 hash、ZIP 结构、entry 清单、解压大小和文件数。
- 上传成功后更新 D1 对象状态与 import job 统计；并发相同 hash 必须得到一致结果。
- 单次对象请求可以做有限的瞬时重试；任务进入 `failed` 后必须重新开始，新任务仍可命中已经写入的内容寻址对象。

### Commit

Commit 是发布引用的唯一边界：

1. 重新解析并验证 manifest schema、文件策略、路径、hash、CRC32 和 storage mapping。
2. 确认所有引用对象在 D1 与 R2 中可用。
3. 校验 Work 目标、上传者权限和 ArchiveVersion 元数据。
4. 在同一 D1 batch 中写入 Work 变更、ArchiveVersion、对象引用和 import job 结果。
5. 只有 commit 成功后，新归档才进入可管理的领域模型；失败不得留下半成品引用。

核心校验集中在 `app/.server/db/archive-commit.ts`，客户端生成结果不构成信任依据。

CorePack 校验按实际解压字节增长 entry 缓冲，不按未验证的声明长度巨额预分配；解压时增量计算 CRC32，并在每个输入块完成后等待 SHA-256 校验，避免保留整包的解压副本。isolate 内最多保留 16 个包、合计 20,000 条已验证 entry 元数据，估算大小上限 4 MiB；只有 pack hash、完整 entry 声明、R2 HEAD 大小及 ETag 一致时复用。需要素材引用复核时仍读取并扫描实际内容，不复用上一次扫描结论。

## 6. 下载重组

公开下载由 `worker/archive-download.mjs` 处理：

```text
published Work + published current ArchiveVersion
  -> 检查 Workers Cache，再检查热门变体的有界 R2 缓存
  -> 未命中时读取 manifest
  -> 并发打开 blob/core pack 对象
  -> 按 manifest 顺序输出 ZIP local header 和文件字节
  -> 写入中央目录
  -> 返回流式 ZIP
```

要求：

- 只允许完整 published 引用链；回收站、purged、processing 或 hidden 对象不能下载。
- 输出顺序由 manifest 固定，相同输入和 builder 版本产生稳定 cache key。
- ZIP 使用 STORE；local header 写入明确 CRC32、compressed size 和 uncompressed size，不依赖 data descriptor。
- 预取窗口包含正在消费的条目，最多保留 6 个打开或待消费的对象；应用层窗口覆盖整个正文消费周期，避免未消费响应积压，异常或取消时须取消剩余预取响应。这不同于平台“等待响应头的并发连接”计数。2026-09-22 同一大游戏的 4/5/6 冷 ZIP 缓存串行实测中，6 的两轮完整下载最快且均校验通过；该结果不代表多用户高负载验收。
- 布局生成时按实际入选文件统计 blob 复用次数，单次使用的文件直接流过，仅重复小 blob 可在当前请求缓存字节（单项不超过 2 MiB，总量不超过 64 MiB）；已有条目的复用不再受新增缓存预算影响。不能改变输出顺序；完整 ZIP 只可进入下述有界派生缓存。
- ZIP 小块和头部追加在 64 KiB 输出缓冲内同步完成，只有实际刷新或写出时等待背压，避免纯内存追加创建异步链；完整输出块直接写出。首个 ZIP 头仍在等待文件正文前发出。
- Range 映射到 ZIP 内各文件的偏移与长度，blob 和共享播放器直接使用 R2 范围读取；只涉及 ZIP 头部或中央目录时不读取文件正文。核心包仍读取压缩包，但只解压本次区间涉及的条目。同一 builder 的字节顺序、CRC、长度和 ETag 不变。
- 排序结果和本地头／中央目录偏移按内容版本、profile、播放器 hash 和 builder 复用；每个 bucket 的 isolate 缓存最多 16 份布局，估算元数据上限 8 MiB。命中布局后的 Range 用二分查找定位，再处理相交条目；冷请求仍需构建布局。缓存仅持有不可变元数据，R2 流、读取 Promise 和正文缓存均属于当前请求，公开状态检查仍逐次执行。
- Workers Cache/CDN 和 R2 热缓存均为可丢弃派生缓存；`download_builds` 只记录 cache key 和观测数据，不拥有文件内容。
- R2 热缓存只接收同一固定变体已成功完整输出至少两次、ZIP 不超过 64 MiB 的后续完整构建。key 包含版本、manifest、packer、ZIP builder、profile 与播放器摘要，其 SHA-256 首位映射到 `download-cache/v1/slots/[0-f].zip`。只有 16 个槽位，总对象大小上限 1 GiB；碰撞可覆盖缓存，但读取必须复核完整 key 摘要。冷门和大包继续按需生成。
- 热缓存命中前仍校验作品、版本及播放器资格。完整请求只需一个缓存对象 GET；Range 先 HEAD，再用该对象 ETag 作条件范围 GET，覆盖竞争或缓存故障回退到原始生成路径。HEAD、If-Range、ETag、CRC 和 ZIP 字节合同不变；`X-Download-Cache-Tier` 区分 `workers` 与 `r2` 命中，既有 HIT 统计同时涵盖两者。
- 热缓存从上传时起 7 天内有效，不因命中续期。定时 GC 只清理这 16 个固定路径中过期的对象，失败留待下轮重试并记入审计。GC 与覆盖竞争最多导致新缓存被提前淘汰，不影响原始对象或下载正确性。作品下架后立即拒绝读取其缓存，残留字节在覆盖或过期 GC 时移除。写入热缓存的本次构建不再同时写 Workers Cache，避免增加第三个流消费者。
- 构建失败必须记录错误并中止响应，不能跳过缺失 entry 生成“可下载”的残缺 ZIP。
- MISS/BYPASS 在 ZIP 输出流完整关闭后记录成功；HIT 同样等缓存正文流完成后记录。完整 ZIP 和 Range 分段请求分别累计；分段只累计其实际响应长度。输出字节只包含完成的服务端输出，不包含中断前的部分，也不证明客户端已将文件落盘或安装；冷请求的缓存写入分支可能继续消费客户端已取消的输出。
- `0020_download_observability.sql` 启用后的连接中断／取消与服务端错误分开累计。`Network connection lost.` 只能证明传输中断，不能直接认定为用户主动取消；后续成功保留最后一次异常的原因、时间与耗时，另外记录最后成功时间。控制台只将当前已发布版本最近请求中的已分类服务端错误列为告警，旧版本、历史未分类异常与连接中断单列。
- 历史 `download_count`、`failure_count` 保留；缺失的 Range、错误原因和完成字节不能从最后状态推算，分类计数从迁移后开始，旧值减去新分类计数即历史未分类。迁移只为旧记录能够确定的最后异常／成功回填时间，不把一条最后错误扩展为全部历史失败的原因。
- R2 GET 按当前请求实际发起的调用计数，包括 manifest、必要的播放器 CRC 读取、正文读取及失败请求的预取；不含 R2 HEAD 或缓存命中读取。不再以整个归档的估算读取数代替 Range 的实测值。布局缓存仍按原 bucket 复用，只将读取计数留在当前请求。缓存节省读取仍是整包缓存输出次数乘布局估算，不计分段命中，不作为实测节省量。

## 7. 在线游玩

在线游玩通过下载接口的 `profile=web-play-v1` 获取过滤 ZIP，服务端按 `shouldSkipWebPlayLocalWrite` 排除 `.exe`、`.txt` 和普通 `.dll`，保留五个根目录引擎/补丁识别 DLL。过滤发生在打开文件对象之前，减少不需要的对象读取和网络传输；如果保留文件位于 core pack 中，仍需读取该 pack。普通下载和 Kai 导入继续取得完整归档。两种响应使用不同的 cache key 和 ETag，`Content-Length` 与 Range 均按各自的 ZIP 计算。

浏览器顺序解析 ZIP，把可运行文件写入 OPFS pack，并在完成后丢弃 ZIP；不新增 Web Play canonical 文件副本，R2 热缓存遵循上述统一容量和期限。`download_builds` 仍只记录各自的缓存和观测数据。过滤响应按实际入选文件引用的 blob/core pack 估算 R2 GET 数。

本地安装的版本键、IndexedDB 状态、OPFS pack、Worker 本地播放器、重试和存档策略由[EasyRPG 在线游玩架构](./easyrpg-web-play-architecture.md)定义。存储层只保证下载 ZIP 与 manifest 可验证且字节稳定。

## 8. 删除与垃圾回收

删除分为领域删除和对象清理：

1. ArchiveVersion 先进入 `deleted`，停止公开下载和游玩。
2. 宽限期内可以 restore；current 删除后由领域服务选择合法替代项。
3. purge 移除 ArchiveVersion 的 manifest 与引用，并记录 `purged_at`。
4. 只有引用计数为零且超过宽限期的 blob/core pack 才能进入 GC 候选。
5. sweep 使用 `active -> purging -> purged` 状态转换；R2 删除失败恢复为 active 并报告。

GC 实现位于 `app/.server/storage/admin-storage-checks.ts` 和 `worker/archive-gc.mjs`。最终 sweep 必须有权限、显式确认、固定批次上限和审计；dry-run 不得产生删除副作用。

超过 24 小时无活动的 processing 归档由定时 GC 处理：先失效上传任务，再在同一 D1 batch 中以 `purged_at` 锁定归档、将 blob/core pack 的 `first_seen_archive_version_id` 转移给其他引用归档（没有其他引用时置空），并解除对象引用。D1 成功后才删除独占 manifest；归档记录保留到 R2 删除成功，失败时下轮直接重试，不重新等待 24 小时。最后删除归档记录及没有其他归档或外部链接的 processing 作品。共享对象仍按全局引用和原有宽限期回收。

两种 sweep 共用 `gc-candidates.ts`：每类对象先按 SHA 索引取最多 `10 × limitPerType` 条活动记录，再检查宽限期和全部引用，最多清理 `limitPerType` 条。`archive_gc_cursors` 保存下一轮起点，清理完成后以条件更新推进；达到清理上限时只推进至最后选中的对象，避免遗漏后续候选。扫到末尾后下一次从头开始，较早位置新解除的引用及删除失败对象在后续巡检再次检查。对象较多时一次完整巡检可能跨多次调用，不再保证一轮找到所有可清理对象。

`candidateScanCount` 和 `scanCompleted` 表达本轮候选窗口大小和是否到达末尾；原有 `scannedCount` 继续表示进入清理阶段的候选数。保留删除前的原子引用复核及失败恢复。预览统计仍为只读全量统计，并使用反向引用索引；它不推进游标。

禁止根据“某个目录看起来不用了”直接删除 R2 prefix，也禁止只查单个 ArchiveVersion 就判断共享对象无引用。

## 9. 安全与版权

- 上传、preflight、commit 和对象 PUT 都绑定当前用户及 owned import job。
- 文件类型白名单不等于内容安全；ZIP、路径、hash、大小和计数仍需独立验证。
- `.exe`、`.dll` 等运行时可以为离线归档保留，但在线游玩下载和本地安装会跳过不需要的运行时文件。
- 来源属于 ArchiveVersion 元数据；系统不因技术上可去重就推断内容可分发。
- 作品下载和在线游玩入口只读取完整 published 引用链；通用图片直链按下一条规则读取。
- 通用图片 SHA 直链不查询 D1 active/public：先读取已验证图片的 Cache API 缓存，冷请求读取 R2 并嗅探实际文件头。对象存在且格式有效即可读取，包括未发布图片；对象清理后已有缓存仍可在过期或淘汰前返回。图片格式校验、实际 MIME、nosniff 和论坛独立权限链路继续生效。
- 高成本操作必须有数量、大小或批次上限，并留下可查询的失败状态。

## 10. 必须保持的不变量

- 内容身份只有 SHA-256。
- 文件路径只由 manifest 持有。
- D1 只保存对象引用，不保存完整文件行副本。
- R2 中的 ZIP 下载副本只能是有界、可丢弃的热缓存，不承担 canonical 归档职责。
- Work 表示作品，ArchiveVersion 表示不可变文件快照。
- 发布后的 manifest 不原地修改；修正通过新 ArchiveVersion 完成。
- 对象只有在全局零引用且满足宽限期时才能清理。
- 未知文件策略、未知 manifest schema 或缺失对象一律失败。

## 11. 验证

测试分层遵循根目录 `AGENTS.md`。敏捷阶段只运行与改动相关的静态检查或稳定契约：

- 类型、静态架构或安全规则变化运行 `npm run check`
- 独立数据约束或 HTTP 契约变化运行 `npm test`

预生产或发布前运行 `npm run verify:preprod`；其中 `npm run test:flow` 在隔离状态中串行验证上传、preflight、commit、manifest/R2、原生 ZIP、GC 和 OPFS 安装。远端 sweep 只在明确授权时运行，不属于测试流程。

## 12. 参考

- Cloudflare R2: https://developers.cloudflare.com/r2/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- ZIP APPNOTE: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
- Web Crypto `SubtleCrypto.digest`: https://developer.mozilla.org/docs/Web/API/SubtleCrypto/digest
