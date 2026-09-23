# VIPRPG Android 离线版

Android WebView 的「主站」页直接使用网站；底栏「离线游玩」加载 APK 内的 `/_android/` 页面。两个页面使用**同一个 HTTPS 来源和同一个 WebView 数据目录**，因此安装清单、OPFS 资源包、存档和截图无需迁移。`/play/player.html` 与当前 `lib/archive/easyrpg-runtime.json` 对应的运行组件也从 APK 提供，断网重新打开 App 仍可启动。手机浏览器与本 App 的数据目录不共享。首页和作品库固定竖屏，离线游戏按控制偏好切换方向；底栏另有原生「版本信息」页。

作品封面在安装时缓存到 WebView 的 Cache Storage，与游戏清单同源；断网时仍能显示新安装作品的封面。旧安装记录没有封面哈希时显示文字占位。作品库支持搜索、安装状态筛选、排序以及批量删除游戏文件，删除不涉及存档和截图。

原生版本页调用站点 `/api/tools/viprpg-android/updates/stable/android-universal?applicationBuildId=org.viprpg.archive:<versionCode>`。超管须在目标站点的软件管理后台创建固定 slug 为 `viprpg-android` 的软件，上传 Android universal APK，并发布、推荐 stable 渠道；每个安装包填写相应的构建标识（当前代码为 `org.viprpg.archive:2`），才能准确比较本站发布序号。未配置时版本页显示暂无更新，未知构建只允许手动下载，不假定已是最新版。内部构建标识只用于请求，不显示在版本界面。下载走站点同源 HTTPS 安装包接口并交给系统浏览器；安装由用户按 Android 系统提示完成，不进行静默安装。正式发布仍需使用持续有效的相同签名证书并递增 `versionCode`。

## Docker Desktop 打包

在仓库根目录运行：

```sh
docker compose -f android/compose.yaml run --build --rm apk
```

APK 位于 `output/android/viprpg-debug.apk`。Docker 镜像独立安装 Node 24、JDK 17、Gradle 8.13 和 Android SDK 35；Linux 的 `node_modules`、Gradle 缓存和 debug 签名使用独立 Docker 卷，不读取主机的依赖或 SDK。首次构建需下载镜像、Android SDK 和 Maven 依赖。保留 `android-debug-key` 卷才能保持 debug APK 的签名身份；删除卷将改变签名，覆盖安装前应先备份 App 数据。

调试包默认指向 `https://staging.viprpg.org`，该站点当前提供仓库中的在线游玩功能。旧的 workers.dev 站点仍为上一版网站，不适合作为此 App 的安装入口。正式发布前必须先部署新版站点，再用 `SITE_ORIGIN=https://<正式域名>` 重新构建并验证。**在线安装和离线打开必须是同一个来源**；更换来源需要重新打包，且不同来源的已安装游戏互不可见。在线站点如升级运行组件，应重新打包 APK；离线页只发布当前声明的版本，不附带历史 runtime。

正式签名时以只读卷挂载 keystore 到容器内，通过 `docker compose -f android/compose.yaml run --rm -v <主机keystore绝对路径>:/run/secrets/archive.jks:ro -e ANDROID_KEYSTORE_FILE=/run/secrets/archive.jks -e ANDROID_KEYSTORE_PASSWORD -e ANDROID_KEY_ALIAS -e ANDROID_KEY_PASSWORD apk release` 构建（环境变量值由调用环境提供）。签名文件和密码不得写入仓库或 Docker 镜像。首次发布前请固定包名 `org.viprpg.archive`、签名证书、versionCode 与来源；debug 包不用于正式升级。

首版限于 App 前台安装和离线游玩。切走在线安装页会中断当前下载，需要回到游玩页重新安装；不承诺锁屏后台下载。删除本地游戏只删除安装包，不删除已有存档。系统清除 App 数据或卸载则会移除游戏和存档。
