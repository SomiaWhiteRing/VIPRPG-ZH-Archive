# 浏览器上传任务架构设计

本文档专门描述 Phase D 的浏览器端上传任务系统。

主存储架构见 [RPG Maker 2000/2003 去重存储架构](./rpg-maker-2000-2003-deduplicated-storage-plan.md)，游戏领域模型见 [游戏领域架构设计](./game-domain-architecture.md)。本文不重新讨论 Work / Release / ArchiveVersion 的领域关系，而是回答：

- 用户选择本地文件夹或本地 ZIP 后，浏览器如何完成预索引。
- 长时间上传时，页面如何显示后台任务。
- 用户离开页面、关闭标签页、浏览器崩溃后，任务如何恢复。
- 浏览器本地状态和服务端 `import_jobs` 如何分工。
- commit 如何保证幂等，避免半成品 ArchiveVersion 进入正式索引。

## 1. 目标

Phase D 的目标是实现一个类似网盘客户端的浏览器上传体验：

- 用户发起导入后，右下角出现上传浮标。
- 点击浮标展开任务面板，显示扫描、哈希、core pack、preflight、上传、commit 的进度。
- 用户离开上传页后，任务仍在当前浏览器会话中继续处理。
- 有未完成任务时，关闭或刷新页面应提示风险。
- 浏览器崩溃或系统重启后，用户重新打开站点可以看到未完成任务，并按提示恢复。
- 已上传成功的 blob / core pack 不重复上传。
- 最终只有 commit 成功后，D1 才出现可发布的 ArchiveVersion。

## 2. 非目标

Phase D 不追求以下能力：

- 不保证浏览器关闭后仍能完全无人值守上传。普通网页在浏览器进程退出后不能继续执行 JavaScript。
- 不依赖 `beforeunload` 做可靠保存。它只用于离开页面前的风险提示，不能作为状态持久化机制。
- 不把完整游戏 ZIP 上传到 Worker 或 R2。
- 不把完整游戏 ZIP 写入 R2 作为中间缓存。
- 不要求第一版支持多设备接力上传；恢复范围限定在同一浏览器、同一站点 origin。
- 不要求第一版把所有源文件复制到 OPFS。OPFS 可作为后续增强，不能成为最小实现的前提。

## 3. 浏览器能力边界

### 3.1 `beforeunload`

`beforeunload` 只能用于提示用户“离开会中断正在进行的本地任务”。它有明显限制：

- 浏览器只显示通用文案，网页不能自定义提示内容。
- 移动端和崩溃场景不保证触发。
- 只有存在活跃上传、未保存元数据或未 commit 任务时才注册监听；任务清空后立即移除，避免影响性能和 bfcache。

因此，系统必须在每个阶段主动把任务状态写入 IndexedDB，而不是等页面卸载时再保存。

### 3.2 `visibilitychange` / `pagehide`

`visibilitychange` 比 `beforeunload` 更适合作为“最后一次可观察检查点”。当页面进入 hidden、触发 pagehide、标签页切到后台或移动端切走应用时，系统应立即：

- flush 当前任务状态到 IndexedDB。
- 写入当前 phase、已完成对象、当前错误和最后活动时间。
- 暂停 UI 轮询和动画更新。
- 停止启动新的上传请求，允许已经进入网络层的请求自然完成或由任务调度器中止。

这些事件也不能保证浏览器继续执行耗时异步任务，所以它们只用于 checkpoint，不用于“保证收尾”。页面重新可见或用户重新打开站点后，仍然以 IndexedDB + 服务端 preflight 的结果为准。

### 3.3 IndexedDB

IndexedDB 是 Phase D 的本地任务状态库，用于保存：

- 任务基本信息。
- 枚举到的文件清单。
- 每个文件的 hash、大小、路径、角色、状态。
- core pack 生成结果。
- preflight 返回的 existing / missing 结果。
- 已上传对象清单。
- commit 草案和服务端 `import_job_id`。

IndexedDB 可在 Web Worker 中使用，适合把哈希、扫描状态和任务进度从 React 组件生命周期中解耦出来。

### 3.4 File System Access API

如果浏览器支持 File System Access API，可以把 `FileSystemHandle` 存入 IndexedDB，并在恢复时请求用户重新授权。这样恢复体验最好。

但它不能作为唯一方案：

- 支持范围和权限行为受浏览器影响。
- 用户可能拒绝重新授权。
- 文件可能已经被移动、删除或修改。

所以最小实现必须支持 fallback：崩溃恢复时提示用户重新选择同一文件夹或同一本地 ZIP，然后用文件指纹匹配旧任务。

### 3.5 OPFS

Origin Private File System 可以支持更强的断点恢复：选择文件后，把待上传数据复制到 origin 私有沙盒，再分块上传。这样即使源文件被移动，也可以继续。

但对 RPG Maker 游戏目录来说，这会把本地存储占用翻倍，且实现复杂。初版不启用 OPFS 全量缓存，只把它列为后续优化：

- 大型单 blob 分片缓存。
- core pack 生成中间文件缓存。
- 低内存设备上的流式打包缓存。

### 3.6 Web Worker

Web Worker 承担 CPU 和 I/O 密集任务：

- 枚举 ZIP entry 或文件夹条目。
- 强制白名单和路径覆盖规则过滤。
- SHA-256 计算。
- core pack 生成。
- 任务状态写入 IndexedDB。
- 分批上传队列调度。

主线程只负责 UI、用户交互、权限弹窗和任务控制命令。

## 4. 总体架构

```text
React App
  -> UploadTaskProvider
  -> UploadFloatingDock
  -> UploadTaskPanel
  -> UploadTaskWorkerClient

Dedicated Web Worker
  -> file enumeration
  -> whitelist/path policy
  -> hash pipeline
  -> core pack builder
  -> preflight client
  -> upload queue
  -> IndexedDB task store

Cloudflare Worker
  -> POST /api/imports
  -> POST /api/imports/{id}/preflight
  -> PUT /api/blobs/{sha256}
  -> PUT /api/core-packs/{sha256}
  -> POST /api/imports/{id}/commit
  -> GET /api/imports/{id}

D1 / R2
  -> import_jobs
  -> blobs / core_packs
  -> works / releases / archive_versions / archive_version_blob_refs / archive_version_core_pack_refs
  -> manifests/
```

## 5. UI 设计

### 5.1 上传浮标

浮标是全站级组件，不属于上传页面。

位置：

- 桌面：右下角。
- 移动端：底部安全区上方，避免遮挡系统手势区。

常态显示：

- 当前活跃任务数。
- 总进度百分比。
- 当前阶段图标。
- 错误状态角标。

点击后展开任务面板。

### 5.2 任务面板

任务面板展示每个导入任务：

- 游戏名或源目录名。
- 当前阶段。
- 阶段进度。
- 已处理文件数 / 总文件数。
- 已上传对象数 / 缺失对象数。
- 已上传字节 / 需上传字节。
- 排除文件数和大小。
- 当前错误。
- 操作按钮：暂停、继续、取消、重试、打开详情。

任务详情展示：

- 白名单内归档大小。
- 排除统计。
- core pack 文件数和压缩前后大小。
- blob 来源目录统计。
- preflight 命中率。
- 预计下载 R2 Get。
- commit 前元数据检查。

### 5.3 导航和关闭保护

有以下情况时注册 `beforeunload`：

- 正在枚举、哈希、打包、上传或 commit。
- 有已选择文件但尚未保存任务草案。
- 有已上传对象但尚未完成 commit。

不注册的情况：

- 所有任务 completed / failed / canceled。
- 任务暂停且本地状态已经完整保存。

站内路由切换不弹浏览器原生提示，而是使用应用内确认弹窗：

- “继续后台处理”
- “暂停任务并离开”
- “取消任务”

## 6. 本地任务状态

IndexedDB 建议库名：

```text
viprpg_upload_tasks_v1
```

对象存储：

```text
tasks
task_files
task_objects
task_events
task_errors
```

### 6.1 tasks

保存任务头信息：

```ts
type BrowserUploadTask = {
  localTaskId: string;
  serverImportJobId: number | null;
  status: UploadTaskStatus;
  phase: UploadTaskPhase;
  sourceKind: "folder" | "zip";
  sourceName: string;
  sourceFingerprint: string | null;
  filePolicyVersion: string;
  packerVersion: string;
  workDraftJson: unknown;
  releaseDraftJson: unknown;
  archiveDraftJson: unknown;
  manifestSha256: string | null;
  manifestJson: string | null;
  corePackSha256: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
```

### 6.2 task_files

保存每个逻辑文件：

```ts
type BrowserTaskFile = {
  localTaskId: string;
  path: string;
  pathSortKey: string;
  sizeBytes: number;
  mtimeMs: number | null;
  role: "map" | "database" | "asset" | "runtime" | "metadata" | "other";
  storageKind: "blob" | "core_pack" | "excluded";
  fileType: string;
  sha256: string | null;
  exclusionReason: string | null;
  uploadState: "pending_hash" | "hashed" | "existing" | "missing" | "uploading" | "uploaded" | "failed";
};
```

### 6.3 task_objects

按对象而不是路径跟踪上传：

```ts
type BrowserTaskObject = {
  localTaskId: string;
  objectKind: "blob" | "core_pack" | "manifest";
  sha256: string;
  sizeBytes: number;
  r2Key: string;
  sourcePath: string | null;
  uploadState: "unknown" | "existing" | "missing" | "uploading" | "uploaded" | "failed";
  retryCount: number;
  lastError: string | null;
};
```

同一个 blob 内容可能对应多个路径，但只上传一个对象。

## 7. 状态机

```text
created
  -> source_selected
  -> enumerating
  -> hashing
  -> building_core_pack
  -> manifest_ready
  -> preflighting
  -> uploading_missing_objects
  -> verifying_objects
  -> committing
  -> completed
```

失败和人工操作状态：

```text
paused
failed_recoverable
failed_terminal
canceled
needs_source_reselect
needs_metadata
```

### 7.1 可恢复失败

以下失败应允许重试：

- 网络断开。
- Worker 请求超时。
- 某个 blob 上传失败。
- preflight 失败。
- commit 返回临时错误。
- 浏览器刷新后任务回到可恢复点。

### 7.2 终止失败

以下失败需要用户重新开始或人工处理：

- 文件在 hashing 后被修改，指纹不匹配。
- core pack 与 manifest 不一致。
- commit 发现 Work / Release 权限不足。
- 服务端判定 manifest 非法。
- 文件路径冲突无法自动解决。

## 8. 文件指纹和恢复

### 8.1 源指纹

任务级 `sourceFingerprint` 用于判断用户重新选择的文件夹/ZIP 是否是同一个源。

建议输入：

- source kind。
- 顶层文件名集合。
- 总文件数。
- 总大小。
- 若干稳定文件的 path + size + mtime。

不要把完整文件 hash 全部作为首次恢复判断，否则恢复前还要重新 hash 所有文件。

### 8.2 崩溃恢复流程

```text
用户重新打开站点
  -> UploadTaskProvider 从 IndexedDB 读取 unfinished tasks
  -> 浮标显示“有可恢复任务”
  -> 用户点击恢复
  -> 如果有可用 FileSystemHandle，尝试重新授权
  -> 否则要求用户重新选择同一文件夹或 ZIP
  -> 计算 sourceFingerprint
  -> 匹配成功
  -> 从上次阶段继续
  -> 对已上传对象重新 preflight
  -> 只上传 missing 对象
  -> commit
```

### 8.3 恢复时必须重新 preflight

浏览器本地记录“uploaded”不能直接等价于服务端存在。恢复后必须对所有 blob/core pack 再做一次 preflight：

- D1/R2 可能发生清理。
- 上一次上传可能在 R2 成功但 D1 插入失败。
- 用户可能切换环境。

preflight 是恢复流程的事实来源。

## 9. 上传策略

### 9.1 并发控制

当前建议：

- hash / CRC 阶段使用 Dedicated Worker 内的有界并发，按 `navigator.hardwareConcurrency` 自适应，上限 16 路，并额外设置活跃读取字节预算，避免多个大文件同时进入内存。
- 本地 ZIP 输入只读取中央目录；entry 在 hash 或上传时按需从原 ZIP 切片并解压，禁止在枚举阶段 `unzipSync` 全量解包。
- ZIP 文件名必须按 entry 的 UTF-8 flag 解码；未设置 UTF-8 flag 的 legacy ZIP 需要在中央目录样本上选择统一的 legacy 编码。RPG Maker 2000/2003 日文 ZIP 常见 Shift-JIS/CP932 路径，不能默认按 UTF-8 解码，否则 manifest 会固化乱码路径并破坏公共根目录剥离。
- core pack 生成复用 hash 阶段已经读入的 core 文件字节，使用 `fflate` 异步 ZIP 构建，避免同步压缩长时间阻塞 worker。
- blob 上传并发按浏览器能力自适应，建议 6 到 16 路；如果后续遇到 Worker/R2 限流，再按错误率动态回退。
- core pack 上传：单独队列，优先级高于普通 blob。
- preflight 分块：每批不超过 100 个 hash。
- commit 分块：只写 ArchiveVersion 对 blob / core pack 的去重引用，不把完整文件行写入 D1；完整文件清单以 manifest 为准。

### 9.2 进度计算

总进度不应只按文件数计算。建议按阶段加权：

| 阶段 | 权重 |
|---|---:|
| 枚举和过滤 | 5% |
| 哈希 | 30% |
| core pack 生成 | 15% |
| preflight | 5% |
| 上传缺失对象 | 35% |
| commit | 10% |

上传阶段按字节计算，哈希阶段按已读取字节计算。

### 9.3 暂停和取消

暂停：

- 停止启动新上传。
- 允许已开始的单个请求自然完成或 abort。
- 保存当前状态到 IndexedDB。

取消：

- 本地任务标记 canceled。
- 如果未 commit，不需要删除已上传 blob/core pack；它们是内容寻址 canonical 对象，可能被后续任务复用。
- 服务端 `import_jobs` 标记 canceled。

## 10. 服务端职责

### 10.1 import_jobs

`import_jobs` 是服务端可观测状态，不负责保存浏览器所有细节。

服务端保存：

- `uploader_id`
- source name
- file policy version
- 文件数和大小统计
- excluded 统计
- missing blob/core pack 数
- 状态和错误
- commit 结果

浏览器保存：

- 文件句柄或重选提示。
- 每个本地文件的临时扫描状态。
- UI 进度。
- 尚未提交的 Work / Release 草稿。

### 10.2 API

建议 Phase D 使用以下 API：

```text
POST /api/imports
  创建 import_job；要求 uploader/admin/super_admin

POST /api/imports/{id}/preflight
  输入 blob/core pack hash；返回 existing/missing

PUT /api/blobs/{sha256}
  上传单个 blob；后端重算 SHA-256

PUT /api/core-packs/{sha256}
  上传 core pack；后端校验 ZIP、SHA-256、文件数、未压缩大小

POST /api/imports/{id}/commit
  提交 Work / Release / ArchiveVersion / 文件索引 / manifest

GET /api/imports/{id}
  查询服务端任务状态

POST /api/imports/{id}/cancel
  取消未 commit 任务
```

### 10.3 Commit 幂等性

commit 请求必须包含：

- `localTaskId`
- `manifest_sha256`
- `file_policy_version`
- `packer_version`
- `work` / `release` 目标。
- core pack 声明。
- 文件清单分块引用或完整 manifest。

幂等规则：

- 同一 `import_job_id + manifest_sha256` 重复 commit 返回同一个 ArchiveVersion。
- 同一 Release 的同一 `archive_key` 下已存在相同 `manifest_sha256` 时，不创建重复 ArchiveVersion。
- commit 前确认所有声明的 blob/core pack 在 D1 和 R2 都存在。
- manifest 写入 R2 成功后再写 D1 ArchiveVersion。
- D1 写入失败时可重试同一 commit。

## 11. 安全和权限

- 所有上传 API 都必须重新读取 D1 用户状态，不信任旧 cookie 中的角色。
- 普通用户不能创建 import_job。
- import_job 绑定 `uploader_id`，后续 preflight/upload/commit 必须校验同一用户或管理员。
- manifest 中禁止绝对路径、空路径、`..`。
- manifest 的 `file_policy_version` 必须是服务端允许版本。
- 后端必须重算上传内容 SHA-256。
- core pack 必须校验 entry 列表与 manifest 一致。

## 12. 实施阶段

### D.1 本地任务壳

- 建立 `UploadTaskProvider`。
- 建立 IndexedDB schema。
- 建立浮标和任务面板。
- 支持创建、暂停、取消本地任务。
- 注册有条件 `beforeunload`。
- 监听 `visibilitychange` / `pagehide`，做任务 checkpoint。

### D.2 Worker 预索引

- Web Worker 枚举文件夹。
- 实现强制白名单和 `rpgm2000-2003-whitelist-v3` 路径规则。
- 计算 SHA-256。
- 写入 IndexedDB。
- 显示扫描和哈希进度。

### D.3 Core pack 和 manifest

- 浏览器生成 core pack。
- 生成规范化 manifest。
- 计算 manifest SHA-256。
- 在 UI 中展示排除统计和预计成本。

### D.4 Preflight 和上传

- 创建服务端 import_job。
- 分块 preflight。
- 上传 missing blob/core pack。
- 支持暂停、继续、重试。
- 崩溃恢复后重新 preflight。

### D.5 Commit

- 选择或创建 Work。
- 选择或创建 Release。
- 提交 ArchiveVersion。
- 写入 manifest。
- 完成后清理本地临时状态。

### D.6 恢复体验

- 启动时扫描未完成任务。
- 浮标提示可恢复。
- 支持重新选择源文件夹/ZIP 并匹配指纹。
- 支持恢复后继续上传。

## 13. 第一版取舍

第一版建议选择：

- 使用 Dedicated Worker，不使用 Service Worker 承担上传。
- 使用 IndexedDB 保存任务状态。
- File System Access API 作为增强；不支持时要求用户重新选择源。
- 不启用 OPFS 全量缓存。
- 只允许同一浏览器恢复。
- 同时只运行 1 个活跃导入任务，其他任务排队。
- commit 前不创建公开 ArchiveVersion。

这些取舍能覆盖真实上传痛点，同时控制实现复杂度。

## 14. 当前实施记录

Phase D 最小可用版本已落地：

- 前端入口：`/upload`。
- 上传表单按 `Work` / `Release` / `ArchiveVersion` 分组：Work 必填“原名”和“游戏引擎”；Release 必填“基底版本、发布类型、版本标识”；ArchiveVersion 必填“归档语言、归档标识”，并记录校对/修图状态。
- Release 不再承载语言和校对/修图状态，而是用 `release_key = base_variant + release_type + variant_label` 区分原版、重制版、活动投下版等版本分支；ArchiveVersion 用 `archive_key = language + 校对/修图状态 + archive_variant_label` 区分同一 Release 下的具体可下载方案。
- Work 标题检测：用户填写原名后查询库内既有作品；确认同一作品后带入 Work 信息，并允许选择既有 Release。
- Work 媒体：图标和缩略图是单图 blob 引用，浏览图可多选并作为 Work 预览媒体保存；未选择图标/缩略图时由展示层按引擎使用缺省图。
- 浏览器任务：`UploadTaskProvider` + Dedicated Worker + IndexedDB 快照。
- 本地输入：文件夹选择和本地 ZIP 浏览器端读取均已实现；完整 ZIP 不上传到 Worker/R2。
- 文件策略：`rpgm2000-2003-whitelist-v3`，包含 `StringScripts*`、`screenshots*`、根目录 `null.txt` 的覆盖规则。
- 打包策略：每个导入生成 1 个 `core-main` ZIP core pack，使用 `fflate` 低压缩等级。
- 服务端 API：`POST /api/imports`、`GET /api/imports/{id}`、`POST /api/imports/{id}/preflight`、`POST /api/imports/{id}/commit`、`POST /api/imports/{id}/cancel`，以及 blob/core pack 上传端点。
- commit 策略：对象引用表分块写入，避免 D1 SQL 变量上限；同 manifest 或同 archive label 的失败草稿可清理后重试。

2026-05-01 staging 验收样本：

- 样本：本地 RPG Maker 2000/2003 游戏目录。
- 浏览器源文件：9081 个，390.51 MB。
- 归档结果：9073 个文件，273.75 MB。
- 排除结果：8 个文件，122.42 MB，主要是原始分卷压缩包、无扩展名音频异常项、`.bat` 和 `.r3proj`。
- D1：`ArchiveVersion #4` published/current，对象引用表写入完成；文件级清单以 R2 manifest 为准。
- R2：manifest 对象 SHA-256 与 D1 `manifest_sha256` 一致。

## 15. 参考资料

- MDN：`beforeunload` 事件说明，尤其是不可靠触发和只建议在有未保存数据时监听的限制：<https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event>
- MDN：`visibilitychange` 可作为页面进入 hidden 时的最后可靠可观察事件：<https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event>
- MDN：`pagehide` 可作为页面会话隐藏时的补充信号：<https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event>
- MDN：IndexedDB 可保存大量结构化数据和文件/blob，且可在 Web Worker 中使用：<https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API>
- MDN：File System API / OPFS，以及 `FileSystemHandle` 可序列化到 IndexedDB、OPFS 可用于中断后恢复上传的说明：<https://developer.mozilla.org/en-US/docs/Web/API/File_System_API>
- MDN：Web Workers 可在后台线程执行耗时任务，避免阻塞 UI：<https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API>
- MDN：`StorageManager.persist()` 可请求持久存储，但浏览器可能拒绝：<https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist>
