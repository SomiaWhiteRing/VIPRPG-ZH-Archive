# 正式部署与数据维护

本项目由一人维护。负责人在 GitHub 手动选择 `target=production` 并运行 workflow 即确认本次正式发布，检查通过后直接部署，无需再点击 `Review deployments`；不要求第二位审核人、强制 PR 或禁止直接推送 main。main 推送继续自动发布预生产。

## 环境与授权

正式目标为 `https://viprpg.org`，预生产为 `https://staging.viprpg.org`。[环境总表](./staging-deployment.md#环境地址与配置来源)区分目标地址、本地配置和 CI 配置；域名写入配置不代表已上线。

正式代码发布、回滚、资源绑定／secret／路由变更，以及 Codex 经 D1、R2、DO、后台或 API 发起的数据写入，都需负责人对具体目标和操作范围明确确认。先准备代码、检查结果、资源身份、SQL／对象清单、影响和回退方案，再确认执行。一次确认可覆盖完整批次；范围或候选变化才重新确认。会话、token、管理员身份或命令确认参数均不代替用户授权。

网站注册、上传、编辑、审核等正常业务继续按现有权限运行；已批准部署中的定时 GC、评论图片清理、浏览量合并重试无需每次人工确认。手动触发正式清理、修改其宽限期／上限或批量处理数据仍需确认。只读检查按实际副作用判断，不把写审计／修复结果的操作当作纯读取。

## 单人 GitHub 发布

`Deploy` 的 `candidate` job 使用隔离配置执行既有检查，没有正式写凭据。手动选择 `target=production` 并点击 `Run workflow` 即确认发布该次固定 SHA；候选摘要记录 SHA、迁移清单及规范化 LF 后的 SHA-256。检查通过后直接进入正式 job，签出同一 SHA，生成并核对资源配置，构建、发布，最后执行正式 smoke。检查失败会停止发布，没有第二次 Environment 审批。Codex 代为触发须已获得用户对本次发布的明确授权。

正式 workflow 自动核对迁移账本并应用候选中待执行的迁移，无需手动勾选；没有待执行迁移时直接继续部署，迁移失败则停止发布。手动选择 `target=production` 并运行 workflow 的确认包含本次候选中的待应用迁移，不包含数据修复、seed 导入或重建数据库。账本按文件名核对，不能证明历史同名 SQL 的内容一致，首发前仍须核对实际 schema。迁移发生在 Worker 发布前，需兼容短暂继续运行的旧 Worker；不兼容变更应单独安排停写窗口。本地 CLI 仍通过 `--apply-migrations` 区分包含迁移的发布与仅发布代码。

production Environment 不配置 required reviewers，继续保存正式 secrets 并限制只有 main 可以发布。主站正式 job 仅在手动选择 production 且候选成功时执行；共用该 Environment 的正式 Android Release 也在手动启动、构建校验通过后直接发布。独立 status Environment 保留现有审批配置。正式主站、状态服务和正式 Android workflow 使用 `production-maintenance` 互斥组；本地／API 维护仍需人工确保不与其并发。

正式 secrets 使用独立名称，避免回落到旧仓库级配置：

| production Environment secret | 内容 |
| --- | --- |
| `PRODUCTION_CLOUDFLARE_ACCOUNT_ID` | 已核实的正式 Cloudflare account |
| `PRODUCTION_CLOUDFLARE_API_TOKEN` | 正式部署所需 token，只在受保护 job 中注入 |
| `PRODUCTION_WRANGLER_CONFIG_JSONC` | 仅含正式资源的 JSONC，结构为本地 Wrangler 顶层；24小时入口试用仍保持原Custom Domain基线 |

staging 保留该 Environment 的 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`WRANGLER_CONFIG_JSONC`。配置生成器接受目标资源对象，也可从完整本地配置选择 staging；输出不携带另一环境的实际资源；staging 构建的未选中顶层不绑定远端资源，正式构建移除 staging 段。生产 token 不应另存绕过环境隔离的仓库级副本。旧仓库凭据先核对消费者和权限，再迁移或撤销，不能盲删仍在使用的凭据。

2026-10-06 已实施的24小时主站入口试用没有修改 `PRODUCTION_WRANGLER_CONFIG_JSONC` 的Custom Domain基线。工作流将 `PRODUCTION_INGRESS_CONFIG_JSON` 映射为 `MAIN_INGRESS_CONFIG_JSON`，仅在其中trial有效时覆盖生成配置的routes；trial包含id、startsAt、expiresAt，并在配置中记录originalDomainId。到期prepare自然回到原Custom Domain基线。使用试用routes时，build前及publish前各检查至少10分钟余额，不足即停止该次试用发布。

入口工作流本次复用已验证入口读写权限的运维凭据，单独保存在production Environment的 `PRODUCTION_INGRESS_API_TOKEN`；原正式发布token不改。选点显式映射 `INGRESS_CF_READ_TOKEN`/`INGRESS_CF_DNS_TOKEN`，到期巡检映射 `CLOUDFLARE_API_TOKEN`。程序以严限定的目标身份及API方法/路径allowlist约束操作。这不是已经建立最小权限的两枚token；未来再拆分专用只读与DNS写入凭据，不向公开artifact输出凭据。

## 本地准备与执行

Wrangler 顶层仍对应原正式 Worker，`env.staging` 对应预生产；没有为命名统一创建 `-production` Worker。`--env production` 是项目脚本的显式选择，不会再传给 Wrangler 追加名称。

```powershell
npm run deploy:production -- --plan
npm run db:production:migrate -- --plan
```

第一条仅显示本地资源与迁移清单，不构建、不连接远端。第二条只读查询正式迁移账本，显示已应用和待应用文件；它不调用会初始化账本的 `wrangler d1 migrations list`。

候选包含 `0019_unique_user_display_names.sql` 时，迁移计划还分页读取活跃和禁用账户的显示名，共用 `lib/display-name.ts` 的注册／改名规则，检查长度、非法控制字符及不可见字符上下文、NFC 与空白规范化，以及 ASCII 大小写冲突；报告只列数量和用户 ID，不输出昵称或邮箱。`⑨` 等兼容字符保留原样，不再因 NFKC 折叠被列为待修复。存在非法字符、旧名称需要 NFC／空白规范化或冲突时停止，不自动改名。修复须另行预览并取得具体账户范围的批准。应用 `0019` 后再次检查，通过才继续发布 Worker；发布期间应暂停注册和改名，避免旧 Worker 在检查和切换之间写入未规范化名称。迁移失败时保留现有 Worker，不以导入开发种子或重建正式库替代升级。

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

交互终端显示目标后要求输入 `viprpg.org`。已取得用户确认的非交互执行使用 `--confirm viprpg.org`；CI 在手动 production 运行的候选检查通过后传入此参数，不再等待 Environment 审批。`CI=true` 本身不放行。裸 `npm run deploy` 拒绝执行，必须指定目标。预生产用 `npm run deploy:staging -- --apply-migrations`。

## 首次正式初始化

2026-09-26 已按负责人本次部署授权完成首次上线：`viprpg-zh-archive` 绑定 viprpg.org，新 D1/R2 均名为 `viprpg-archive-production`。初始干净数据包括 930 个角色、132 个分类及 17,173 个对象（150,282,413 字节），不含开发用户和作品；schema、迁移账本、外键、逐表数量及全量对象大小／摘要已核对。首次数据清单和旧 Worker 版本／绑定记录位于本机忽略目录 `output/production-setup/`。

旧 `viprpg-archive-prod` D1/R2 和 staging 资源保持原状，不能当作当前正式数据源。当前正式身份来自部署绑定及 production Environment 配置。旧 Worker 版本使用旧 schema／origin，不应直接回滚它来服务新正式库；首发候选及之后的兼容版本才是正式回滚基线。

首次初始化采用以下步骤；日常部署不重复导入种子：

1. 确定正式 Worker、独立空 D1/R2、DO、限流 namespace 与 AUTH_SECRET；保存旧资源身份、Worker 版本和恢复方案。核实 TLS、邮件域验证、EMAIL binding 和 `noreply@viprpg.org` 实际发信。
2. 应用完整迁移链，记录首发 SHA、文件校验和与账本。用[干净种子](./staging-deployment.md#干净种子)准备经过审核的数据，只上传 manifest 指定对象；不导入本地／staging 的用户、会话或整库。软件包和更新频道另列发布清单。
3. 核对表数量、外键、R2 大小和摘要。负责人上线后自行完成邮箱验证与首次注册；正式站与预生产、开发环境一致，首个验证注册账号自动获得 `super_admin`，已有超级管理员时不重复授予。首次注册不需要额外运行维护脚本；根账户轮换仅在需要时按已确认的目标邮箱执行。
4. 核实部署计划后由负责人发布，确认正式 robots 允许索引、staging 仍 noindex、健康接口、邮件与匿名权限；UI／真实设备验收按任务授权另行执行。
5. 正式入口就绪后，再批准状态页和正式 Android／Kai 包发布。更新网站频道属于独立数据写入，不由 GitHub Release 自动触发。

## 下载统一主站与24小时入口试用

2026-10-06 已按负责人授权发布同源产品，正式Worker版本为 `ff38e592-869a-48f1-b7f3-634e303c2ccc`。香港时间23:20:48将主站切至灰云 A `8.35.211.227`，试用到期为2026-10-07 23:20:48（香港时间）；原CD配置secret基线未改。首次原生下载的ASN重定向、跨域候选响应头及安装器换源已移除，公开 ZIP、页面和API统一经 `https://viprpg.org`。12项DNS及指定入口HTTPS核验通过，覆盖首页、robots、健康接口、DB/R2和8 KiB ZIP Range，下载内容摘要一致。实际大陆三网表现仍待测量，迁移与运行规则见[主站入口说明](./main-ingress-selection.md)。

同源安装器保留15秒网络等待限制、最多两次故障重连、强 ETag与Range续传、取消和现有进度。持续收到数据的低速传输继续下载，不因低于某个速率消耗重连次数。ZIP构建、缓存、版本固定、未发布对象的访问检查及归档字节协议没有回退；不复制或清理 D1/R2/DO及用户存档。

旧DNS、Route、独立Worker源码/绑定、主站版本及配置已保存。同源产品核验后，`download.viprpg.org`、`download-asia.viprpg.org` 的DNS、Routes及 `viprpg-download` Worker已删除并回读成功，没有删除业务数据；relay源码、部署脚本和命令也已清理，不保留历史入口。已保存的旧域名下载链接会在DNS缓存过期后失效；已打开或缓存旧安装器的页面、正在中断重试的旧下载可能需要刷新主站并重新生成链接。回滚旧分流代码前必须同时恢复旧入口资源。

六小时selector与[到期巡检工作流](../.github/workflows/main-ingress-trial.yml) 已推送，`MAIN_INGRESS_AUTO_ENABLED`、`MAIN_INGRESS_TRIAL_ENABLED` 两个开关已启用。selector在trial到期后停止PATCH，恢复工作流每15分钟核实是否应恢复，按owned资源身份先删除试用A，再通过公开Custom Domain PUT API绑定回同一个正式Worker；正常DNS与HTTPS健康确认后才删除trial Route。GitHub排程可能延迟或丢任务，不能承诺秒准恢复。原CD配置secret保持不变，到期后的准备和日常发布使用该基线。

正常到期只恢复主站接入，继续已部署的新同源下载产品，不回滚产品代码或恢复这两个废旧下载域名。完整旧版本回滚属于另外的操作范围；若需要恢复旧分流，须同时恢复其relay资源。

历史上，这两个专用入口只服务公开 ZIP；独立 Worker仅通过 `ARCHIVE_SOURCE` service binding调用正式 Worker，不复制 D1/R2或另建缓存。2026-10-06 初测中，联通使用 `162.159.140.245`，电信/移动另测 `172.64.155.209`，部分小分段响应得到改善；这些是当时的有限测量，不能证明固定机房、所有省份或大包持续吞吐。

先前分流依据来自2026-09-30至2026-10-06的26个日志窗口：剔除测试、重定向及11次内存和5次子请求限额后，保留1,590个下载请求。原始日志仍可能采样；取消不等于线路故障，大文件耗时长也不能单独证明线路慢。以下仅保存历史诊断，不代表新候选仍按 ASN分流：

| ASN | 历史日志中的异常依据 |
| --- | --- |
| 4837、17816（联通） | 长时间取消；广东联通18次无Range尝试有15次取消 |
| 4134（电信） | 排除资源异常后，166.5 MB完整包仍耗约25.8分钟 |
| 9808（移动） | 144.1 MB完整包耗约14.3分钟 |
| 24445（移动） | 54.9 MB完整包耗约6.7分钟；原入口三轮探针连接失败 |
| 56041（移动） | 83.4 MB完整包耗约7.4分钟，CPU仅2 ms |
| 56044（移动） | 166.5 MB完整包耗约16.8分钟 |

地方 ASN 17816、56041、56044当时按日志选入，没有公开同 ASN探针证明逐线路收益。公开探针验证了8 KiB完整 ZIP Range、证书和等待；Globalping会停止读取大响应，不能据此估算整包速度。忽略目录 `output/download-route-expansion-20261006/` 保存原始查询、排除明细、固定探针对照及历史发布验证。

## 迁移、备份与恢复

`0001_init_archive_schema.sql` 为首发基线。正式初始化后冻结已应用 migration，后续结构、权限、触发器改动追加有序迁移，不再改写 0001；代码、固定开发种子和迁移账本同步。干净种子准备脚本在临时库执行完整迁移链，并在 manifest 保存每个文件的校验和。

旧环境已登记同名 0001 时不会再次执行该文件。发现历史账本、旧结构或不同数据基线时停止，单独准备转换方案；不把修改迁移账本伪装成结构已经升级。保护真实账户、业务记录、已发布 API、manifest、更新协议及用户离线存档；只为必要的实际升级保留兼容。

数据操作先核实目标 ID、前置状态与预期行数；R2 列出 key、摘要及全局引用，禁止按前缀猜测并删除。根账户轮换默认只显示计划，执行需 `--apply --confirm <目标邮箱>`，保留原子轮换、相关 session 撤销和审计。

根账户轮换的计划和执行先只读核对目标有效、邮箱已验证且没有单独禁用权限；有禁用记录时先由当前根管理员恢复，再重新确认轮换。授予根角色时在同一原子批次再次检查禁用记录，条件变化会使整次轮换失败并回退，保留原根角色及会话。

备份写明数据库身份、时间、迁移版本、R2 对象清单、存放位置、恢复顺序及验证结果。D1 备份不涵盖 R2 或 DO 浏览量；恢复能力、保留期、可接受的数据损失与恢复时间在实际发布方案中记录。敏感备份不得提交 Git 或上传公开 artifact。备份／恢复按已批准范围执行。

Worker 回滚不自动恢复数据。先确认旧代码能使用当前 schema，保留对应静态资源与绑定；已删除 R2 对象不能通过回滚 Worker 找回。写入失败或响应不确定时先核对远端结果，不盲目重试，不自动整库恢复。

## 检查范围

`smoke:production` 显式指向 viprpg.org，拒绝不匹配的 URL 覆盖、设置超时并拒绝重定向。它沿用 HTTP 状态检查，不能代替 schema 一致性、邮件送达、真实设备或完整业务验收。默认仅运行与改动相关的最小既有检查；新增测试和浏览器操作遵守 AGENTS 的授权边界。
