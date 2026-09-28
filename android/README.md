# VIPRPG Android 离线版

Android WebView 的「主站」页直接使用网站；默认打开「主站」，网络不可用时回到本地游戏。底栏「离线游玩」的游戏库界面由 Android 原生绘制；APK 内的 `/_android/` 页面在后台读取同一来源的 IndexedDB 安装清单和 OPFS 资源，并在启动游戏时承载 EasyRPG Web。主站与离线运行页使用**同一个 HTTPS 来源和同一个 WebView 数据目录**，已有安装和存档无需迁移。`/play/player.html` 与当前 `lib/archive/easyrpg-runtime.json` 对应的运行组件也从 APK 提供，断网重新打开 App 仍可启动。手机浏览器与本 App 的数据目录不共享。首页和作品库固定竖屏，离线游戏按控制偏好切换方向；底栏顺序为「主站」「离线游玩」「截图图库」「版本信息」，后三项由 Android 原生绘制。

旧格式视频共用 Web runtime 的精简 FFmpeg/WASM 解码器，浏览器原生播放失败时按需加载。`npm run android:web:build` 会连同视频 Worker、解码器 JS/WASM 和许可证完整复制当前 runtime；现有 WebView 配置已支持该加载方式，无需增加原生解码库、权限或跨源隔离。更新网站 runtime 后须重新构建并安装 APK，已安装 APK 的离线副本不会随网站部署更新。实际播放能力仍依赖系统 WebView 和设备性能，构建通过不代表完成手机播放验收。

作品封面在安装时缓存到 WebView 的 Cache Storage，与游戏清单同源；断网时仍能显示新安装作品的封面。旧安装记录没有封面哈希时显示文字占位。作品库支持搜索、安装状态筛选、排序以及批量删除游戏文件，删除不涉及存档和截图。

主站以原生注入的 `VIPRPGAndroid` 识别本 App：继续使用原 OPFS 目录，不启用普通浏览器的 7 天资源清理，不显示头像菜单「已安装游戏」。旧 APK 内置的离线页也能继续读取主站新安装的游戏。手机上的普通浏览器仍采用浏览器保留策略，详见[浏览器存储说明](../docs/browser-game-storage.md)。

## 截图目录与原生图库

首次进入「截图图库」或在游戏布局中添加截图按钮时，若没有有效目录授权，则通过 Android Storage Access Framework 打开系统目录选择器。截图按钮已经启用时，首次截图也检查授权。选择可读写目录后持久保存授权；取消不会启用新的截图按钮或将截图退回网页存储。支持 Android 10 及以上；系统限制了可选择的目录，建议在 Pictures 下选择专用子目录。目录被移动、删除、权限撤回或存储卡离线时需重新选择。

在线和离线游戏仍调用引擎输出原分辨率 PNG，通过限制到本站来源及主框架的 `VIPRPGScreenshots` 消息接口交给 Android 保存；只有文件写入并回读校验成功才报告成功。网页接口仅开放目录准备、保存和在线游玩状态，图库读取、分享与删除由原生界面操作，不提供任意路径访问。系统 WebView 不支持消息监听时提示更新，不退回旧截图存储。

文件名固定为 `2026-09-28_00-35-12.583__w123__游戏名称.png`：使用截图时的系统当地时间，精确到毫秒，不记录时区、不添加随机防重名字段；游戏 ID 用于归组，名称用于展示。禁用文件名字符会替换为下划线，游戏名最多保留 40 个 Unicode 码点。图库只扫描所选目录的直接子文件，只识别符合该命名规则的截图；手动改成其他格式后不再显示，不删除无关图片。时间轴直接使用文件名中的当地日期，不依赖文件修改时间，也不在系统时区变化后换算已有截图。无需网站连接或截图数据库即可重新读取目录。

原生图库提供「时间轴」和「按游戏」两个入口。时间轴按拍摄时间倒序、按天分组，使用三列方形缩略图；按游戏显示封面合集，进入合集后显示该游戏的时间轴。同一稳定游戏 ID 改名后仍合并，并优先显示最新截图的名称。点击后原生全屏完整看图，左右滑动切换时相邻图片间有 12dp 间隔；轻点时顶部、底部控件与图片外的背景同时切换为黑色沉浸视图，再次轻点恢复，不使用明暗渐变；双指或双击缩放。上拉会退出沉浸模式，图片保持宽度向上移动，详情元素随手指连续进入；松手后展开或收回，收回后仍保持普通看图界面。点击「详情」也可展开，显示拍摄时间、游戏名称、文件名、尺寸、文件大小和保存目录。长按或右上角「选择截图」进入多选，可选择当天或当前列表全部截图，使用系统分享或批量删除。删除需确认，会永久删除原文件，无回收站；任务可取消剩余操作，逐项显示处理数量，失败项保留选择供重试。图库不提供 ZIP 导出。

更换目录不搬运、不合并、不删除旧目录内容，图库与后续截图一起切换；重新选择旧目录即可查看。图片仅在原生内存中按需解码、缓存缩略图，不再将新截图存入 IndexedDB。本次为截图功能的破坏性更新：Android 不读取或迁移旧网页截图，站内截图列表对 Android 隐藏，旧 APK 不提供新截图接口；网站与 APK 需要配套更新。普通浏览器的 IndexedDB 截图画廊与 ZIP 下载继续保留。游戏安装与存档不变。

图库交互参考红魔手机上的 Google Photos 实际操作：日期分组图片流、封面合集、手势切图和随拖动连续显示的详情。前期参考项目包括 [ReFra](https://github.com/IacobIonut01/Gallery) 和 [Fossify Gallery](https://github.com/FossifyOrg/Gallery)。使用项目暖白 `#f5f4ef`、青绿 `#1f6f67` 与线性图标；目录与刷新收进更多菜单，多选操作只在选择模式显示。查看器使用 AndroidX ViewPager2 与 [ZoomImage](https://github.com/panpf/zoomimage) 1.4.0。Material Components 1.12.0 仅使用截图模块的局部主题，不改变其他页面。ZoomImage 1.5+ 要求 SDK 37，因此当前 SDK 35 项目固定使用兼容稳定版。依赖均通过 Gradle/Maven Central 引入，许可证随 APK 的 `assets/licenses/` 分发；没有复制参考应用源码或图片。

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

首版限于 App 前台安装和离线游玩。切走在线安装页会中断当前下载，需要回到游玩页重新安装；不承诺锁屏后台下载。删除本地游戏只删除安装包，不删除已有存档。系统清除 App 数据或卸载则会移除游戏和存档。
