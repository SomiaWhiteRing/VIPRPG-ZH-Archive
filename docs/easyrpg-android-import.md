# Android Kai 游戏导入

网站的作品详情页在 Android 环境显示「导入 EasyRPG Player Kai」，适用于有当前归档的 RPG Maker 2000／2003／2003 Maniac 作品。接收端为 `org.easyrpg.player.kai`，需要安装带网站导入功能的新版 APK。既有版本不会自动获得接收能力。

按钮使用 `intent://import?manifest=<编码后的清单地址>#Intent;scheme=easyrpg-kai;package=org.easyrpg.player.kai;S.browser_fallback_url=<编码后的资源页地址>;end`。未安装时支持 Intent 的浏览器回退到 `/resources#easyrpg-kai`；页面同时保留安装／更新链接和普通 ZIP 下载。浏览器支持情况仍需设备验收。

当前站点访问入口为 [staging.viprpg.org](https://staging.viprpg.org)，环境来源见[部署手册](./staging-deployment.md#环境地址与配置来源)。不要把来源白名单当作已部署站点清单。

网站按钮的来源判断位于 `app/games/[id]/kai-import-link.tsx`。2026-09-23 静态核对时，它允许 staging，同时仍保留已弃用的 Workers.dev 来源；后者是实现残留，不是正式入口或备用地址。本文不据此声明 production 已上线。

APK 内的来源白名单不可被链接参数扩充，HTTP、跨源及重定向均拒绝。客户端代码与发行包位于独立 Kai 项目，本仓库不能证明用户安装包的实际白名单。更换域名须核对网站与 APK 两端并发布支持该来源的 APK；只改网站文档或配置不能使旧 APK 获得接收能力。

`GET/HEAD /api/archive-versions/:id/kai-import` 由 `worker.ts` 注册，复用 `worker/archive-download.mjs` 的发布状态查询、原归档清单哈希校验和 ZIP 大小计算。无需登录；只有已发布作品的已发布当前快照可获取。不存在／隐藏／不再当前返回 404，不支持的引擎或超限快照返回 422，其他方法返回 405。

返回 `Cache-Control: no-store` 的 `viprpg-kai.import.v1` JSON：`archiveVersionId`、`workId`、`title`、同源 `coverUrl`（无封面为 `null`）、`engineFamily`、`manifestSha256`、同源 `downloadUrl`、`zipSizeBytes` 和 `files: [{path,size,sha256}]`。不暴露 R2 对象键或管理凭据，也不增加 D1 表。下载复用现有 `/download`，保留其状态验证、缓存、统计及响应头。

限制为 1 GiB ZIP、50,000 文件、8 MiB 导入清单，必须包含根目录 `RPG_RT.ldb` 和 `RPG_RT.lmt`。使用当前网站生成的 UTF-8 STORE ZIP。客户端核对下载长度、`X-Manifest-SHA256`、`X-Download-Zip-Builder` 和全部文件 SHA-256，拒绝额外／重复／大小写冲突条目、越界路径和异常大小。manifestSha256 是原归档清单身份，不是重新打包 ZIP 的哈希。

Kai 确认页显示「从VIPRPG.org导入游戏」和封面，并在导入前查询实际本地游戏文件以及下载队列。按同站点作品 ID 的安装记录、快照文件名判断是否已有此游戏；已有游戏或已有任务只显示关闭按钮。无安装记录且被手动改名的游戏无法可靠识别。

点击导入后进入游戏列表，未完成任务显示封面、进度条、已下载／总大小、下载速度和暂停／继续按钮，禁止启动。ZIP 先保存在应用私有持久目录，逐文件校验后复制到 games 的隐藏临时文件；回读校验后重命名为 `VIPRPG-{快照ID}-{manifest哈希前16位}.zip`，预发布站带 `staging-` 前缀，再刷新可启动的游戏列表。已有同作品时不重复导入；不覆盖游戏或存档。暂停／失败任务可移除，仅清理其下载临时文件。

任务由 Android `dataSync` 前台服务运行，通知栏显示进度与暂停入口。离开导入页面、切换应用或锁屏可继续；系统重新创建服务或用户再次打开列表时从持久队列恢复未暂停任务。主动暂停的任务保留进度。系统强行停止、重启设备或后台时限可能中断执行，重新打开应用后可继续；不承诺绕过 Android 系统限制。

`GET /api/archive-versions/:id/download` 支持单段 `Range`（包含开放结束位置或后缀），有效范围返回 `206`、`Content-Range` 和精确剩余长度，无效范围返回 `416`。部分响应不写入完整 ZIP 缓存；同一快照和 ZIP builder 保持字节布局一致，可跳过范围外完整文件。客户端下载续传仍核对清单、builder 和长度，最终校验全部文件；遇到忽略 Range 的服务器返回 `200` 时安全地从头下载。未完成的 SAF 文件按下载任务单独记录、清理。

游戏导入独立于工具下载托管和 Windy 更新 API。游戏由本站已发布快照提供，工具版本和内容继续由管理员独立管理；不引入 GitHub 同步，也不修改网站 Web runtime。

## 历史交付与验收边界

首次交付记录运行了 Android Java／资源编译与 Lint，以及网站接口语法、ESLint 和差异检查；未新增测试，也未做人工浏览器、模拟器或真机操作。网站接口更新与 Kai Nightly 通过各自自动发布流程交付；Kai 版本号保持 2026.9.2，已有正式版不覆盖，是否支持导入应核对所安装 APK 的对应构建与来源白名单，不能仅凭版本号或浮动的 Nightly 标签判断。以上为历史交付记录，不代表本次重新编译或验证了客户端。设备上的封面、暂停续传、锁屏后台行为仍需实际验收。
