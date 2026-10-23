# VIPRPG 服务状态

独立部署在 `status.viprpg.org` 的 Cloudflare Worker。每 15 分钟检查一次正式及预生产的完整首页（每小时第 0、15、30、45 分钟），应用 API、D1 与 R2 健康接口仍每分钟检查一次；检查结果保存在独立 D1。页面、API 和定时任务均由此 Worker 提供，因此主站不可用时状态页仍能显示已有记录。

## 结构与数据

- `src/monitors.ts` 是受监控服务清单。使用 `https://viprpg.org` 和 `https://staging.viprpg.org`，分别保留 production/staging monitor ID，不把旧 staging 历史改记为正式记录。新版状态服务应在正式主站就绪后部署。
- `src/index.ts` 执行检查、保存结果并提供 `/api/status` 与 `/api/health`。
- `src/incidents.ts` 将同一监控项的相邻中断区间归并为展示事件，保留每次中断与恢复记录。
- `migrations/0001_init_status.sql` 是此服务的独立数据库结构。
- `public/` 是静态状态页；全部时间按北京时间（UTC+8）显示。
- 页眉和 favicon 使用主站的 `public/icon/windI.png`；部署前通过 `scripts/sync-brand-asset.mjs` 同步。配色和字体按主站 `app/globals.css` 的当前设计令牌设置，操作状态图标采用与主站一致的线条样式。
- 同页分区点击使用主站的 `lib/ui/scroll.js` 平滑滚动策略；`scripts/sync-brand-asset.mjs` 同时生成 `public/scroll.js`，本地预览静态页面前也需在仓库根目录运行该脚本。页面进入和历史位置恢复不启用平滑滚动。

一次失败显示“性能波动”，连续两次失败显示“服务中断”并记录中断区间；首次成功结束该区间。首页连续两次失败判定中断，因此持续故障可能需要约 15–30 分钟确认。每天保存聚合结果 30 天，原始检查保留 48 小时，已恢复中断区间保留 90 天。超过检查周期加 2 分钟没有新检查时（首页 17 分钟，其他接口 3 分钟），页面显示“监控数据暂不可用”，避免把定时任务故障误报为正常。

## 事件归并与展示

参考 [GitHub Status](https://www.githubstatus.com/) 的当前事件与历史时间线，以及 [Statuspage 的事件阶段](https://support.atlassian.com/statuspage/docs/create-an-incident/)，页面将反复中断组织成一个可展开的事件：

- 同一 monitor 恢复后 30 分钟内再次中断，归入同一事件；不同 monitor、正式与预生产各自记录。按监测时间归并不等于已确认相同根因。
- 首次恢复后显示“恢复观察中”。观察窗口内再次中断会延续原事件，并从最近一次恢复重新计算 30 分钟。经过观察窗口且已取得窗口结束之后的检查记录才归为历史；定时任务停止时不会只凭时间流逝确认恢复。
- 当前事件置于服务概览上方。历史事件按首次确认日期分组；事件标题可链接，展开后显示每次中断和恢复，刷新保留展开状态。
- 事件卡片区分中断次数、已记录中断时长与事件跨度。时间条中的绿色表示期间恢复时段，累计中断只计算实际记录的区间；重叠区间不重复累计。区间起点为连续两次失败的确认时间，不能当作精确用户中断起点。
- 服务概览标明首页和健康接口各自的检查频率、最近探测时间及失败原因。30 天指标标为“检查成功率”，按原始检查次数计算，事件归并不改变分母或把正常间隔记为中断。

`/api/status` 保留原 `incidents` 的中断区间字段及最多 20 条的输出形式，新增 `incidentGroups`、`incidentCount` 与 `recoveryWindowSeconds`。归并读取近 30 天开始、结束或仍未恢复的区间，先归并再限制最多 20 起展示事件，优先保留当前事件；跨越窗口边界的已恢复区间也参与读取。`incidentGroups` 包含 `episodes` 明细、`phase`、最近恢复及观察截止时间、累计中断与事件跨度。历史区间不改写，不需要数据库迁移或线上数据修复。

## 本地与发布

状态服务与 Android 一样复用仓库根目录的工具链。在仓库根目录运行 `npm ci`、`npx tsc --noEmit --project status/tsconfig.json`。首次发布前创建独立 D1，把 ID 写入 `status/wrangler.status.jsonc` 的 `database_id`；CI 同样通过 `STATUS_D1_DATABASE_ID` 写入该字段，不在仓库保存真实 ID。本地维护须先核对计划并取得负责人确认；首次初始化时先运行 `npx wrangler d1 migrations apply STATUS_DB --remote --config status/wrangler.status.jsonc`，再运行 `npx wrangler deploy --config status/wrangler.status.jsonc`。域名由 Wrangler 的 Worker Custom Domain 配置创建。

状态服务只使用 Cloudflare API Token、账号 ID 和 D1 ID；密钥由 GitHub Actions 的 `status` environment secrets 持有。所需名称：`CLOUDFLARE_STATUS_DEPLOY_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`STATUS_D1_DATABASE_ID`。本地 `.env.local` 中的同名令牌仅供受控终端操作；不要提交或在日志中打印它。

状态服务只通过手动运行 Deploy Status 发布；类型检查完成后，在 status Environment 由负责人本人批准，允许自审，不要求第二人。发布确认包含候选中待执行的 D1 迁移，部署前由 Wrangler 自动检测并应用，无需手动勾选；无待执行迁移时继续部署，迁移失败则停止发布。发布、正式主站和正式 Android 共用 production-maintenance 互斥组；主站 workflow 仍忽略纯状态服务变更。首次创建 D1、域名与数据初始化单独按[正式手册](../docs/production-deployment.md)确认。
