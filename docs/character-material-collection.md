# 角色素材采集

本地工具复用 `atwiki` Playwright CLI 浏览器会话，从现有脸图清单中的来源页采集四类图片：「キャラセット／歩行グラ」（行走图，`charset`）、「顔グラ」（脸图，`faceset`）、「モングラ」（怪物／战斗图，`monster`）和「ピクチャー、その他」（插图及其他，`other`）。保留原栏目名，不根据图片外观重新分类。需要 Node.js/npm、Chrome；首次运行通过 npx 获取 Playwright CLI，不修改项目依赖。

```powershell
# 打开独立浏览器；出现验证时由人工完成
node scripts/collect-character-materials.mjs --open

# 保持浏览器打开，采集一个尚未缓存的页面并下载图片
node scripts/collect-character-materials.mjs --limit 1 --download

# 串行采集全部已知来源页，下载原图；重复执行可继续
node scripts/collect-character-materials.mjs --all --download
```

浏览器会话保存在被 Git 忽略的 `output/playwright/atwiki-profile/`，不要提交或分享其中的 Cookie。页面缓存、栏目 HTML、素材来源、原文件名、文件哈希和汇总位于 `output/playwright/character-materials/`。不带 `--download` 时只收集链接。默认只采集一个未缓存或需更新的页面，`--limit N` 控制新增或更新页面数；旧版双栏目缓存会自动更新为四栏目，并保留已有下载记录，避免重复下载。已有当前版本缓存仍会读取，启用下载时会补齐其中缺失的图片。

每次网页采集或新图片下载前间隔 1 秒。网络超时、连接错误及 HTTP 408、429、5xx 最多重试 3 次，依次等待 5、10、20 秒；每次图片请求仍有 30 秒超时。日志记录重试的 URL、原因、等待时间和每张新图片保存时间。重试耗尽后保存进度并退出，原命令可续跑。

直接下载返回 403 时，会通过同一浏览器会话打开图片并读取原始响应；仍遇到验证则保留标签页并停止，不反复重试。异常导航、404 或非图片响应也会停止。浏览器和原图服务器的访问限制可能不同。

当前版本从清单首个页面开始更新旧缓存，保存每页完整浏览器 DOM 到 `<页面编号>.html`，JSON 同时保留正文 HTML、图片的标题层级 `sectionPath`、原始链接及采集时间。完整 HTML 用于后续整理，不是离线镜像（不打包外部样式、脚本等资源），也不是服务器原始响应。已有图片校验哈希后复用。重新运行会跳过已更新页面；若需要再次强制刷新某页，可只删除该页 `.html` 文件，保留 JSON 和图片。

来源页关联的角色名只作为 `candidateOriginalNames` 输出，不自动写入数据库。多人素材表和页面内的变体必须在导入时确认归属。工具只读取上述栏目中的站内附件图片，不递归追踪其他页面或采集音乐。当前尚未接入角色页或生产素材存储。
