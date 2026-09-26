# 正式部署与数据维护

本项目由一人维护。负责人本人确认正式操作即可，允许自己批准自己的发布；不要求第二位审核人、强制 PR 或禁止直接推送 main。main 推送继续自动发布预生产。

## 环境与授权

正式目标为 `https://viprpg.org`，预生产为 `https://staging.viprpg.org`。[环境总表](./staging-deployment.md#环境地址与配置来源)区分目标地址、本地配置和 CI 配置；域名写入配置不代表已上线。

正式代码发布、回滚、资源绑定／secret／路由变更，以及 Codex 经 D1、R2、DO、后台或 API 发起的数据写入，都需负责人对具体目标和操作范围明确确认。先准备代码、检查结果、资源身份、SQL／对象清单、影响和回退方案，再确认执行。一次确认可覆盖完整批次；范围或候选变化才重新确认。会话、token、管理员身份或命令确认参数均不代替用户授权。

网站注册、上传、编辑、审核等正常业务继续按现有权限运行；已批准部署中的定时 GC、评论图片清理、浏览量合并重试无需每次人工确认。手动触发正式清理、修改其宽限期／上限或批量处理数据仍需确认。只读检查按实际副作用判断，不把写审计／修复结果的操作当作纯读取。

## 单人 GitHub 发布

`Deploy` 的 `candidate` job 使用隔离配置执行既有检查，没有正式写凭据。手动选择 `target=production` 后，候选摘要记录固定 SHA、迁移清单及规范化 LF 后的 SHA-256；检查通过后等待 `production` Environment 的负责人本人批准。正式 job 签出同一 SHA，生成并核对资源配置，构建、发布，最后执行正式 smoke。

`apply_migrations` 默认关闭。关闭时，正式 job 只读核对迁移账本；有待应用迁移就停止本次发布。账本按文件名核对，不能证明历史同名 SQL 的内容一致，首发前仍须核对实际 schema。开启代表本次批准同时包含候选中待应用的迁移；它不包含数据修复、seed 导入或重建数据库。迁移发生在 Worker 发布前，需兼容短暂继续运行的旧 Worker；不兼容变更应单独安排停写窗口。

production Environment 使用唯一负责人作为 required reviewer，`prevent_self_review=false`；只允许 main 发布，关闭审批绕过。这里限制的是发布来源，不限制负责人直接提交 main，也不增加 PR 评审人数。正式主站、状态服务和正式 Android workflow 使用 `production-maintenance` 互斥组；本地／API 维护仍需人工确保不与其并发。

正式 secrets 使用独立名称，避免回落到旧仓库级配置：

| production Environment secret | 内容 |
| --- | --- |
| `PRODUCTION_CLOUDFLARE_ACCOUNT_ID` | 已核实的正式 Cloudflare account |
| `PRODUCTION_CLOUDFLARE_API_TOKEN` | 正式部署所需 token，只在受保护 job 中注入 |
| `PRODUCTION_WRANGLER_CONFIG_JSONC` | 仅含正式资源的 JSONC，结构为本地 Wrangler 顶层 |

staging 保留该 Environment 的 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`WRANGLER_CONFIG_JSONC`。配置生成器接受目标资源对象，也可从完整本地配置选择 staging；输出不携带另一环境的实际资源；staging 构建的未选中顶层不绑定远端资源，正式构建移除 staging 段。生产 token 不应另存无审批的仓库级副本。旧仓库凭据先核对消费者和权限，再迁移或撤销，不能盲删仍在使用的凭据。

## 本地准备与执行

Wrangler 顶层仍对应原正式 Worker，`env.staging` 对应预生产；没有为命名统一创建 `-production` Worker。`--env production` 是项目脚本的显式选择，不会再传给 Wrangler 追加名称。

```powershell
npm run deploy:production -- --plan
npm run db:production:migrate -- --plan
```

第一条仅显示本地资源与迁移清单，不构建、不连接远端。第二条只读查询正式迁移账本，显示已应用和待应用文件；它不调用会初始化账本的 `wrangler d1 migrations list`。

正式配置必须使用正确的 APP_ORIGIN／custom domain、noindex、独立 DB／R2／限流 namespace、同 Worker 的 VIEW_STATS，并关闭 Workers.dev 和 preview URL。脚本校验本地配置及生成的部署配置。所有正式运行时 secrets 单独设置，不由部署流程复制开发值。

候选需已提交且工作树干净。人工确认后执行：

```powershell
# 只发布代码；有待应用 migration 时停止。
npm run deploy:production

# 此次确认也包括已列出的待应用迁移。
npm run deploy:production -- --apply-migrations

# 独立批准的数据迁移，不部署 Worker。
npm run db:production:migrate -- --apply
```

交互终端显示目标后要求输入 `viprpg.org`。已取得用户确认的非交互执行使用 `--confirm viprpg.org`；CI 只在 Environment 批准后传入此参数。`CI=true` 本身不放行。裸 `npm run deploy` 拒绝执行，必须指定目标。预生产用 `npm run deploy:staging -- --apply-migrations`。

## 首次正式初始化

2026-09-26 已按负责人本次部署授权完成首次上线：`viprpg-zh-archive` 绑定 viprpg.org，新 D1/R2 均名为 `viprpg-archive-production`。初始干净数据包括 930 个角色、132 个分类及 17,173 个对象（150,282,413 字节），不含开发用户和作品；schema、迁移账本、外键、逐表数量及全量对象大小／摘要已核对。首次数据清单和旧 Worker 版本／绑定记录位于本机忽略目录 `output/production-setup/`。

旧 `viprpg-archive-prod` D1/R2 和 staging 资源保持原状，不能当作当前正式数据源。当前正式身份来自部署绑定及 production Environment 配置。旧 Worker 版本使用旧 schema／origin，不应直接回滚它来服务新正式库；首发候选及之后的兼容版本才是正式回滚基线。

首次初始化采用以下步骤；日常部署不重复导入种子：

1. 确定正式 Worker、独立空 D1/R2、DO、限流 namespace 与 AUTH_SECRET；保存旧资源身份、Worker 版本和恢复方案。核实 TLS、邮件域验证、EMAIL binding 和 `noreply@viprpg.org` 实际发信。
2. 应用完整迁移链，记录首发 SHA、文件校验和与账本。用[干净种子](./staging-deployment.md#干净种子)准备经过审核的数据，只上传 manifest 指定对象；不导入本地／staging 的用户、会话或整库。软件包和更新频道另列发布清单。
3. 核对表数量、外键、R2 大小和摘要。正式站不会向首个注册者自动授予根权限，可以直接开放正常注册。负责人上线后自行验证邮箱并注册，再确认目标邮箱，使用 `node scripts/rotate-bootstrap-admin.mjs --production --email <邮箱>` 查看计划，加 `--apply --confirm <邮箱>` 显式初始化根账户并重新登录；不预设负责人邮箱，不依赖抢先注册。开发和预生产保留原有首用户初始化行为。
4. 核实部署计划后由负责人发布，确认正式 robots 允许索引、staging 仍 noindex、健康接口、邮件与匿名权限；UI／真实设备验收按任务授权另行执行。
5. 正式入口就绪后，再批准状态页和正式 Android／Kai 包发布。更新网站频道属于独立数据写入，不由 GitHub Release 自动触发。

## 迁移、备份与恢复

`0001_init_archive_schema.sql` 为首发基线。正式初始化后冻结已应用 migration，后续结构、权限、触发器改动追加有序迁移，不再改写 0001；代码、固定开发种子和迁移账本同步。干净种子准备脚本在临时库执行完整迁移链，并在 manifest 保存每个文件的校验和。

旧环境已登记同名 0001 时不会再次执行该文件。发现历史账本、旧结构或不同数据基线时停止，单独准备转换方案；不把修改迁移账本伪装成结构已经升级。保护真实账户、业务记录、已发布 API、manifest、更新协议及用户离线存档；只为必要的实际升级保留兼容。

数据操作先核实目标 ID、前置状态与预期行数；R2 列出 key、摘要及全局引用，禁止按前缀猜测并删除。根账户轮换默认只显示计划，执行需 `--apply --confirm <目标邮箱>`，保留原子轮换、相关 session 撤销和审计。

备份写明数据库身份、时间、迁移版本、R2 对象清单、存放位置、恢复顺序及验证结果。D1 备份不涵盖 R2 或 DO 浏览量；恢复能力、保留期、可接受的数据损失与恢复时间在实际发布方案中记录。敏感备份不得提交 Git 或上传公开 artifact。备份／恢复按已批准范围执行。

Worker 回滚不自动恢复数据。先确认旧代码能使用当前 schema，保留对应静态资源与绑定；已删除 R2 对象不能通过回滚 Worker 找回。写入失败或响应不确定时先核对远端结果，不盲目重试，不自动整库恢复。

## 检查范围

`smoke:production` 显式指向 viprpg.org，拒绝不匹配的 URL 覆盖、设置超时并拒绝重定向。它沿用 HTTP 状态检查，不能代替 schema 一致性、邮件送达、真实设备或完整业务验收。默认仅运行与改动相关的最小既有检查；新增测试和浏览器操作遵守 AGENTS 的授权边界。
