# VIPRPG 服务状态

独立部署在 `status.viprpg.org` 的 Cloudflare Worker。每分钟检查一次正式及预生产的网页、应用 API、D1 与 R2 健康接口；检查结果保存在独立 D1。页面、API 和定时任务均由此 Worker 提供，因此主站不可用时状态页仍能显示已有记录。

## 结构与数据

- `src/monitors.ts` 是受监控服务清单。使用 `https://viprpg.org` 和 `https://staging.viprpg.org`，分别保留 production/staging monitor ID，不把旧 staging 历史改记为正式记录。新版状态服务应在正式主站就绪后部署。
- `src/index.ts` 执行检查、保存结果并提供 `/api/status` 与 `/api/health`。
- `migrations/0001_init_status.sql` 是此服务的独立数据库结构。
- `public/` 是静态状态页；全部时间按北京时间（UTC+8）显示。
- 页眉和 favicon 使用主站的 `public/icon/windI.png`；部署前通过 `scripts/sync-brand-asset.mjs` 同步。配色和字体按主站 `app/globals.css` 的当前设计令牌设置，操作状态图标采用与主站一致的线条样式。

一次失败显示“性能波动”，连续两次失败显示“服务中断”并产生事件；恢复时关闭事件。每天保存聚合结果 30 天，每分钟原始检查保留 48 小时，已恢复事件保留 90 天。超过 3 分钟没有新检查时页面显示“监控数据暂不可用”，避免把定时任务故障误报为正常。

## 本地与发布

状态服务与 Android 一样复用仓库根目录的工具链。在仓库根目录运行 `npm ci`、`npx tsc --noEmit --project status/tsconfig.json`。首次发布前创建独立 D1，把 ID 写入 `status/wrangler.status.jsonc` 的 `database_id`；CI 同样通过 `STATUS_D1_DATABASE_ID` 写入该字段，不在仓库保存真实 ID。本地维护须先核对计划并取得负责人确认；首次初始化时先运行 `npx wrangler d1 migrations apply STATUS_DB --remote --config status/wrangler.status.jsonc`，再运行 `npx wrangler deploy --config status/wrangler.status.jsonc`。域名由 Wrangler 的 Worker Custom Domain 配置创建。

状态服务只使用 Cloudflare API Token、账号 ID 和 D1 ID；密钥由 GitHub Actions 的 `status` environment secrets 持有。所需名称：`CLOUDFLARE_STATUS_DEPLOY_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`STATUS_D1_DATABASE_ID`。本地 `.env.local` 中的同名令牌仅供受控终端操作；不要提交或在日志中打印它。

状态服务只通过手动运行 Deploy Status 发布；类型检查完成后，在 status Environment 由负责人本人批准，允许自审，不要求第二人。发布确认包含候选中待执行的 D1 迁移，部署前由 Wrangler 自动检测并应用，无需手动勾选；无待执行迁移时继续部署，迁移失败则停止发布。发布、正式主站和正式 Android 共用 production-maintenance 互斥组；主站 workflow 仍忽略纯状态服务变更。首次创建 D1、域名与数据初始化单独按[正式手册](../docs/production-deployment.md)确认。
