# Android Kai 游戏导入

网站的作品详情页在 Android 环境显示「导入 EasyRPG Player Kai」，适用于有当前归档的 RPG Maker 2000／2003／2003 Maniac 作品。接收端为 `org.easyrpg.player.kai`，需要安装带网站导入功能的新版 APK。既有版本不会自动获得接收能力。

按钮使用 `intent://import?manifest=<编码后的清单地址>#Intent;scheme=easyrpg-kai;package=org.easyrpg.player.kai;S.browser_fallback_url=<编码后的资源页地址>;end`。未安装时支持 Intent 的浏览器回退到 `/resources#easyrpg-kai`；页面同时保留安装／更新链接和普通 ZIP 下载。浏览器支持情况仍需设备验收。

当前仅对正式站及预发布站启用：

- `https://viprpg-zh-archive.q578235562.workers.dev`
- `https://viprpg-zh-archive-staging.q578235562.workers.dev`

APK 内相同的来源白名单不可被链接参数扩充，HTTP、跨源及重定向均拒绝。将来更换域名需同步修改两端并发布 APK。

`GET/HEAD /api/archive-versions/:id/kai-import` 由 `worker.ts` 注册，复用 `worker/archive-download.mjs` 的发布状态查询、原归档清单哈希校验和 ZIP 大小计算。无需登录；只有已发布作品的已发布当前快照可获取。不存在／隐藏／不再当前返回 404，不支持的引擎或超限快照返回 422，其他方法返回 405。

返回 `Cache-Control: no-store` 的 `viprpg-kai.import.v1` JSON：`archiveVersionId`、`title`、`engineFamily`、`manifestSha256`、同源 `downloadUrl`、`zipSizeBytes` 和 `files: [{path,size,sha256}]`。不暴露 R2 对象键或管理凭据，也不增加 D1 表。下载复用现有 `/download`，保留其状态验证、缓存、统计及响应头。

限制为 1 GiB ZIP、50,000 文件、8 MiB 导入清单，必须包含根目录 `RPG_RT.ldb` 和 `RPG_RT.lmt`。使用当前网站生成的 UTF-8 STORE ZIP。客户端核对下载长度、`X-Manifest-SHA256` 和全部文件 SHA-256，拒绝额外／重复／大小写冲突条目、越界路径和异常大小。manifestSha256 是原归档清单身份，不是重新打包 ZIP 的哈希。

用户在 Kai 确认，必要时授权 EasyRPG 文件夹。ZIP 先存私有缓存，校验后复制至 games 的隐藏临时文件；确认落盘内容后重命名为 `VIPRPG-{快照ID}-{manifest哈希前16位}.zip`，预发布站带 `staging-` 前缀。Kai 直接运行 ZIP，无需解压。相同快照已存在时不覆盖；新快照独立保存，存档按 ZIP 名称分开，不自动迁移存档。

客户端提供下载、校验、保存进度及取消，旋转时保留任务。导入页面有独立 Android 任务；不是后台下载服务，不承诺退出页面或进程结束后继续下载，不支持断点续传。进程意外结束后再次导入会清理已记录的未完成文件；授权或存储失效时可能需要手动删除隐藏 `.kai-import-*.part` 文件。

此功能是用户追加要求，独立于工具下载托管和 Windy 更新 API。游戏由本站已发布快照提供，工具版本和内容继续由管理员独立管理；不引入 GitHub 同步，也不修改网站 Web runtime。

实现后仅运行既有非 UI 检查和编译／打包；依用户要求未新增测试，也未做浏览器、模拟器或真机操作。网站代码需部署后才能与新版 APK 联调。
