# 预生产初始化与验收

预生产入口为 `https://staging.viprpg.org`，允许匿名浏览。staging 配置必须设定 `SITE_NOINDEX="true"`：Worker 返回 `X-Robots-Tag: noindex, nofollow`，`/robots.txt` 禁止抓取。此设置不限制访问；需要保密时另行配置 Cloudflare Access。

## 环境地址与配置来源

| 环境 | 访问入口 | 配置来源 |
| --- | --- | --- |
| 本地开发 | `npm run dev` 输出的 `Local` 地址 | Vite 实际监听端口与请求 origin |
| staging | `https://staging.viprpg.org` | 本地 `wrangler.jsonc` 的 `env.staging`；CI 使用 staging environment 的 `WRANGLER_CONFIG_JSONC` |
| production | 目标为 `https://viprpg.org`；实际首次发布另行确认 | 本地 Wrangler 顶层；production Environment 的 `PRODUCTION_WRANGLER_CONFIG_JSONC`，见[正式手册](./production-deployment.md) |

staging 使用 custom domain，关闭 `workers_dev` 与 `preview_urls`。旧 Workers.dev 入口已弃用，不作为检查失败时的备用地址，也不从 Worker 名称拼接 URL。`smoke:staging` 固定 staging origin，`smoke:production` 固定正式 origin；不匹配的 `SMOKE_BASE_URL` 覆盖会被拒绝。

`wrangler.example.jsonc` 是结构模板，其中域名是当前目标，资源 ID 和名称保留占位符。被忽略的 `wrangler.jsonc` 只描述本机配置，不证明线上绑定；CI 由 `scripts/prepare-wrangler-config.mjs` 合成配置。修改本地文件不会同步 GitHub secret；生成的 `build/server/wrangler.json` 只代表那次构建所选环境。

正式目标和网站 Kai 来源已配置为 viprpg.org；这不代表域名或 APK 已发布。旧远端 Worker 与历史资源的实际状态见[正式手册](./production-deployment.md#首次正式初始化)。Android 接入仍须核对网站与 APK 两端来源，见[导入说明](./easyrpg-android-import.md)。

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
