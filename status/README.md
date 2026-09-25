# VIPRPG 服务状态

独立部署在 `status.viprpg.org` 的 Cloudflare Worker。每分钟检查一次文档中确认的预生产网页、应用 API、D1 与 R2 健康接口；检查结果保存在独立 D1。页面、API 和定时任务均由此 Worker 提供，因此主站不可用时状态页仍能显示已有记录。

## 结构与数据

- `src/monitors.ts` 是受监控服务清单。目前只使用已确认的 `https://staging.viprpg.org`；正式入口确认后再加入。
- `src/index.ts` 执行检查、保存结果并提供 `/api/status` 与 `/api/health`。
- `migrations/0001_init_status.sql` 是此服务的独立数据库结构。
- `public/` 是静态状态页；全部时间按北京时间（UTC+8）显示。

一次失败显示“性能波动”，连续两次失败显示“服务中断”并产生事件；恢复时关闭事件。每天保存聚合结果 30 天，每分钟原始检查保留 48 小时，已恢复事件保留 90 天。超过 3 分钟没有新检查时页面显示“监控数据暂不可用”，避免把定时任务故障误报为正常。

## 本地与发布

状态服务与 Android 一样复用仓库根目录的工具链。在仓库根目录运行 `npm ci`、`npx tsc --noEmit --project status/tsconfig.json`。首次发布前创建独立 D1，把 ID 写入 `status/wrangler.status.jsonc` 的 `database_id`；CI 同样通过 `STATUS_D1_DATABASE_ID` 写入该字段，不在仓库保存真实 ID。先运行 `npx wrangler d1 migrations apply STATUS_DB --remote --config status/wrangler.status.jsonc`，再运行 `npx wrangler deploy --config status/wrangler.status.jsonc`。域名由 Wrangler 的 Worker Custom Domain 配置创建。

状态服务只使用 Cloudflare API Token、账号 ID 和 D1 ID；密钥由 GitHub Actions 的 `status` environment secrets 持有。所需名称：`CLOUDFLARE_STATUS_DEPLOY_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`STATUS_D1_DATABASE_ID`。本地 `.env.local` 中的同名令牌仅供受控终端操作；不要提交或在日志中打印它。

推送至 `main` 时只有 `status/**` 或状态部署工作流变化会触发状态部署。主站部署工作流忽略纯状态服务变更。首次创建 D1 与绑定域名后，每次部署按顺序执行类型检查、迁移、Worker 发布和 HTTP 核验。
