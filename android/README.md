# VIPRPG Android 离线版

Android 主站负责发现作品；仅在本 App 中隐藏作品的在线游玩 tab，概览按钮变为「安装到本地 / 查看下载进度 / 启动游戏」。普通 Android 浏览器保留在线游玩。原生游戏库、截图图库和版本页沿用现有 Material 控件。

应用随设备的浅色／深色设置变化，原生游戏库、图库、看图器、版本页、底栏和系统栏即时更新，不重建 Activity 或重载游戏。在线网页保留账号的「浅色／深色／跟随系统」偏好；仅「跟随系统」读取 Android 传入的 `data-system-theme`。离线 WebPlayer 同样接收设备主题，游戏画面与沉浸背景维持原本配色。支持文档启动脚本的 WebView 会在页面脚本前注入状态，旧 WebView 在页面加载完成后同步；设备主题变化会更新当前页面，无需刷新。

首次启动无需选择目录。游戏和存档保存在应用私有持久目录，截图保存到系统相册 **VIPRPG.org**。不读取、不迁移、不删除首发前的 OPFS、旧授权目录和旧私有格式。

上传时勾选「上传存档」所保留的根目录 `.lsd`，会在本地启动游戏前补入该作品的原生存档区，并沿用原子写入、哈希校验与最近两代快照。已有同名存档优先，比较时忽略大小写并使用 Unicode NFC 规范化；重复启动不重复写入。更新 APK 后，已安装且包内带存档的游戏也会在下次启动时补齐，无需重新下载。

- `games/<archiveVersionId>/`：校验后的 ZIP、索引、完成记录和封面；删除游戏仅删除这些文件。
- `saves/<workId>/`：按作品共用存档和引擎配置，记录每个文件的实际修改时间；使用原子写入、哈希校验与最近两代快照。
- `Pictures/VIPRPG.org/`：通过 MediaStore 写入 PNG，系统相册可见，卸载后保留。图库只读取当前安装有权访问、属于本应用且符合命名约定的图片；卸载重装不会自动取得旧图访问权。

长按已安装游戏打开 Material 选择弹窗，提供导入／导出存档；多选管理仍从顶栏进入。导入支持一个或多个 `SaveNN.lsd` 或 ZIP 文件（仅接受本应用导出的结构：根目录直接包含 `SaveNN.lsd`，不含子目录或其他文件），检查 LSD 文件头；同名冲突通过多选器勾选要覆盖的槽位，未选项保留本地存档，新槽位正常导入。导出列表展示文件名与修改时间；一个存档导出 LSD，多个打包 ZIP。导出的 ZIP 可直接重新导入；单次最多 100 个存档，解压总量不超过 40 MiB，重复来源槽位需分批导入。系统文件选择器只授予当次文件访问，不保留目录授权。卸载或清除应用数据会删除私有游戏和存档，请先导出需保留的存档。

原生 `InstallService` 持有前台通知，安装不依赖 Activity 或 WebView。私有原子任务日志记录排队、下载、完成、失败；进程重启恢复未完成任务，网络瞬时错误有限重试，列表允许手动重试及取消。临时 ZIP 位于 App 缓存；支持服务端 Range 时续传，不支持时安全重下。校验每项 CRC、文件数量/总大小以及写入目录前后的 SHA-256，完成标记最后写入。删除游戏或取消任务保留存档、截图；版本切换共用同一 workId 存档，但无法保证游戏作者修改数据后的内容兼容性。

安装完成后，原生任务使用主站会话 Cookie 和 WebView User-Agent 上报作品游玩数，与网页下载、外链和在线启动共用去重：同一作品、同一访客指纹在每个 UTC+8 自然日只计一次，登录状态和账号 ID 不参与公共计数去重；会话仅用于更新个人游玩历史。排队、安装失败和启动本地游戏均不计数；启动仍记录设备本地最近游玩时间。上报失败只记日志，不影响已完成安装，不在启动时补报。详见[统计说明](../docs/view-statistics.md)。

APK 内 `/_android/` 只承载 WebPlayer。原生来源受限的 `VIPRPGLocal` 主框架消息接口负责安装、状态、启动和存档；每次游戏启动发放随机资源读取能力，只在离线 WebView 内拦截。Worker 保留 32 MiB 有界缓存，按文件区间读取原生目录；游戏与音频 Worker 都走此路径。视频按块读取后交给现有浏览器/FFmpeg 解码器。`scripts/android-runtime-adapter.mjs` 只适配 APK 构建副本，网站的版本化运行组件保持不变；升级引擎后必须重新构建并验证适配。

后台下载与真实游戏读档使用 MuMu 技术验收；构建通过不能替代不同 Android 系统/WebView、SD 卡和音视频的设备验收。Android 15 对 dataSync 前台服务有系统时限，用户强行停止应用也会终止后台任务；下次打开通过任务日志恢复。

## 截图目录与原生图库

截图通过 `VIPRPGScreenshots` 来源受限的消息接口交给 Android 写入 MediaStore；以待发布状态写入并回读，确认完整后才向相册公开。不申请存储或相册读取权限。图库保留缩略图缓存，支持下拉刷新。

文件名固定为 `2026-09-28_00-35-12.583__w123__游戏名称.png`：使用截图时的系统当地时间，精确到毫秒，不记录时区、不添加随机防重名字段；游戏 ID 用于归组，名称用于展示。禁用文件名字符会替换为下划线，游戏名最多保留 40 个 Unicode 码点。图库只查询 Pictures/VIPRPG.org 相册中本应用拥有的图片，只识别符合该命名规则的截图；手动改成其他格式后不再显示，不删除无关图片。时间轴直接使用文件名中的当地日期，不依赖文件修改时间，也不在系统时区变化后换算已有截图。无需网站连接或截图数据库即可重新读取目录。

原生图库提供「时间轴」和「按游戏」两个入口。时间轴按拍摄时间倒序、按天分组，使用三列方形缩略图；按游戏显示封面合集，进入合集后显示该游戏的时间轴。同一稳定游戏 ID 改名后仍合并，并优先显示最新截图的名称。点击后原生全屏完整看图，左右滑动切换时相邻图片间有 12dp 间隔；轻点时顶部、底部控件与图片外的背景同时切换为黑色沉浸视图，再次轻点恢复，不使用明暗渐变；双指或双击缩放。上拉会退出沉浸模式，图片保持宽度向上移动，详情元素随手指连续进入；松手后展开或收回，收回后仍保持普通看图界面。点击「详情」也可展开，显示拍摄时间、游戏名称、文件名、尺寸、文件大小和保存目录。长按或右上角「选择截图」进入多选，可选择当天或当前列表全部截图，使用系统分享或批量删除。删除需确认，会永久删除原文件，无回收站；任务可取消剩余操作，逐项显示处理数量，失败项保留选择供重试。图库不提供 ZIP 导出。


图库交互参考红魔手机上的 Google Photos 实际操作：日期分组图片流、封面合集、手势切图和随拖动连续显示的详情。前期参考项目包括 [ReFra](https://github.com/IacobIonut01/Gallery) 和 [Fossify Gallery](https://github.com/FossifyOrg/Gallery)。使用项目暖白 `#f5f4ef`、青绿 `#1f6f67` 与线性图标；目录与刷新收进更多菜单，多选操作只在选择模式显示。查看器使用 AndroidX ViewPager2 与 [ZoomImage](https://github.com/panpf/zoomimage) 1.4.0。Material Components 1.12.0 用于原生页面，统一使用随系统切换的 DayNight 主题。ZoomImage 1.5+ 要求 SDK 37，因此当前 SDK 35 项目固定使用兼容稳定版。依赖均通过 Gradle/Maven Central 引入，许可证随 APK 的 `assets/licenses/` 分发；没有复制参考应用源码或图片。

## 应用更新与发布

App 默认每次冷启动检查一次更新；版本页可关闭启动检查或手动重新检查。网络异常、未配置、暂停推荐和未知本机构建都不会在启动时弹窗。只有网站推荐序号与 APK 的 `versionCode` 都更高时才提示更新；旧包被重新推荐也不会引导降级。正在游戏中时延后提示。下载交给系统浏览器，安装由用户按 Android 提示完成。

后台创建固定 slug 为 `viprpg-android` 的软件并上传图标后，选择 GitHub Release 的原始发布 APK，即可自动识别版本、平台和构建标识。修改显示名称或更新说明后点击「发布更新」，同时发布、公开并设为 Android 推荐。重复上传同一个包会定位原记录，同一构建号的不同文件会被拒绝。服务器在上传、恢复确认和发布时，从 APK 的二进制 `AndroidManifest.xml` 独立核对包名、版本号及非 debug 属性；不接受其他应用或调试包。APK 签名由构建流程与 Android 系统验证。

客户端调用 `/api/tools/viprpg-android/updates/stable/android-universal?applicationBuildId=org.viprpg.archive:<versionCode>`。构建标识来自 APK 的真实版本号，不需要手填。首次发布的新包须手动安装并在站内登记一次，之后才能准确映射本机构建。站内更新仍以后台发布为准，GitHub Release 不会自动更改站内推荐。

### GitHub Actions

[Android Release](../.github/workflows/android.yml) 仅在推送 `main` 且改动涉及 APK 构建输入时自动构建签名 APK，也支持在 `main` 手动选择 `target=staging|production`；手动启动 production 即确认本次正式发布，构建并校验 APK 后直接公开 Release，无需再次 Review deployments、第二位审核人或另打 tag。每次符合条件的 push 事件生成一个 Release（一次 push 包含多个提交时，以该 push 的最终提交打包）。

自动触发范围包括 Android 原生代码与离线页、离线页实际引用的共用游玩模块和 UI 组件、共用样式、EasyRPG 运行组件及其版本配置、应用图标，以及构建／验包脚本、依赖清单和锁文件、构建配置与 Android workflow。普通网站页面、服务端 API、数据库迁移、部署配置和文档更新不会单独触发打包；`android/` 内的 Markdown 文档也排除在外。`package.json` 或 `package-lock.json` 改动仍会触发，因为 Android 与网站共用 npm 安装环境。

网站和离线页通过 `app/shared.css` 共用主题与基础样式，网站专用样式放在 `app/globals.css`。Android 的 Tailwind 只扫描离线页和包内组件，不扫描整个网站。验包大小限制与网站上传组件共用 `lib/resource-limits.ts`，不依赖网站资源类型所在的 `lib/resources.ts`；只修改网站专用样式或资源类型不会触发 Android 构建。新增或调整离线页的共用依赖时，须同步维护 workflow 的 `on.push.paths`；新增共用 UI 组件还须更新 `android/web/styles.css` 的 `@source`。

共享样式的准入条件见 [AGENTS.md](../AGENTS.md)：须核实网站与 APK 离线页两端的实际消费者，并在样式块注释中记录。网站组件之间的复用不等于跨端共享；导航进度条、网站选择器和通知动画均留在网站样式入口。

- CI 版本名为 `0.3.<run_number>`，`versionCode = 100000 + run_number`；递增由 workflow 负责，不用逐次修改 Gradle。不要重建 workflow 或降低此序号基数；手动重建旧提交使用新的运行序号。
- tag 为 `android-<staging|production>-<versionCode>`，附件包含 `viprpg-release.apk` 与 `SHA256SUMS.txt`，说明自动结算该次提交的 GitHub release notes。所有附件就绪后才公开 Release；已经发布的运行重跑时跳过打包，避免同一构建身份对应不同文件。
- main 自动构建和手动 staging 构建连接 staging，Release 标为预发布；手动 production 构建连接 `https://viprpg.org`，先保存已验证 APK 和 SHA-256 artifact，再由发布 job 下载同一 artifact 并核对摘要后公开正式 Release，不增加第二次 review。两者都不自动更改 Latest 或网站推荐频道；正式构建与其他正式维护串行。切换来源不会迁移原来源的离线游戏或存档。
- 四项仓库 Secrets 为 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。只使用固定签名，缺少配置直接失败，不回退到临时 debug key。公开证书见 [release-certificate.pem](release-certificate.pem)，CI 发布前核对签名身份。
- GitHub 构建成功不代表网站部署或站内发布完成。站点部署仍走独立 Deploy workflow；APK 上传与发布沿用后台入口。

同包名、同签名覆盖安装会保留游戏及存档。旧 debug 包与新发布证书不同，首次切换必须先导出存档等数据；不能直接覆盖安装，也不要通过清除数据解决签名不一致。

## Docker Desktop 打包

在仓库根目录运行：

```sh
docker compose -f android/compose.yaml run --build --rm apk
```

APK 位于 `output/android/viprpg-debug.apk`。Docker 镜像独立安装 Node 24、JDK 17、Gradle 8.13 和 Android SDK 35；Linux 的 `node_modules`、Gradle 缓存和 debug 签名使用独立 Docker 卷，不读取主机的依赖或 SDK。首次构建需下载镜像、Android SDK 和 Maven 依赖。保留 `android-debug-key` 卷才能保持 debug APK 的签名身份；删除卷将改变签名，覆盖安装前应先备份 App 数据。

调试包默认指向 `https://staging.viprpg.org`，该站点当前提供仓库中的在线游玩功能。旧的 workers.dev 站点仍为上一版网站，不适合作为此 App 的安装入口。正式发布前必须先部署新版站点，再用 `SITE_ORIGIN=https://viprpg.org` 重新构建并验证。**在线安装和离线打开必须是同一个来源**；更换来源需要重新打包，且不同来源的已安装游戏互不可见。在线站点如升级运行组件，应重新打包 APK；离线页只发布当前声明的版本，不附带历史 runtime。

正式签名时以只读卷挂载 keystore 到容器内，通过 `docker compose -f android/compose.yaml run --rm -v <主机keystore绝对路径>:/run/secrets/archive.jks:ro -e SITE_ORIGIN=https://viprpg.org -e ANDROID_KEYSTORE_FILE=/run/secrets/archive.jks -e ANDROID_KEYSTORE_PASSWORD -e ANDROID_KEY_ALIAS -e ANDROID_KEY_PASSWORD apk release` 构建（环境变量值由调用环境提供）。签名文件和密码不得写入本公开仓库或 Docker 镜像。首次发布前请固定包名 `org.viprpg.archive`、签名证书、versionCode 与来源；debug 包不用于正式升级。本地默认版本为 0.3.4 / 5，可通过 `ANDROID_VERSION_NAME` 与 `ANDROID_VERSION_CODE` 指定新版本；同一构建号只能用于同一原始 APK。发布证书及密码须另行安全备份，本公开仓库只保存公开证书。

安装由原生前台服务执行，离开页面或切到后台可继续下载；进程终止后，重新打开 App 会恢复未完成任务。系统强制停止期间不能继续执行。删除本地游戏保留存档和截图。清除 App 数据或卸载会删除私有游戏、存档和任务日志，系统相册截图保留。

本次原生闭环的设备验证范围见 [验收记录](../docs/android-native-acceptance.md)。
