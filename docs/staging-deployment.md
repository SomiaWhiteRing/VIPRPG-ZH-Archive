# 预生产初始化与验收

预生产入口为 `https://staging.viprpg.org`，允许匿名浏览。staging 配置必须设定 `SITE_NOINDEX="true"`：Worker 返回 `X-Robots-Tag: noindex, nofollow`，`/robots.txt` 禁止抓取。此设置不限制访问；需要保密时另行配置 Cloudflare Access。

## 环境地址与配置来源

| 环境 | 访问入口 | 配置来源 |
| --- | --- | --- |
| 本地开发 | `npm run dev` 输出的 `Local` 地址 | Vite 实际监听端口与请求 origin |
| staging | `https://staging.viprpg.org` | 本地 `wrangler.jsonc` 的 `env.staging`；CI 使用 staging environment 的 `WRANGLER_CONFIG_JSONC` |
| production | `https://viprpg.org`（2026-09-26 首次上线） | 本地 Wrangler 顶层；production Environment 的 `PRODUCTION_WRANGLER_CONFIG_JSONC`，见[正式手册](./production-deployment.md) |

staging 使用 custom domain，关闭 `workers_dev` 与 `preview_urls`。旧 Workers.dev 入口已弃用，不作为检查失败时的备用地址，也不从 Worker 名称拼接 URL。`smoke:staging` 固定 staging origin，`smoke:production` 固定正式 origin；不匹配的 `SMOKE_BASE_URL` 覆盖会被拒绝。

`wrangler.example.jsonc` 是结构模板，其中域名是当前目标，资源 ID 和名称保留占位符。被忽略的 `wrangler.jsonc` 只描述本机配置，不证明线上绑定；CI 由 `scripts/prepare-wrangler-config.mjs` 合成配置。修改本地文件不会同步 GitHub secret；生成的 `build/server/wrangler.json` 只代表那次构建所选环境。

正式站已在 viprpg.org 上线，网站与 Kai 当前客户端来源白名单均包含正式域名。历史 APK 不会自动更新白名单，须安装新版；旧远端资源继续保留，见[正式手册](./production-deployment.md#首次正式初始化)。Android 接入及具体构建来源见[导入说明](./easyrpg-android-import.md)。

运行包可使用 [easyrpg-delivery.json](../lib/archive/easyrpg-delivery.json) 声明的备用资源入口。对应域名须保留社区 CNAME 链，并将运行包路径 Route 绑定到同一环境的原 Worker；Environment 的配置 secret 同步保存这条精确 Route。它只供引擎和音色库的客户端传输选择，部署 origin、游戏安装和存档路径保持原协议。正式入口的新增、撤销与配置同步遵守[主站入口说明](./main-ingress-selection.md#运行包入口的预生产验证)的批准边界。

联机优选入口 `netplay-staging.viprpg.org` 使用社区 CNAME 和精确的 `/api/netplay/v1/*` Route，由预生产配置生成脚本加入同一个 Worker。使用 Worker 联机的归档可以在预生产网页版游玩地址加 `?netplayEdge=1`，通过该入口以访客身份进入同一房间池。对照测试使用 WebSocket 的实际双端往返时间。

预生产玉露弹（作品 18）使用 `netplay-hk-staging.viprpg.org`，Cloudflare 仅解析香港服务器的公网 IP。[香港联机服务](../scripts/netplay-hk-relay.mjs) 以 Debian 的 Node.js 和 `node-ws` 运行，`NETPLAY_ARCHIVE_VERSION` 与当前归档版本 ID 一致。Caddy 将 HTTPS 和 WebSocket 转发到本机 8787 端口。预生产 Worker 和香港服务使用同一份 `NETPLAY_HK_IDENTITY_KEY` 签发及验证昵称和头像，访客使用默认头像。

在网页版游玩地址加 `?netplayTurn=1` 进入独立的香港 UDP TURN 房间池。该入口要求双方经 coturn 中继，连接失败时房主留在原房间等待，来客可从大厅重新加入。coturn 在香港服务器的公网 IPv4 和 IPv6 上监听 UDP 3478，两类连接都使用同一服务器的 IPv4 分配 UDP 49160–49259 中继端口，中继对端限定为同一服务器上的分配。野草云 P 型 VPS 还需在客户中心的产品防火墙规则中允许 `net0` 入站 UDP 3478。香港联机服务使用与 coturn 配置一致的 `NETPLAY_HK_TURN_SECRET` 签发短期凭据，实际使用的中继协议见香港服的 `netplay_ice_stats` 日志。

使用 `?netplayTurn=443` 可单独测试 UDP 443。该房间池使用 coturn 的 IPv4 和 IPv6 辅助监听地址，沿用同一组中继端口和凭据。野草云产品防火墙需放行入站 UDP 443，coturn 的 systemd 服务通过 `CAP_NET_BIND_SERVICE` 绑定该端口。

预生产网页版默认进入自动选线房间池。配套安卓安装版也通过网站取得同一个房间入口。Player 通过 `routeSelection=1` 声明支持，双方支持时并行测试 WebSocket、直连和可用的 UDP TURN 443，房间服务收到双方确认后宣布房间就绪。混用旧 Player 时走 WebSocket。网页版使用 `?netplayDirect=1` 对照直连及其 WebSocket 兜底，使用 `?netplayRelay=1` 对照纯 WebSocket 转发。两台设备使用同一入口。部署香港房间服务时，`netplay-hk-relay.mjs` 与 `netplay-route-selection.mjs` 放在同一目录。

双方 Player 声明 `inputProtocol=1` 时，香港服务在 RTC 协商中启用抗丢包按键协议，并将实际协议记入 `netplay_route.inputProtocol`。开局和房间消息继续可靠传输，按键改走无序、不重传的独立 DataChannel：每包重复尚未确认的逐帧输入，接收方去重、补齐后交给原回滚时间线；停止产生新帧时仍每 50 ms 尝试补发。浏览器发送缓冲未清空时，只保留最新输入历史并合并最新确认，避免旧副本积压。协议使用对局 ID 隔离旧包，最多保留 256 帧，不能用丢弃未确认输入来跳过缺口。选线探测使用同一按键通道。混用旧 Player 或选择 WebSocket 时仍使用原输入协议。

## 干净种子

不要把本地开发数据库整体上传到远端。准备独立的预生产导入包：

```powershell
npm run db:staging:prepare -- --output output/staging-seed/candidate
```

脚本只读固定快照，校验源数据库与文件 SHA-256，并按完整迁移链建立临时 schema，验证外键和完整性。允许导入的对象为游戏角色、别名、分类及归属、来源、角色素材、已审核脸图、头像与默认头像、默认表情、已发布的链接卡片（当前八个），以及这些记录引用的 blob。另包含固定种子中的自定义账户角色及其功能授权，保留说明、优先级、状态和开放配置；不导入用户与角色的分配关系。链接保留富文本介绍、按钮、排序、来源网址和图标；软件版本、安装包与发布频道不导入，发布序号从零开始。用户和归档溯源字段置空；账号、会话、作品、作者、目录、论坛、评论及其他互动记录不导入。内置角色权限来自当前 schema。

生成的 `data.sql` 仅含允许的数据；`statements.json` 保存同一组 SQL 语句，供逐批导入；`manifest.json` 记录逐表数量、文件清单及校验和，以及完整迁移文件列表和 LF 规范化 SHA-256。`source.sqlite` 是本地验证中间文件，包含完整开发快照，不能上传；整个 `output/` 都不进入 Git。

首次发布使用空的 D1 和 R2。配置目标 binding 后，先执行完整候选验收，再应用完整迁移链（从 `0001_init_archive_schema.sql` 开始），按 `statements.json` 顺序逐条调用 D1 query API，并按 manifest 的 key 与元数据上传 R2 对象。SQL 每条语句限制在 90 KB、100 行以内，避免 D1 编译大量 VALUES 时触发 `SQLITE_NOMEM`。记录成功批次，遇到响应不确定时先核对数据库，不能盲目重试 INSERT。导入后核对所有表数量、`PRAGMA foreign_key_check`、迁移账本以及每个远端对象的大小和摘要；用户和作品必须为零。此导入不是日常部署步骤，不能反复向已有数据库执行。

## 配置与发布

1. 在被忽略的 `wrangler.jsonc` 中配置 staging 的独立 D1/R2、`staging.viprpg.org` custom domain、对应 `APP_ORIGIN`、`EMAIL_FROM=noreply@viprpg.org`；关闭 staging 的 `workers_dev` 和 `preview_urls`。
2. 启用 viprpg.org 的 Email Sending，核实 DKIM、SPF、DMARC 和 return-path DNS。为 staging 设置独立的 `AUTH_SECRET`；不导入开发账号。首个账号在步骤 4 部署完成后由站点负责人完成邮箱验证与注册，自动获得 `super_admin`；随后核对其角色和后台访问。
3. 执行 `npm run verify:preprod`。共享状态的检查串行运行；失败按[维护手册](maintenance-regression.md)分类处理。
4. 执行 `npm run deploy:staging -- --apply-migrations`；核实构建产物 `build/server/wrangler.json` 中的 Worker、D1、R2、域名和 noindex 设置均属于 staging。
5. 执行 `npm run smoke:staging`，然后检查 TLS、robots/noindex、匿名权限、角色图片及素材、八个精选链接及其图标、空作品和讨论列表、桌面及移动端页面。验证码实际到达邮箱须单独记录，不能由 DNS 检查代替。

GitHub Actions 见[部署说明](github-actions-deployment.md)。推送 main 前同步 staging environment 的 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`WRANGLER_CONFIG_JSONC` secrets 和 `SMOKE_BASE_URL=https://staging.viprpg.org` variable，避免后续 CI 恢复旧资源绑定。staging environment 配置优先于同名仓库配置，不改变 production。

## 回退

切换到新资源时保留旧 D1/R2 和原 Wrangler 配置。Worker 版本回退需同时核对该版本绑定的数据库 schema、bucket 和域名；单独回退代码不能保证与数据兼容。不要删除旧资源来清理一次发布，也不要把旧开发数据合并进新种子库。
