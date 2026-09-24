# EasyRPG 在线游玩架构

本文档定义 VIPRPG-ZH-Archive 当前 EasyRPG Web Player 的稳定边界：在不把完整游戏 ZIP 写入 R2 的前提下，让用户可以在浏览器中安装并游玩已归档的 RPG Maker 2000/2003 游戏。

相关主文档：

- [RPG Maker 2000/2003 去重存储架构](./archive-storage.md)
- [Workers 与 React Router 运行手册](./workers-development.md)
- [浏览器已安装游戏与自动清理](./browser-game-storage.md)：普通浏览器的 7 天资源桶与 Android 套壳存储分流。

## 1. 固定结论

- 在线游玩复用现有下载 ZIP，不能生成另一套 Web Play 专用 ZIP。
- R2 仍然只保存 canonical 数据：`blobs/`、`core-packs/`、`manifests/` 和元数据资产。
- 完整游戏 ZIP 只允许作为响应流、Workers Cache/CDN 边缘缓存，或浏览器下载过程中的临时数据存在。
- 浏览器拿到 ZIP 后在本地解包，解包完成后丢弃 ZIP，不长期保存完整 ZIP。
- 解包后的 Web Play 运行目录写入 OPFS；安装器跳过 `.txt`、`.exe` 和普通 `.dll` 文件，但保留根目录的 `accord.dll`、`ultimate_rt_eb.dll`、`harmony.dll`、`dynloader.dll`、`Destiny.dll` 供 EasyRPG 识别引擎与补丁（文件名忽略大小写）。普通下载 ZIP 保留全部归档文件。
- IndexedDB 只保存安装状态、文件清单、版本键、进度、校验信息和错误信息。
- 普通下载 ZIP 使用 STORE，且 local file header 写入明确的 `crc32`、compressed size 和 uncompressed size；不使用 data descriptor。
- 启动前校验 OPFS `pack-index.json`，把 pack 的 `File` 与切片索引交给播放器 Worker，由 Emscripten WORKERFS 挂载为只读 `/game`。
- 引擎在 Worker 内同步读取本地文件，不发逐资源 HTTP 请求，不使用 Service Worker 资源桥，也不把整个游戏复制进 WASM 内存。
- EasyRPG Web Player 自托管并内嵌到本站，不跨域 iframe 引用官方播放器。
- 仓库和每次部署只包含当前一个 EasyRPG runtime；升级成功后清理旧版本目录，不提供多版本选择或旧版回退。
- 同源 `/play/player.html` iframe 持有播放器 Worker、画布与音频设备；运行时所有权与销毁规则见[运行时](#11-easyrpg-runtime)。安装中的站内导航使用 Router blocker；运行中的站内导航先等待存档写入，刷新或关页保留浏览器确认。
- Cache API 不作为游戏文件主存储；EasyRPG runtime 由同源静态资源提供。
- EasyRPG 存档沿用 Emscripten IDBFS；当前不提供存档云同步。
- `rpg_maker_2003_maniac` 作品仍显示在线游玩入口，但提示可能无法用 EasyRPG 正常游玩。

## 2. 总体流程

```text
用户进入 /play/{archiveVersionId}
  -> 查询 ArchiveVersion 和 Work 元数据
  -> RPG Maker 2003 Maniac 作品显示兼容性提示
  -> 检查 IndexedDB 是否已有 ready 安装
  -> 没有 ready 安装时启动 Web Worker
  -> Web Worker fetch 现有下载 ZIP URL
  -> 命中 Workers Cache/CDN 时不读 R2
  -> 顺序解析 ZIP local file header
  -> 边下载边把可运行 entry 追加写入少量 OPFS pack
  -> 生成 pack-index.json
  -> IndexedDB 标记 ready
  -> 取得资源共享锁，校验 pack 索引与文件长度
  -> iframe 加载 index.js，创建游戏 Worker、音频 Worker 与 AudioWorklet
  -> 两个 Worker 加载同一 JS/wasm/data，分别挂载 WORKERFS；只有游戏 Worker 挂载 IDBFS
  -> IDBFS 恢复完成后启动；引擎同步读取本地 pack 切片
  -> OffscreenCanvas 输出画面；音频 Worker 独立解码混音，经 MessagePort 直接供给 AudioWorklet
```

## 3. URL 和版本键

### 3.1 页面和资源路径

```text
GET /play/{archiveVersionId}
GET /play/player.html
GET /play/runtime/easyrpg/{easyrpgRuntimeVersion}/index.js
GET /play/runtime/easyrpg/{easyrpgRuntimeVersion}/player-worker.js
GET /play/runtime/easyrpg/{easyrpgRuntimeVersion}/player-audio.js
GET /play/runtime/easyrpg/{easyrpgRuntimeVersion}/player-audio-worker.js
GET /play/runtime/easyrpg/{easyrpgRuntimeVersion}/player-files.js
GET /play/runtime/easyrpg/{easyrpgRuntimeVersion}/easyrpg-player.js
GET /play/runtime/easyrpg/{easyrpgRuntimeVersion}/easyrpg-player.wasm
GET /play/runtime/easyrpg/{easyrpgRuntimeVersion}/easyrpg-player.data
```

`/play/runtime/easyrpg/{version}/` 由 `public/play/runtime/easyrpg/{version}/` 提供静态文件。[当前构建配置](../lib/archive/easyrpg-runtime.json)是页面和导入脚本共用的唯一版本来源，`easyRpgRuntimeBasePath` 据此生成资源路径。`public/play/runtime/easyrpg/` 只保留这一版；升级导入成功后删除其他版本目录。

版本号仍保留在 URL 中，使 JS、WASM 和 SoundFont 可以使用长期 immutable 缓存。同一版本路径的文件不可改写；任何运行时或补丁变化都必须使用新版本号。`.gitattributes` 禁止 Git 转换运行时目录内文件的换行，以保持导入字节与记录摘要一致。新部署不提供旧运行时 URL，跨部署尚未启动的旧页面需刷新后使用当前版本；不保证旧页面继续加载已删除的资源。

### 3.2 Play key

本地安装只绑定游戏资源与本地格式：

```text
archive_version_id
manifest_sha256
web_play_installer_version
```

当前由 `lib/archive/web-play.ts` 的 `buildWebPlayKey()` 生成：

```text
playKey = av-{archiveVersionId}-{manifestSha256Short}-{webPlayInstallerVersion}
```

归档、manifest 或本地安装格式变化时生成新安装。播放器版本和下载 ZIP 构建版本分别管理运行组件与传输缓存，不参与 `playKey`；兼容的播放器升级或 ZIP 打包实现更新直接复用已安装资源。若播放器变更要求新的本地格式或文件过滤规则，须同时提升 `webPlayInstallerVersion`。

安装记录与 `pack-index.json` 不保存播放器或 ZIP 构建版本；页面每次从当前元数据取得运行组件 URL。资源锁和旧资源回收仍按 `playKey` 工作，存档与截图继续按 Work ID 独立保存。本次切换会让此前包含 runtime 的旧安装键失效，首次需重装一次；新安装完成后回收未被其他页面使用的旧资源，不删除存档和截图。

## 4. CDN ZIP Bootstrap

在线游玩必须 fetch 与下载按钮相同的下载 URL，复用同一份 ZIP 字节和同一个 Workers Cache/CDN cache key。

```text
GET /api/archive-versions/{archiveVersionId}/download?zip_builder={downloadZipBuilderVersion}
```

注意：

- `Content-Disposition: attachment` 不影响 `fetch()` 读取响应体，不需要为了 Web Play 改出另一条 URL。
- 不要添加 `web_play=1` 之类会改变 cache key 的查询参数，除非下载端显式把它归一化到同一 cache key。
- Web Play 下载 URL 不改变，普通下载 ZIP 仍包含 `RPG_RT.exe`、DLL 和 `.txt` 文件；OPFS 本地运行目录会跳过 `.txt`、`.exe` 和普通 `.dll` 文件，但保留根目录的 `accord.dll`、`ultimate_rt_eb.dll`、`harmony.dll`、`dynloader.dll`、`Destiny.dll` 供 EasyRPG 识别引擎与补丁（文件名忽略大小写），减少不参与 EasyRPG Web 运行的本地写入。
- Web Play 元数据必须同时返回归档总量和本地安装目标总量。归档总量用于说明下载 ZIP 的完整内容；本地安装目标总量由 `archive_versions.web_play_file_count` 和 `archive_versions.web_play_size_bytes` 保存，commit 时按 manifest 通过共享的 `shouldSkipWebPlayLocalWrite` 策略预先统计（包含五个引擎/补丁识别 DLL）；修改该策略时需按 manifest 重算已有归档的安装总量，安装进度条的文件数和写入体积必须使用这个口径。
- ZIP 下载进度来自 `Content-Length`；下载端必须继续保证固定长度响应。
- 下载 ZIP 必须使用 STORE，并在 local file header 中写入明确 `crc32`、compressed size 和 uncompressed size；不能使用 data descriptor。这样浏览器安装器可以顺序解析 entry，不需要等待中央目录。
- ZIP 只在下载和解包过程中存在，解包完成后不进入 OPFS 和 IndexedDB。`.txt`、`.exe` 和普通 `.dll` entry 在本地写入阶段跳过；五个根目录引擎/补丁识别 DLL 写入 pack，供引擎读取真实文件。保留识别文件不等于支持执行原生插件。

## 5. OPFS 本地目录

当前 OPFS 根目录：

```text
OPFS/
  viprpg-archive/
    games/
      {playKey}/
        pack-index.json
        packs/
          assets-000.pack
          assets-001.pack
```

原子性由 IndexedDB 状态控制，而不是依赖目录重命名：

- 安装开始前将 `status` 写为 `installing`。
- 安装过程中顺序写入 `games/{playKey}/packs/*.pack`。
- 全部 entry 写入、`pack-index.json` 生成完成后，最后一次事务把 `status` 改为 `ready`。
- 浏览器崩溃后，如果看到遗留的 `installing`，UI 提供“清理并重装”。
- `ready` 之前页面不能把该目录交给播放器。

## 6. IndexedDB 状态

当前使用两个 object store。

### 6.1 `web_play_installations`

```text
playKey
archiveVersionId
manifestSha256
webPlayInstallerVersion
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
crc32
installed
updatedAt
```

`web_play_files` 是 UI/调试清单，不是运行索引。运行索引以 OPFS 根目录的 `pack-index.json` 为准。

## 7. Web Worker 安装器

ZIP 下载、解包和 OPFS 写入都必须在 Web Worker 内执行。主线程只负责 UI。

任务：

- `navigator.storage.persist()` 和 `navigator.storage.estimate()` 由页面主线程调用，再把结果传给 Web Worker；Worker 环境不假设完整暴露持久化请求能力。
- 根据 ArchiveVersion 下载 URL fetch ZIP。
- 使用响应 `Content-Length` 计算下载进度。
- 下载阶段使用 `ReadableStream` 显示进度，并顺序解析 ZIP local file header。
- 对每个 STORE entry 读取 local header 中的 size/CRC；如果发现 data descriptor flag，安装失败并提示下载 ZIP builder 不可流式安装。
- 逐文件规范化路径，按共享本地安装策略过滤文件，并把 entry 字节追加写入当前 OPFS pack。
- Pack 默认按约 256 MB 分段，例如 `assets-000.pack`、`assets-001.pack`；单个 entry 超过分段阈值时单独占用当前 pack。
- 小于分段阈值的游戏生成 1 个 pack 是预期行为。Pack 的第一目标是减少 OPFS 文件数量和 `createWritable/close` 成本，不是按目录制造并行写入。
- ZIP 网络流的 chunk 可能很碎，不能把每个 chunk 都直接 `writable.write()` 到 OPFS。安装器必须先在 Worker 内聚合到约 1 MB 再写入 pack，降低 OPFS write 调用次数和 backpressure。
- 生成 `pack-index.json`，记录原始相对路径到 `{ pack, offset, length, crc32, contentType }` 的映射。查找 key 使用小写规范化路径，记录值保留真实路径。
- OPFS 不再为每个资源创建独立文件，因此不需要目录 handle cache 或小文件写入并发调度。
- 文件清单写入 IndexedDB 时批量提交，进度状态按时间节流聚合更新；不能每个文件创建一次独立 IndexedDB 事务。
- 持续更新 IndexedDB 进度：已下载字节、已安装文件、当前文件。
- 安装日志必须能区分 ZIP 响应头等待、CDN/Workers Cache 状态、ZIP 下载速率、本地写入速率、OPFS write 等待耗时、write 调用次数、IndexedDB 文件记录耗时和索引写入耗时。
- ZIP fetch 或读取过程中出现 `network error`、`Failed to fetch`、HTTP 408/429/5xx、连接重置或 ZIP 截断这类可重试错误时，安装器最多自动重试 3 次。每次重试前必须清理半成品 OPFS 目录和 IndexedDB 文件记录；路径冲突、ZIP 格式不兼容、空间不足、取消安装等确定性错误不能自动重试。
- 安装完成后生成 `pack-index.json`，再把安装状态改为 `ready`。

安装器不使用 `fflate` 的流式 unzip 处理下载 ZIP。下载 ZIP 已固定为 STORE + local header 明确 size/CRC，安装器只需要极小的顺序 ZIP parser，不需要完整 unzip 抽象。

## 8. 本地资源挂载

安装器只写 `pack-index.json`，不生成另一份文件名索引。启动时校验安装版本、manifest 摘要、pack 长度、文件切片边界、重复路径、文件/目录冲突与 WORKERFS 不能安全表示的路径名，再传递 `{ blob: File, metadata: { files } }`。

WORKERFS 使用 `Blob.slice()` 表示文件，并在引擎实际读取时通过 Worker 内的 `FileReaderSync` 取得所需字节。大小写、去扩展名和 NFKC 查找交由引擎现有的 FileFinder/DirectoryTree 处理，不再在安装器、Service Worker 和引擎之间复制三套名字映射。

当前安装器版本为 `opfs-v12-workerfs`。安装身份变化需重新安装；存档身份仍为 Work ID。资源包就绪不代表每张图片已经解码，解码和引擎图片缓存仍按游戏需要发生。

## 9. Worker 运行边界

- 一个专用 Worker 运行 C++/WASM 引擎、文件读取、软件绘制与音频混音；没有 pthread 或自建文件 RPC。
- `OffscreenCanvas` 的 WebGL2 负责上传引擎帧缓冲并按最近邻显示；页面不逐帧搬运像素。
- 页面收集键盘、鼠标、触控、标准手柄输入，通过消息交给引擎。移动虚拟控制器沿用网站已有界面。
- AudioWorklet 消费有上限的 PCM 队列，不需要 SharedArrayBuffer、COOP 或 COEP。超长同步解码仍可能造成掉帧或音频欠载；本地同步读取消除的是资源异步完成前的缺图窗口，不承诺所有素材零耗时。
- 视频以本地 Blob 交给页面的视频元素，不先把整段视频读入 WASM。
- 网络只用于安装与加载固定运行组件；缺少游戏资源时由引擎记录缺失，不向云端逐文件回退。

## 10. 在线游玩页面

`/play/{archiveVersionId}` 与 `/games/{workId}` 复用作品页头、导航标签和侧栏结构。桌面端把游玩画面作为主栏正文，评论紧接在画面下方；侧栏保留游玩操作和作品资料。移动端依次展开游玩操作、画面、评论和作品资料，不把评论藏进弹窗或独立页面。

播放器主体固定使用 4:3 画面比例。容量、持久化授权、安装记录和运行日志属于诊断信息，默认收进折叠区；安装、启动、全屏和下载保留为直接操作。

`/play/{archiveVersionId}` 至少需要这些状态：

- Maniac 作品：允许尝试在线游玩，并显示兼容性提示。
- 未安装：显示游戏大小和安装按钮；浏览器存储用量放在诊断区。
- 安装中：显示 ZIP 下载进度、解包进度、当前文件、已写入容量；关闭页面前用 `beforeunload` 拦截。
- 安装失败：显示失败阶段、错误和“清理重装”。
- 已安装：游玩操作只显示“启动游戏”。桌面端默认窗口游玩；移动端（无悬停且主指针为触摸）按本地保存的方向进入全屏，没有偏好时使用横屏。安装与启动统一使用 Rm2kButton。卸载游戏、导出存档和日志留在诊断区，不提供单独的重新安装按钮；游戏启动中或运行中禁用卸载，避免 OPFS 读写竞争。
- 运行时在窗口操作区显示齿轮图标按钮，全屏工具栏的齿轮按钮仅在 PC 端显示；通过会话输入接口按下并释放 F1，打开游戏设置，不触发浏览器帮助。
- 原生全屏的容器定位、尺寸、边框与圆角直接由 `#web-player-frame:fullscreen` 控制，随浏览器全屏状态同步应用和恢复；React 的原生全屏状态只由 `fullscreenchange` 更新，用于工具栏和移动控制器等界面。网页全屏仍由 `pageFullscreen` 控制容器样式，避免原生切换完成后再切换一次容器布局。
- 运行中：桌面端在原启动位置并列显示“网页全屏”“全屏幕”、游戏设置和截取图片按钮；移动端显示“全屏幕”和游戏设置，截图改为可配置虚拟按钮。非全屏时游戏区域只显示 4:3 游戏画面，不显示控制器、工具栏、布局编辑、启动占位或提示叠加层；运行状态和错误仍可显示在游戏区域外。网页全屏让 iframe 铺满浏览器视口，在右上角显示恢复按钮；桌面端 canvas 保持 4:3 居中。全屏幕优先使用外层播放器容器的浏览器原生 fullscreen；浏览器拒绝时改为页面铺满，不调用 EasyRPG runtime 自带 fullscreen。移动端只有一个方向切换按钮，显示可切换到的方向；恢复窗口不会重建 iframe 或重启游戏。
- 移动端全屏运行时默认显示十字键、A（键盘 Z，确认）和 B（键盘 X，取消／菜单）。Shift、Menu（F1）、Debug（F9）、log（反引号键）、x3（F）、x10（G）及相机图标的截图按钮默认隐藏，可在布局编辑中各自添加或删除。x3、x10 与 A、B、截图按钮使用圆形，大小调整时保持宽高相等。十字键可滑动换向、组合斜方向，也可与操作键同时按住；输入通过会话接口转成 iframe 内键盘事件，再由宿主转发到引擎 Worker，截图按钮直接调用站点的截图保存流程。抬手、触控取消、失去捕获、窗口失焦、后台切换、方向／布局模式切换和会话销毁时释放相应输入。
- 移动端全屏横屏时，方向切换、恢复窗口和布局设置按钮位于左上纵列；竖屏保持右上横排。默认控制器布局参考 GBA／GBA SP：十字键在左，A 在右上、B 在左下，横屏分列画面两侧，竖屏放在画面下方。竖屏全屏游戏画面默认靠上，保持 4:3。虚拟按钮使用纯色，不使用毛玻璃效果。
- 横竖屏均可编辑按钮布局。十字键整体移动，A、B 和每个可选功能键均独立定位；可在整个可用区域自由拖动，每个控件分别调整大小（50%–200%）和透明度（0%–100%）。只有游戏画面限制为竖屏上下移动，横屏画面位置固定。控件大小和位置会限制在安全区域内。属性面板不显示操作文字提示，横屏按选中按钮所在的左右半屏显示在另一侧，竖屏按上下半屏显示在另一侧；面板内容超出可用空间时滚动。属性按钮用上下三角表示展开状态，展开时高亮；拖动期间临时隐藏面板，完全透明的按钮仍有编辑边框和名称。
- 布局编辑工具栏在“属性”左侧提供“触控”按钮，文字右侧显示复选框，默认未勾选，点击整颗按钮切换。开关即时保存至同一份本地配置的 `touchEnabled`，横竖屏共用；只在移动端生效。关闭时，窗口与全屏模式均屏蔽游戏 iframe 的直接点击／触摸，虚拟按钮输入不受影响；开启后恢复游戏画面的直接操作。布局编辑期间仍屏蔽游戏画面输入，拖动布局正常；桌面鼠标操作不受这项配置影响。
- 布局支持保存、取消和恢复当前方向的默认值。编辑时拦截游戏触控；方向或窗口模式变化取消未保存的调整。方向偏好与布局统一保存在 `localStorage` 的 `viprpg:web-play:controls` 中，`layouts.portrait`、`layouts.landscape` 分开保存；各自记录画面位置以及每个按钮的位置、大小、透明度和显示状态。位置用各元素可移动距离的比例表示，适应视口变化；删除可选按钮保留其属性，重新添加可恢复。布局编辑的拖动与边界限制方式参考 [melonDS Android 的布局编辑器](https://github.com/rafaelvcaetano/melonDS-android/blob/master/app/src/main/java/me/magnum/melonds/ui/layouteditor/LayoutEditorView.kt)。
- 收藏：在线游玩卡片在启动/全屏操作下显示收藏按钮，不再显示下载 ZIP 按钮；安装仍使用原 ZIP 下载接口。
- 截图：桌面端窗口和全屏模式均提供截取图片按钮；移动端通过默认隐藏的可配置虚拟截图按钮触发，沿用相机图标，可分别调整位置、大小、透明度。全屏时截图成功与失败反馈均显示 1 秒；移动端窗口模式的成功提示显示 1 秒，错误提示保留较长时间。通过 Worker 调用引擎的截图接口，从软件帧缓冲生成原始分辨率 PNG。截图按 Work ID 存入独立 IndexedDB `viprpg_web_play_screenshots_v1`，同一游戏的各归档版本共用，清理安装缓存不会删除截图。已有截图时，在在线游玩卡片下方显示两列截图画廊，每页 6 张，支持翻页、灯箱缩放和单张 PNG 下载；可跨页勾选截图，按所选、本页或全部范围打包为 ZIP 下载。预览的 Blob URL 随页面卸载释放。
- 本地数据与诊断：运行中提供“停止游戏”，等待存档持久化后销毁 Worker 和 iframe 并退出全屏，回到可再次启动的已安装状态；写入失败时报告错误并保留重试机会。启动尚未完成时禁用停止按钮。
- 自动清理保护：展开诊断时只调用 `persisted()` 查询当前状态并刷新存储估计；安装结束后展开中的诊断也刷新，不把安装记录中的旧快照当作实时授权。只在用户点击安装时由页面调用 `persist()` 申请，区分未获得、不支持、查询失败和申请失败；保护失败不阻止安装，Worker 不申请权限。存储估计不可用时显示“未知”。保护不代表云备份，也不能阻止手动清除站点数据。
- “本站浏览器用量”使用当前 origin 的 `storage.estimate()`，不是当前游戏体积。清理后刷新估计。
- 本地资源生命周期：运行前取得以 playKey 为粒度的 Web Locks 共享锁，并在锁内确认安装仍为 ready；销毁 iframe 后释放锁。安装 Worker、手动删除及旧资源回收使用同名排他锁，无法立即取得锁时不等待、不覆盖其他页面的数据。
- 新版安装成功、停止游戏或再次进入已安装页面时尝试回收旧资源。回收前读取线上当前 Web Play 元数据，只有当前版本本地 ready 才清理同作品其他安装；旧记录缺少 workId 时只按相同 archiveVersionId 归属。失败安装、正在安装或运行的版本受到同一把锁保护，不删除存档数据库或截图数据库。
- 所有当前页面均使用相同 Web Locks 协议，不再用 Service Worker 探测页面。关闭或崩溃会由浏览器释放 Web Lock；不依赖持久化“运行中”标记，不保证网站关闭时仍能后台清理。
- 运行日志：加载 runtime 前接入播放器 iframe 的 console.debug/log/info/warn/error，同时收集未捕获错误与 Promise 拒绝，保留浏览器控制台原输出。页面与剪贴板统一逐行使用 `[HH:mm:ss]内容` 格式，警告与错误通过颜色区分，不重复输出来源和级别文字；“清空”旁提供“复制”按钮，按显示顺序复制当前日志。保留最近 300 条（每条最多 16,000 字符），停止后可继续查看。Worker 将引擎日志发给 iframe，iframe 转发至 console 与页面；页面每 200 毫秒批量更新日志，避免高频警告阻塞导航。
- 中断安装：刷新或浏览器崩溃后，如果 IndexedDB 仍记录 `installing`，页面提示上次安装未完成，并提供“清理并重装”。当前不从半截 ZIP 继续恢复。

本地缓存管理并入 `/play/{archiveVersionId}`。

## 11. EasyRPG runtime

`public/play/runtime/easyrpg/{version}/` 只保留一套当前运行组件：

- `index.js`：播放器页面入口，原始构建文件名为 `player-host.js`。
- `player-worker.js`、`player-audio-worker.js`、`player-audio.js`：游戏 Worker、原生解码与混音 Worker、音频输出。
- `player-files.js`、`web-audio.md`：有容量上限的本地文件缓存及音频架构说明。
- `easyrpg-player.js`、`easyrpg-player.wasm`、`easyrpg-player.data`：引擎及共用 SoundFont。
- `player-movie.js`、`player-movie-worker.js`、`movie-decoder.js`、`movie-decoder.wasm`：按需加载的视频播放与精简 FFmpeg 解码器。
- `movie-decoder.LICENSE.txt`、`web-movies.md`：解码器许可及构建、格式范围说明。
- `COPYING`、`SOURCE.json`：许可证、来源、文件摘要。

React 页面通过 [createPlayerSession](../app/play/%5BarchiveVersionId%5D/web-play-player.ts) 创建同源 `/play/player.html` iframe，加载入口并传入 `workId`、`runtimeBase`、本地 packages 与启动参数。首个游戏画面完成后才报告启动成功。截图调用引擎已有 PNG 输出，返回原始分辨率的 Blob。

音频 Worker 运行同一个 WASM 模块的独立实例，复用 C++ 解码器、混音器和音效缓存，不启动游戏、不挂载存档。音频指令与 MIDI 播放状态走 Worker 间 MessagePort；PCM 由音频 Worker 直接发给 AudioWorklet，不经过游戏或网页转发。音色库在启动阶段初始化。停止时两个 Worker 一同释放；运行组件升级不改变安装键、pack 或存档格式。

两个实例各有 32 MiB 的原文件字节 LRU 缓存：不超过 16 MiB 的文件整文件读取，大文件按 512 KiB 分块；解码器的小读取直接命中内存，缓存淘汰不改变已打开文件的位置。音频队列最多 3 个已排队或在途的 1024 帧块，48 kHz 下约 64 ms；欠载恢复等待两个块并以 64 个样本渐入/渐出。独立供音能够隔离游戏和网页停顿，但音频线程自身的昂贵解码仍需实机测量，不能承诺任意设备零停顿。

停止与站内离页须等待 `player.stop()`：先退出引擎，再等待串行 `IDBFS.syncfs(false)`，最后关闭音频、终止 Worker、移除 iframe、释放资源共享锁。写入失败保留 Worker 与锁并允许重试。浏览器强制关页或进程被杀时，异步写入完成没有保证，因此游戏正常保存时也会同步 IDBFS。安装 Worker 在离页时终止；普通页面数据刷新不重建播放器。

当前构建、基线提交、产物摘要均以 [easyrpg-runtime.json](../lib/archive/easyrpg-runtime.json) 为准。工作树构建明确记录 `sourceState: working-tree`、源码快照摘要与 liblcf 提交，不能将其误称为基线提交的原始产物。源码快照与 Web ZIP 保存在 Player 的 `build/artifacts/`。

导入命令为 `node scripts/import-easyrpg-kai.mjs <Web ZIP 路径>`。脚本验证 ZIP、SoundFont、Player 与解码器随包许可证的摘要，保留构建字节，只将入口文件重命名为 `index.js`；不在压缩后的生成代码中做字符串补丁，也不依赖联网下载许可证。全部验证通过后先写入临时目录，再原子改名，最后清理旧版本目录。同版本重复导入必须逐字节相同；任何产物变化均使用新版本 URL。

视频优先走浏览器原生播放；媒体格式失败时才加载独立 FFmpeg/WASM Worker，补充 DivX/Xvid、Microsoft Video 1、MPEG-1/2 等旧编码。解码器按本地 Blob 切片读取，逐帧解码，并用当前 AudioContext 调度声音；不修改游戏 pack，也不改变安装键或存档目录。源码版本、上游下载摘要和解码器许可证摘要记录在运行时配置及 `SOURCE.json` 的 `movieDecoder` 字段中。具体格式子集、内存限制见随包 `web-movies.md`。

Android 套壳共用这套 Web 解码器。`android:web:build` 会完整复制当前 runtime，Gradle 同步读取版本号；现有 WebView 已启用 JavaScript、媒体播放，并为 WASM 提供正确 MIME 类型，不需新增原生解码库或权限。升级运行时后必须重新打包 APK，才能更新 APK 内离线运行组件；只部署网站不能更新已安装 APK 的离线副本。

运行组件的 immutable 缓存与 `application/wasm` 类型头由 [public/_headers](../public/_headers) 定义。内容安全策略需允许同源 Worker、AudioWorklet、WASM 及本地 Blob 视频。无需跨源隔离响应头。

Kai 默认使用 FluidSynth 与 `.data` 中的 `/builtin/recommended.sf2`。音色库由播放器共用，不写入各游戏 pack。预加载和 IDBFS 恢复全部完成后再启动，已有播放器音频设置继续生效。

## 12. 存档策略

游戏存档不放入 OPFS 游戏目录。

- EasyRPG 存档沿用 Emscripten IDBFS，固定挂载于 `/work-saves/<workId>`。安装键不参与存档身份；归档、播放器、安装器升级沿用同一 Work 的存档。不同 Work（包括其他译版）互不共用，同一浏览器内也不按账号区分。
- 游戏资源安装和存档生命周期分开。
- 卸载游戏时不删除存档。
- 诊断区的“导出存档”只读访问当前 Work 的 IDBFS `FILE_DATA`，将存档目录直属的 `.lsd` 文件（扩展名不区分大小写）以原文件名放入 ZIP，下载名为 `<游戏名称>.zip`。读取、打包和下载均在浏览器本地完成，不二次确认；没有存档时禁用按钮。展开诊断区时定期刷新数量，点击时重新读取已写入的存档，卸载后仍可导出。
- 当前不提供单独清除存档、导入或云同步界面。

## 13. 浏览器存储策略

进入安装前应调用：

```ts
const estimate = await navigator.storage.estimate();
const persisted = await navigator.storage.persist();
```

说明：

- OPFS、IndexedDB、Cache API 和 EasyRPG IDBFS 共享同一个 origin 存储额度。
- `persist()` 只能请求浏览器尽量不要自动清理本站数据，不保证成功。
- 普通浏览器优先将游戏资源放入独立 Storage Bucket，按最后游玩后 7 天到期；不支持时使用 OPFS 并在访问时清理。存档仍保留在默认存储中，游戏桶不申请持久化。Android 套壳继续使用原 OPFS 目录，不设置 7 天期限。详见[浏览器存储说明](./browser-game-storage.md)。
- 持久化请求应在页面主线程发起；Worker 只接收主线程传入的结果并负责安装。
- UI 必须显示已用空间、估算额度和本游戏预计安装大小。
- 空间不足或 `QuotaExceededError` 时，安装失败并引导用户删除其他本地缓存。

## 14. 安全和兼容

- ZIP entry 解包必须拒绝路径穿越。
- 同一 `playKey` 的安装、删除与回收使用跨页面排他 Web Lock，与运行期间的共享锁互斥；无法立即取得锁时提示重试。遗留 `installing` 状态按中断安装处理并清理重装。
- 安装完成前不能启动 EasyRPG。
- `rpg_maker_2003_maniac` 作品允许在线游玩，但页面显示兼容性提示。
- 非 UTF-8 路径问题会直接影响 EasyRPG 运行；真实样本出现路径损坏时，按[归档路径与编码](./archive-storage.md#路径与编码)核对 manifest、原始路径字节和 ZIP 输出。
- OPFS 和 IDBFS 均为同源存储；当前构建只服务本站，不支持跨域官方播放器嵌入。
- 本地索引、pack 长度或路径校验失败时中止启动并提示重装；引擎中的素材缺失通过运行日志诊断。

## 15. 当前验收边界

2026-09-22 在 Chromium 151.0.7922.34 验证了首版 Worker 运行包 `2026.9.2-site-d65072755356`：

- 安装键的定向检查通过：替换播放器版本或 ZIP 构建版本，安装键保持一致；替换归档、manifest 或本地格式，安装键改变。导入包与网站生产构建中的运行文件逐字节一致。
- 隔离 D1/R2 的完整 `flow --game` 回归通过：官方 TestGame 实际菜单存档、IDBFS 写入、站内离页和返回、刷新读档、F4 网页全屏、WASM 加载中离页，以及中断安装后重装并保留存档。AudioWorklet 加载取消使用未完成的 `addModule()` Promise 注入，验证相同等待点的释放；浏览器请求拦截无法观测该加载。
- 定向素材场景显示 24 张不同文件两轮（共 48 次显示，47 次换图）；逐帧采样未出现缺图，换图期间没有资源 HTTP 请求。覆盖非 ASCII 文件名、大小写和省略扩展名查找。
- AudioWorklet 输出非零游戏音频；本次普通素材换图场景没有缓冲耗尽。采样 287 帧，帧间隔 P95 为 19.3 毫秒、最大 21 毫秒；这些是本机单次观测，不设跨设备门槛。引擎 PNG 和实际画布的像素颜色、方向均正确。
- 注入 IDBFS 写入失败后，停止操作报告失败并保留 Worker 内数据；再次停止能写入 IndexedDB 后结束 Worker。
- 移动触摸模拟完成 A/B/方向输入、全屏、方向切换、截图保存和停止；页面虚拟按钮不会使引擎误判失焦暂停。

`scripts/easyrpg-flow-check.ts` 通过 Playwright 观察真实 Worker；`scripts/easyrpg-worker-check.mjs` 使用官方游戏数据库和生成的最小事件场景，性能采样只存在于测试中。运行方法见[维护与回归手册](./maintenance-regression.md#easyrpg-官方游戏回归)。报告与截图保存在忽略的 `output/easyrpg/`。

2026-09-24 音频独立 Worker 版本 `2026.9.2-site-8f05deecdd5c` 完成以下定向验证：

- 当前网站包连续换图 47 次没有缺图帧，运行期间没有素材 HTTP 请求；采样 288 帧，帧间隔 P95 为 19.6 毫秒、最大 23.1 毫秒。
- 分别在游戏 Worker、页面线程注入 500 毫秒忙等待后，音频仍持续输出，欠载计数为 0。退出时两个 Worker 均释放；存档失败保留会话并允许重试。
- 使用预生产作品 2 的 WAV、OGG、MP3 原始音频和官方 TestGame 的 MIDI，在隔离场景中验证首次播放、重复切换、暂停恢复、音量与 SoundFont 切换。该轮欠载为 0，排除故意注入停顿后的最大帧间隔为 24.5 毫秒。原始文件 SHA-256 已与游戏清单核对；这不是原游戏所有场景的逐一实玩。
- 缓存单元检查覆盖小读取合并、随机定位、跨块读取、EOF 和 32 MiB 上限下的淘汰重读；供音检查覆盖欠载淡出和恢复水位。
- 当前包的隔离 D1/R2 完整 `flow --game` 回归通过：游戏菜单存档、IDBFS 写入、离页释放两个 Worker、返回与刷新读档、全屏、WASM/AudioWorklet 启动取消、卸载后中断安装及重装保留存档。旧检查中的固定标题、已移除的重装按钮和中断安装状态等待已与当前界面对齐。

上述结果是本机观测，不是所有游戏或物理手机的兼容认证。超大图片首次解码仍可能卡帧；音频已独立，但非常昂贵的音频解码仍可能耗尽供音缓冲。尚未验证 Android 实机、非 Chromium 浏览器和所有 Maniac 扩展。

- 已发布且存在当前已发布归档版本的作品显示在线游玩入口。
- RPG Maker 2003 Maniac 作品显示兼容性提示。
- 首次点击在线游玩时显示下载进度、解包进度、当前文件和本地缓存状态。
- 下载 ZIP 复用现有下载 URL；命中 Workers Cache/CDN 时下载观测记录不增加 R2 Get。
- 安装完成后 OPFS 中有 `pack-index.json` 和少量 `packs/*.pack`，没有完整 ZIP 或逐文件资源树。
- `pack-index.json` 中不包含 `.txt`、`.exe` 和普通 `.dll` 文件；根目录的五个引擎/补丁识别 DLL 必须保留，并在 WORKERFS 挂载的游戏目录中可见。
- 刷新页面后无需重新请求云端即可启动已安装游戏。
- 卸载游戏后可再次安装。
- 浏览器崩溃或安装中关闭页面后，再进入能清理并重新安装。
- EasyRPG 能启动一个已知可玩的样本游戏。
- 索引或 pack 不完整时拒绝启动；素材缺失由引擎记录，不向云端回退。
- 运行中不能卸载或安装游戏；重复点击启动不会重复加载 runtime。
- 详情页和游玩页使用同一作品页头与侧栏；评论位于各自主栏正文末尾，游玩页评论紧接游戏画面。
- 游戏画面保持 4:3；桌面端默认窗口游玩，启动后可分别进入网页全屏和全屏幕；移动端按缓存方向全屏，显示虚拟控制器，并提供单个横竖屏切换按钮与恢复窗口。横屏工具栏位于左上纵列，竖屏画面默认靠上且可上下移动；两个方向都能自由编辑各按钮的位置、大小、透明度与可选功能键。
- 不支持或拒绝原生 fullscreen、Screen Orientation Lock 的浏览器仍能页面铺满并旋转画面，同时提示用户手动旋转设备。

### 交互与兼容性核对

文件跳过、pack 写入和资源挂载分别以第 4、7、8 节为准；这里保留运行时交互需要单独核对的边界。

- EasyRPG canvas 必须可聚焦，并在启动和全屏切换后主动聚焦；否则方向键和确认键可能落到页面而不是游戏。
- iframe 的 canvas 由页面 CSS 按 4:3 等比放大到视口可容纳的最大尺寸；不修改引擎绘图缓冲区分辨率。移动端竖屏通过外层画面容器控制高度和垂直位置，旋转降级时画面、控制器、工具栏一起旋转，触控坐标同步转换。截图始终只截取原始游戏 canvas。
- 播放器 iframe 内取消 `contextmenu` 默认行为，包括画布与黑边区域；保留鼠标按下、抬起等事件，游戏仍可接收右键。监听随播放器会话销毁，站点其他区域的右键菜单不受影响。
- 移动端游戏按键通过原生、非被动的 `touchstart` 监听取消默认行为，在 Chrome 识别原生长按手势前阻止其触觉反馈；按键输入仍由 Pointer Events 处理。监听仅在显示移动控制器时启用并随之清理，截图按钮与工具栏保留默认点击行为。实际震动效果需在 Android 手机验证。
- 全屏由网站控制外层播放器容器，引擎的全屏请求回调给页面；不调用 SDL/Emscripten 窗口全屏逻辑。
- 移动端方向切换优先调用 Screen Orientation Lock；不可用或被拒绝时通过 CSS 旋转游玩界面并提示用户手动旋转设备，不能把方向锁定作为启动前提。
- 当前兼容目标是支持 OPFS、Web Locks、Worker 内 OffscreenCanvas/WebGL2、AudioWorklet 和 WASM 的 Chromium 浏览器，提供桌面和移动布局；不承诺其他浏览器或未实测设备的行为。

## 16. 当前非目标

- 独立的本地缓存管理页。
- 半成品续传。
- 按 `pack-index.json` 中的 CRC32 和 canonical manifest SHA-256 修复 pack 切片。
- 存档导出、导入和云同步。
- 超大游戏的排队安装和后台恢复。

## 17. 参考链接

- EasyRPG Web Player: https://easyrpg.org/player/guide/webplayer/
- MDN OPFS / `StorageManager.getDirectory()`: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory
- MDN Storage quotas and eviction criteria: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN `StorageManager.persist()`: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- MDN Cache API: https://developer.mozilla.org/en-US/docs/Web/API/Cache
- Emscripten File System API / IDBFS: https://emscripten.org/docs/api_reference/Filesystem-API.html
