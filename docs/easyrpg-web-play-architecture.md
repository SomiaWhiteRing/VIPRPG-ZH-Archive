# EasyRPG 在线游玩架构设计

本文档描述 VIPRPG-ZH-Archive 如何在不把完整游戏 ZIP 写入 R2 的前提下，引入 EasyRPG Web Player，让用户可以在浏览器中安装并游玩已归档的 RPG Maker 2000/2003 游戏。

相关主文档：

- [RPG Maker 2000/2003 去重存储库架构计划](./rpg-maker-2000-2003-deduplicated-storage-plan.md)
- [OpenNext 应用与 Cloudflare 基础设施开发路径](./opennext-cloudflare-development-path.md)

## 1. 固定结论

- 在线游玩复用现有下载 ZIP，不能生成另一套 Web Play 专用 ZIP。
- R2 仍然只保存 canonical 数据：`blobs/`、`core-packs/`、`manifests/` 和元数据资产。
- 完整游戏 ZIP 只允许作为响应流、Workers Cache/CDN 边缘缓存，或浏览器下载过程中的临时数据存在。
- 浏览器拿到 ZIP 后在本地解包，解包完成后丢弃 ZIP，不长期保存完整 ZIP。
- 解包后的 Web Play 运行目录写入 OPFS；MVP 跳过所有 `.txt`、`.exe`、`.dll` 文件，这些文件仍保留在普通下载 ZIP 中。
- IndexedDB 只保存安装状态、文件清单、版本键、进度、校验信息和错误信息。
- Service Worker 把 EasyRPG 对 `/play/games/{playKey}/{path...}` 的请求映射到 OPFS 文件。
- EasyRPG Web Player 自托管并内嵌到本站，不跨域 iframe 引用官方播放器。
- Cache API 不作为游戏文件主存储；只用于 EasyRPG runtime 壳资源缓存或后续 fallback。
- EasyRPG 存档先沿用 Emscripten IDBFS；存档云同步不进入 MVP。
- `works.uses_maniacs_patch = true` 的作品在 MVP 阶段隐藏在线游玩入口，只保留下载。

## 2. 总体流程

```text
用户进入 /play/{archiveVersionId}
  -> 查询 ArchiveVersion 和 Work 元数据
  -> uses_maniacs_patch=true 时不展示在线游玩入口
  -> 检查 IndexedDB 是否已有 ready 安装
  -> 没有 ready 安装时启动 Web Worker
  -> Web Worker fetch 现有下载 ZIP URL
  -> 命中 Workers Cache/CDN 时不读 R2
  -> 下载 ZIP 到 Web Worker 内存
  -> 按 ZIP 中央目录逐文件写入 OPFS
  -> 逐文件写入 OPFS
  -> 生成 EasyRPG index.json
  -> IndexedDB 标记 ready
  -> 注册/确认 Service Worker
  -> 加载自托管 EasyRPG index.js/index.wasm
  -> EasyRPG 请求 /play/games/{playKey}/...
  -> Service Worker 从 OPFS 返回文件 Response
```

## 3. URL 和版本键

### 3.1 页面和资源路径

```text
GET /play/{archiveVersionId}
GET /play/runtime/easyrpg/{easyrpgRuntimeVersion}/index.js
GET /play/runtime/easyrpg/{easyrpgRuntimeVersion}/index.wasm
GET /play/games/{playKey}/index.json
GET /play/games/{playKey}/{path...}
```

`/play/runtime/easyrpg/{version}/` 可以通过 `public/play/runtime/easyrpg/{version}/` 提供静态文件，也可以由专用路由提供。MVP 优先使用静态文件，升级 EasyRPG 时新增版本目录，不覆盖旧目录。

### 3.2 Play key

本地安装必须绑定完整版本键：

```text
archive_version_id
manifest_sha256
download_zip_builder_version
web_play_installer_version
easyrpg_runtime_version
```

建议生成：

```text
playKey = av-{archiveVersionId}-{manifestSha256Short}-{downloadZipBuilderVersion}-{webPlayInstallerVersion}-{easyrpgRuntimeVersion}
```

任一版本键变化，都视为新的本地安装。旧安装可以继续保留，也可以由缓存管理页提示清理。

## 4. CDN ZIP Bootstrap

在线游玩必须 fetch 与下载按钮相同的下载 URL，复用同一份 ZIP 字节和同一个 Workers Cache/CDN cache key。

```text
GET /api/archive-versions/{archiveVersionId}/download?zip_builder={downloadZipBuilderVersion}
```

注意：

- `Content-Disposition: attachment` 不影响 `fetch()` 读取响应体，不需要为了 Web Play 改出另一条 URL。
- 不要添加 `web_play=1` 之类会改变 cache key 的查询参数，除非下载端显式把它归一化到同一 cache key。
- Web Play 下载 URL 不改变，普通下载 ZIP 仍包含 `RPG_RT.exe`、DLL 和 `.txt` 文件；但 OPFS 本地运行目录会跳过所有 `.txt`、`.exe`、`.dll` 文件，减少不参与 EasyRPG Web 运行的本地写入。
- ZIP 下载进度来自 `Content-Length`；下载端必须继续保证固定长度响应。
- ZIP 只在下载和解包过程中存在，解包完成后不进入 OPFS 和 IndexedDB。当前下载 ZIP 使用 STORE + data descriptor，浏览器安装器需要先把 ZIP 字节保存在 Web Worker 内存中，再依据中央目录定位每个 entry 并逐文件写入 OPFS；ZIP 字节不写入任何浏览器持久化存储。`.txt`、`.exe`、`.dll` entry 在本地写入和 EasyRPG 索引生成阶段跳过。

## 5. OPFS 本地目录

建议 OPFS 根目录：

```text
OPFS/
  viprpg-archive/
    games/
      {playKey}/
        files/
          RPG_RT.ldb
          RPG_RT.lmt
          RPG_RT.ini
          Map0001.lmu
          CharSet/...
          Music/...
        index.json
```

原子性由 IndexedDB 状态控制，而不是依赖目录重命名：

- 安装开始前将 `status` 写为 `installing`。
- 安装过程中写入 `games/{playKey}/files/`。
- 全部文件写入、校验和 `index.json` 生成完成后，最后一次事务把 `status` 改为 `ready`。
- 浏览器崩溃后，如果看到长期停留的 `installing`，UI 提供“继续安装”或“清理重装”。
- `ready` 之前 Service Worker 不把该目录当作可运行游戏。

## 6. IndexedDB 状态

MVP 建议建立两个 object store。

### 6.1 `web_play_installations`

```text
playKey
archiveVersionId
manifestSha256
downloadZipBuilderVersion
webPlayInstallerVersion
easyrpgRuntimeVersion
status: created | installing | ready | failed | deleted
totalFiles
totalSizeBytes
installedFiles
installedBytes
downloadedBytes
downloadBytesTotal
currentPath
error
createdAt
updatedAt
readyAt
lastPlayedAt
```

### 6.2 `web_play_files`

```text
playKey
path
size
contentType
crc32
sha256
installed
updatedAt
```

`sha256` 如果安装阶段计算成本过高，可以先留空；canonical manifest 中已有的 SHA-256 可用于后续修复/校验流程。ZIP entry CRC 如果解包库可直接提供，应记录下来。

## 7. Web Worker 安装器

ZIP 下载、解包和 OPFS 写入都必须在 Web Worker 内执行。主线程只负责 UI。

任务：

- `navigator.storage.persist()` 和 `navigator.storage.estimate()` 由页面主线程调用，再把结果传给 Web Worker；Worker 环境不假设完整暴露持久化请求能力。
- 根据 ArchiveVersion 下载 URL fetch ZIP。
- 使用响应 `Content-Length` 计算下载进度。
- 下载阶段使用 `ReadableStream` 显示进度，并把 ZIP chunk 保存在 Web Worker 内存中。
- 解包阶段解析 ZIP 中央目录，按 local header offset 找到每个 STORE entry 的数据区。
- 逐文件规范化路径，跳过 `.txt`、`.exe`、`.dll` 文件，先生成 EasyRPG 索引，再使用滚动窗口式高并发 OPFS 写入。并发数按 `navigator.hardwareConcurrency` 放大并设置上限，但启动时从较低并发逐步爬升，避免 64 个文件一批的背压尖峰。
- OPFS 写入应复用目录 handle cache，避免 `CharSet`、`Picture`、`Music` 等目录被反复打开。
- 文件清单写入 IndexedDB 时批量提交，进度状态按时间节流聚合更新；不能每个文件创建一次独立 IndexedDB 事务。
- 持续更新 IndexedDB 进度：已下载字节、已安装文件、当前文件。
- 安装完成后生成 `index.json`，再把安装状态改为 `ready`。

MVP 不使用 `fflate` 的流式 unzip 处理下载 ZIP：当前服务端为下载进度和 Workers Cache 生成的是 STORE + data descriptor ZIP，流式 unzip 库无法可靠判断未知长度的 STORE entry 边界。后续如果下载 ZIP builder 改为可流式随机定位的格式，才重新评估真正增量解包。

## 8. EasyRPG `index.json`

EasyRPG Web Player 需要每个游戏目录提供 `index.json`。本站不依赖上传者提供该文件，而是由 archive manifest 或 ZIP entry 列表生成。

`index.json` 需要表达大小写无关索引和真实文件名映射，形态类似：

```json
{
  "cache": {
    "rpg_rt.ldb": "RPG_RT.ldb",
    "charset": {
      "_dirname": "CharSet",
      "hero": "Hero.png"
    }
  },
  "metadata": {
    "version": 2
  }
}
```

生成规则：

- 每一级目录和文件名使用小写键。
- 原始目录名通过 `_dirname` 保存。
- 值保存真实文件名。
- 图像和音频资源需要额外写入去扩展名别名，例如 `system/sys-thin2 -> sys-thin2.png`、`music/ad astra -> Ad Astra.ogg`；EasyRPG 运行时通常用不带扩展名的资源名查询。
- 路径必须来自 canonical ZIP entry，禁止接受 `..`、绝对路径、空路径和重复冲突路径。
- 如果同一目录下大小写折叠后出现冲突，安装失败并提示管理员检查路径。

## 9. Service Worker OPFS 桥

Service Worker scope 固定覆盖 `/play/`。

拦截规则：

```text
/play/games/{playKey}/index.json
/play/games/{playKey}/{path...}
```

响应规则：

- 读取 IndexedDB，确认 `playKey` 为 `ready`。
- 将 URL path 解码并规范化为 OPFS 相对路径。
- 拒绝路径穿越、空路径、控制字符和绝对路径。
- 从 OPFS 读取文件，返回 `new Response(file.stream(), headers)`。
- 设置合适的 `Content-Type`；未知类型使用 `application/octet-stream`。
- 缺失文件返回 404，并把缺失路径发送到页面日志面板。
- MVP 不做按文件云端 fallback；避免用户以为已经本地安装完成但仍持续消耗 R2。

## 10. 在线游玩页面

`/play/{archiveVersionId}` 至少需要这些状态：

- 不支持：作品使用 Maniacs Patch，显示只能下载。
- 未安装：显示游戏大小、浏览器存储用量、安装按钮。
- 安装中：显示 ZIP 下载进度、解包进度、当前文件、已写入容量；关闭页面前用 `beforeunload` 拦截。
- 安装失败：显示失败阶段、错误和“清理重装”。
- 已安装：显示启动按钮、删除本地缓存、重新安装、最后游玩时间；游戏启动中或运行中禁用删除和重新安装，避免 OPFS 读写竞争。
- 运行中：展示 EasyRPG canvas、全屏按钮、返回作品页、日志面板；全屏使用外层播放器容器的浏览器原生 fullscreen，不调用 EasyRPG runtime 自带 fullscreen。
- 中断安装：刷新或浏览器崩溃后，如果 IndexedDB 仍记录 `installing`，页面提示上次安装未完成，并提供“清理并重装”。MVP 不尝试从半截 ZIP 继续恢复。

缓存管理页面可以先并入 `/play/{archiveVersionId}`，后续再独立为 `/settings/storage` 或 `/me/storage`。

## 11. EasyRPG runtime

EasyRPG runtime 必须自托管：

```text
public/play/runtime/easyrpg/{version}/index.js
public/play/runtime/easyrpg/{version}/index.wasm
```

要求：

- `index.wasm` 返回 `Content-Type: application/wasm`。
- runtime 文件使用长期 immutable 缓存；升级时新增 `{version}` 目录。
- 页面直接加载同源 runtime，不使用跨域 iframe。
- 如需 iframe，必须是同源 iframe；但 MVP 优先直接在 React 页面中挂载 canvas 并调用 `createEasyRpgPlayer(...)`。
- CSP 需要允许同源 WASM 执行；具体指令在实现时以当前浏览器和 OpenNext 输出验证为准。

## 12. 存档策略

MVP 不把游戏存档放入 OPFS 游戏目录。

- EasyRPG 存档沿用 Emscripten IDBFS。
- 游戏资源安装和存档生命周期分开。
- 删除本地游戏缓存时，默认不删除存档；UI 需要单独提供“清除本游戏存档”。
- 后续如做云存档同步，再单独设计 save slots、备份和冲突合并。

## 13. 浏览器存储策略

进入安装前应调用：

```ts
const estimate = await navigator.storage.estimate();
const persisted = await navigator.storage.persist();
```

说明：

- OPFS、IndexedDB、Cache API 和 EasyRPG IDBFS 共享同一个 origin 存储额度。
- `persist()` 只能请求浏览器尽量不要自动清理本站数据，不保证成功。
- 持久化请求应在页面主线程发起；Worker 只接收主线程传入的结果并负责安装。
- UI 必须显示已用空间、估算额度和本游戏预计安装大小。
- 空间不足或 `QuotaExceededError` 时，安装失败并引导用户删除其他本地缓存。

## 14. 安全和兼容

- ZIP entry 解包必须拒绝路径穿越。
- 同一页面内同一 `playKey` 同时只能有一个安装任务；刷新或崩溃后的遗留 `installing` 状态按中断安装处理并清理重装。跨标签页强锁可在后续缓存管理阶段补入。
- 安装完成前不能启动 EasyRPG。
- `uses_maniacs_patch = true` 的作品 MVP 不展示在线游玩入口。
- 非 UTF-8 路径问题会直接影响 EasyRPG 运行；如果真实样本出现路径损坏，应回到主架构中的 `path_bytes_b64` 暂缓决策重新评估。
- Service Worker 和 OPFS 都是同源能力，跨域官方播放器无法访问本站 OPFS，因此不能用跨域 EasyRPG iframe。
- Service Worker 对非法路径返回 400，对缺失文件返回 404，并把路径和错误原因发送到页面日志面板。

## 15. MVP 验收

- 未使用 Maniacs Patch 的 ArchiveVersion 显示在线游玩入口。
- 使用 Maniacs Patch 的 Work 不显示在线游玩入口。
- 首次点击在线游玩时显示下载进度、解包进度、当前文件和本地缓存状态。
- 下载 ZIP 复用现有下载 URL；命中 Workers Cache/CDN 时下载观测记录不增加 R2 Get。
- 安装完成后 OPFS 中有 Web Play 运行目录和 `index.json`；运行目录跳过 `.txt`、`.exe`、`.dll` 文件。
- 刷新页面后无需重新请求云端即可启动已安装游戏。
- 删除本地缓存后再次进入会重新安装。
- 浏览器崩溃或安装中关闭页面后，再进入能清理或继续安装。
- EasyRPG 能启动一个已知可玩的样本游戏。
- 缺失文件会显示在前端日志面板中。
- 运行中不能删除本地缓存或重新安装；重复点击启动不会重复加载 runtime。

## 15.1 MVP 收束记录

- 资源索引必须同时写入真实文件名和图像/音频资源的去扩展名别名。EasyRPG 会以 `System/sys-thin2`、`Title/titq`、`Music/Ad Astra` 这类无扩展名路径查询资源，仅保存 `*.png` / `*.ogg` 键会导致 Web 端素材缺失。
- Web Play 本地写入跳过所有 `.txt`、`.exe`、`.dll` 文件。EasyRPG Web Player 不依赖 Windows 可执行文件和 DLL，RPG Maker 2000/2003 运行时也不依赖说明文本；跳过后可以减少 `StringScripts*` 等大量小文本和运行时二进制造成的 OPFS 写入压力。
- EasyRPG canvas 必须可聚焦，并在启动和全屏切换后主动聚焦；否则方向键和确认键可能落到页面而不是游戏。
- 全屏应让外层播放器容器进入浏览器原生 fullscreen。直接调用 EasyRPG/Emscripten runtime 的 fullscreen 路径会在当前 runtime 下造成 canvas 尺寸异常，表现为黑屏。
- 当前 MVP 明确支持最新版 Chrome / Edge。Firefox / Safari 的 OPFS、持久化存储和 WASM 行为后续再做兼容性承诺。

## 16. 后续扩展

- 本地缓存管理页独立化。
- 跨标签页安装锁和半成品安装修复。
- 安装校验和修复：按 manifest SHA-256 或 ZIP CRC 检查本地文件。
- 存档导出、导入和云同步。
- 支持管理员手动开启 Maniacs Patch 游戏的实验性在线游玩。
- 对超大游戏增加下载前空间预估、排队安装和后台恢复策略。

## 17. 参考链接

- EasyRPG Web Player: https://easyrpg.org/player/guide/webplayer/
- MDN OPFS / `StorageManager.getDirectory()`: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory
- MDN Storage quotas and eviction criteria: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN `StorageManager.persist()`: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- MDN Cache API: https://developer.mozilla.org/en-US/docs/Web/API/Cache
- Emscripten File System API / IDBFS: https://emscripten.org/docs/api_reference/Filesystem-API.html
