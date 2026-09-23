# VIPRPG Android 离线版

Android WebView 的「主站」页直接使用网站；默认打开「主站」，网络不可用时回到本地游戏；底栏「离线游玩」加载 APK 内的 `/_android/` 页面。两个页面使用**同一个 HTTPS 来源和同一个 WebView 数据目录**，因此安装清单、OPFS 资源包、存档和截图无需迁移。`/play/player.html` 与当前 `lib/archive/easyrpg-runtime.json` 对应的运行组件也从 APK 提供，断网重新打开 App 仍可启动。手机浏览器与本 App 的数据目录不共享。首页和作品库固定竖屏，离线游戏按控制偏好切换方向；底栏另有原生「版本信息」页。

作品封面在安装时缓存到 WebView 的 Cache Storage，与游戏清单同源；断网时仍能显示新安装作品的封面。旧安装记录没有封面哈希时显示文字占位。作品库支持搜索、安装状态筛选、排序以及批量删除游戏文件，删除不涉及存档和截图。

主站以原生注入的 `VIPRPGAndroid` 识别本 App：继续使用原 OPFS 目录，不启用普通浏览器的 7 天资源清理，不显示头像菜单「已安装游戏」。旧 APK 内置的离线页也能继续读取主站新安装的游戏。手机上的普通浏览器仍采用浏览器保留策略，详见[浏览器存储说明](../docs/browser-game-storage.md)。

## 应用更新与发布

App 默认每次冷启动检查一次更新；版本页可关闭启动检查或手动重新检查。网络异常、未配置、暂停推荐和未知本机构建都不会在启动时弹窗。只有网站推荐序号与 APK 的 `versionCode` 都更高时才提示更新；旧包被重新推荐也不会引导降级。正在游戏中时延后提示。下载交给系统浏览器，安装由用户按 Android 提示完成。

后台创建固定 slug 为 `viprpg-android` 的软件并上传图标后，选择 GitHub Release 的原始发布 APK，即可自动识别版本、平台和构建标识。修改显示名称或更新说明后点击「发布更新」，同时发布、公开并设为 Android 推荐。重复上传同一个包会定位原记录，同一构建号的不同文件会被拒绝。服务器在上传、恢复确认和发布时，从 APK 的二进制 `AndroidManifest.xml` 独立核对包名、版本号及非 debug 属性；不接受其他应用或调试包。APK 签名由构建流程与 Android 系统验证。

客户端调用 `/api/tools/viprpg-android/updates/stable/android-universal?applicationBuildId=org.viprpg.archive:<versionCode>`。构建标识来自 APK 的真实版本号，不需要手填。首次发布的新包须手动安装并在站内登记一次，之后才能准确映射本机构建。站内更新仍以后台发布为准，GitHub Release 不会自动更改站内推荐。

### GitHub Actions

[Android Release](../.github/workflows/android.yml) 在每次推送 `main` 时构建签名 APK，也支持在 `main` 手动运行，无须另打 tag。每次 push 事件生成一个 Release（一次 push 包含多个提交时，以该 push 的最终提交打包）。

- CI 版本名为 `0.3.<run_number>`，`versionCode = 100000 + run_number`；递增由 workflow 负责，不用逐次修改 Gradle。不要重建 workflow 或降低此序号基数；手动重建旧提交使用新的运行序号。
- tag 为 `android-<versionCode>`，附件包含 `viprpg-release.apk` 与 `SHA256SUMS.txt`，说明自动结算该次提交的 GitHub release notes。所有附件就绪后才公开 Release；已经发布的运行重跑时跳过打包，避免同一构建身份对应不同文件。
- 当前构建连接已核实的 staging，Release 标为预发布，不占用正式 Latest；不同推送都构建，不会取消前一个推送的待运行任务。
- 四项仓库 Secrets 为 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。只使用固定签名，缺少配置直接失败，不回退到临时 debug key。公开证书见 [release-certificate.pem](release-certificate.pem)，CI 发布前核对签名身份。
- GitHub 构建成功不代表网站部署或站内发布完成。站点部署仍走独立 Deploy workflow；APK 上传与发布沿用后台入口。

同包名、同签名覆盖安装会保留游戏及存档。旧 debug 包与新发布证书不同，首次切换必须先导出存档等数据；不能直接覆盖安装，也不要通过清除数据解决签名不一致。

## Docker Desktop 打包

在仓库根目录运行：

```sh
docker compose -f android/compose.yaml run --build --rm apk
```

APK 位于 `output/android/viprpg-debug.apk`。Docker 镜像独立安装 Node 24、JDK 17、Gradle 8.13 和 Android SDK 35；Linux 的 `node_modules`、Gradle 缓存和 debug 签名使用独立 Docker 卷，不读取主机的依赖或 SDK。首次构建需下载镜像、Android SDK 和 Maven 依赖。保留 `android-debug-key` 卷才能保持 debug APK 的签名身份；删除卷将改变签名，覆盖安装前应先备份 App 数据。

调试包默认指向 `https://staging.viprpg.org`，该站点当前提供仓库中的在线游玩功能。旧的 workers.dev 站点仍为上一版网站，不适合作为此 App 的安装入口。正式发布前必须先部署新版站点，再用 `SITE_ORIGIN=https://<正式域名>` 重新构建并验证。**在线安装和离线打开必须是同一个来源**；更换来源需要重新打包，且不同来源的已安装游戏互不可见。在线站点如升级运行组件，应重新打包 APK；离线页只发布当前声明的版本，不附带历史 runtime。

正式签名时以只读卷挂载 keystore 到容器内，通过 `docker compose -f android/compose.yaml run --rm -v <主机keystore绝对路径>:/run/secrets/archive.jks:ro -e ANDROID_KEYSTORE_FILE=/run/secrets/archive.jks -e ANDROID_KEYSTORE_PASSWORD -e ANDROID_KEY_ALIAS -e ANDROID_KEY_PASSWORD apk release` 构建（环境变量值由调用环境提供）。签名文件和密码不得写入本公开仓库或 Docker 镜像。首次发布前请固定包名 `org.viprpg.archive`、签名证书、versionCode 与来源；debug 包不用于正式升级。本地默认版本为 0.3.3 / 4，可通过 `ANDROID_VERSION_NAME` 与 `ANDROID_VERSION_CODE` 指定新版本；同一构建号只能用于同一原始 APK。发布证书及密码须另行安全备份，本公开仓库只保存公开证书。

首版限于 App 前台安装和离线游玩。切走在线安装页会中断当前下载，需要回到游玩页重新安装；不承诺锁屏后台下载。删除本地游戏只删除安装包，不删除已有存档。系统清除 App 数据或卸载则会移除游戏和存档。
