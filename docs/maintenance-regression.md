# 维护与回归手册

本文是项目日常维护、失败归因和自动回归证据的唯一操作入口。根目录 `AGENTS.md` 只保留必须始终生效的范围与安全边界；领域文档只引用相关命令，不复制本手册。

## 维护前置检查

1. 先运行 `git status --short`，把已有 staged、unstaged 和 untracked 改动视为受保护输入。
2. 不为清理工作树而 reset、checkout、stash、删除文件或覆盖配置；如果目标变更无法与脏工作树隔离，先停止并报告 blocker。
3. 记录当前分支、`HEAD` 和远程 tip。涉及历史重写或远端写入时，必须另行确认远程无新提交、创建备份 ref，并使用 `--force-with-lease`；普通回归不触碰远端。

## 回归入口

| 入口 | 用途 | 副作用与边界 |
| --- | --- | --- |
| `npm run check` | 类型、lint、静态架构、安全和 UI 静态规则 | 不证明浏览器交互；按改动需要单独运行 |
| `npx tsx scripts/ui-self-check.ts` | `app` 下 TSX 控件和样式改动的最小 UI 静态检查 | 仅扫描源码，不启动浏览器；规则独立于 TypeScript 和 ESLint，已包含在 `npm run check` 中 |
| `npx tsx scripts/shared-boundary-check.ts` | 公共请求、响应、输入解析、对象键、哈希和格式化入口约束 | 仅扫描源码，逐项输出文件、行号和规则；已包含在 `npm run check` 中 |
| `npm test` | 独立临时 D1/R2 中的稳定 HTTP/API 契约 | 不启动浏览器流程；不依赖开发 seed |
| `npm run test:forum` | 论坛持久契约 | 使用独立内存 SQLite，不启动浏览器或开发 Worker |
| `npm run test:timeline` | 时间线迁移保留、加入／改名永久记录、注册默认值、隐私表单、好友、互动、配图及首玩持久契约 | 使用完整迁移链的独立内存 SQLite，不启动浏览器或访问远端；Deploy 候选串行执行 |
| `npx tsx scripts/archive-performance-check.ts` | ZIP Range 字节、热门缓存命中/覆盖竞争/失败回退/容量与过期、GC 候选分页及游标推进 | 使用内存 SQLite 和模拟对象存储，不启动浏览器或访问运行中的数据 |
| `node scripts/download-cache-runtime-check.mjs` | workerd 中的定长 ZIP 流写入 R2、完整命中、条件 Range、If-Range 与 HEAD | 使用临时本地 R2 和固定元数据夹具，不启动浏览器或访问远端；与其他 Worker 检查串行 |
| `npx tsx scripts/manual-gc-check.ts` | 手动两段清理的完整分页、范围绑定、权限、取消及失败重试安全契约 | 完整迁移链的内存 SQLite 与模拟 R2，不访问远端；与其他有状态检查串行 |
| `npx tsx scripts/archive-gc-check.ts` | 失败归档过期、溯源外键、共享引用保护和 D1/R2 失败重试 | 使用完整迁移链的内存 SQLite 和模拟 R2，不启动浏览器或访问运行中的数据 |
| `npm run regression` | 明确需要综合回归时使用 | 串行运行 `check` → `test`，保留报告和阶段日志 |
| `npm run regression -- --flow --build` | 预生产或发布前完整候选 | 额外运行浏览器/Worker 流程和生产构建，耗时较长 |
| `npm run smoke:staging` / `smoke:production` | 对应环境的只读 HTTP 健康入口 | 固定 origin，不写业务数据；不替代 schema、邮件或 UI 验收 |

`npm run regression` 发现的证据目录是 `output/regression/<timestamp>/`：`report.json` 保存工作树快照、阶段状态、退出码和日志路径；每个阶段的 `.log` 保存原始 stdout/stderr。成功时目录仍被保留但不进入 Git；失败时先看报告和最后一个失败阶段的日志，再决定是否需要修产品代码。

### 公共实现约束

- 浏览器与 Web Worker 的普通 JSON 请求使用 `lib/ui/api-response.ts` 的 `requestJson`；资源链接 API 直接返回业务对象，使用 `requestJsonValue` 或 `postJson`。二进制和 204 响应使用 `requestOk`。这些入口共用网络失败、HTTP 错误、无效响应和取消处理，不自行复制错误解析。
- 上传提交回查、草稿恢复、只重试网络传输的上传请求，以及同时处理 HTML 跳转与 JSON 的 `RedirectForm`，可以通过 `requestResponse`／`readJsonResponse` 查看原始状态。静态检查按文件和函数限制这些消费者，不能扩大为整个目录的豁免。失败状态的 JSON 仅在恢复决策需要时显式设置 `allowFailure`。
- 服务端 JSON 响应通过 `lib/http.ts` 创建；缓存用途仍可显式覆盖默认 `no-store`。请求 JSON 通过 `readJsonObject` 读取，论坛、表情和资源管理分别保留 128 KiB、64 KiB、256 KiB 的请求体上限及各自的编码／类型要求。表单内的 JSON 字段和数据库 JSON 属于领域解析，不按 HTTP JSON 对象处理。
- API 正整数 ID 使用 `parsePositiveId`，页面 ID 使用 `parsePageId` 保留 404 语义。对象键使用 `lib/archive/object-keys.ts`，Web Crypto SHA-256 使用 `lib/sha256.ts`；公共函数可供网站、浏览器 Worker、下载／GC Worker 和 Node 脚本消费。
- UI 检查限制业务代码直接导入 Dialog、Popover、Checkbox 和路由／文档离开保护钩子，并限制原生 table。使用公共弹层及导航保护入口，保留定位、焦点恢复、虚拟锚点、iframe 判断和移动端布局。DropdownMenu、Slider、ToggleGroup、树及自动完成控件仍可使用对应库。
- 公共边界检查扫描产品源码与运维脚本，排除契约夹具和分析实验脚本；运维脚本的外部 HTTP 下载、Node 原生哈希和需要捕获 JSON／同步结果的进程调用保留原实现。普通 Wrangler shell 启动使用 `runWrangler`。

## 失败分类

- `scheduling`：出现 `SQLITE_BUSY` 或 database lock；停止并行 D1/Worker 检查，串行重跑一次。
- `test-harness`：出现 watchdog timeout、Vite 开发错误覆盖层、Playwright locator 或浏览器驱动问题；不能据此重设计产品。若一个 HTTP 请求没有自己的超时，先把它视为测试可观测性缺口。
- `environment`：出现权限、文件不存在、命令不存在或本机依赖问题；先补运行环境。
- `unknown-product-or-harness`：脚本只表明失败，不能直接断言是产品缺陷；结合失败阶段、最小复现和日志分类。

两次重跑仍无新 observable 时停止，不扩大到相邻模块。夹具、环境和调度失败不作为改造产品代码的依据。没有执行 `npm run regression -- --flow --build` 或人工浏览器操作时，不得描述为完整流程或 UI 验收通过。

## 环境与数据边界

### 提交前迁移检查

首次使用本 checkout 时运行 `npm run hooks:install`，启用仓库 `.githooks/pre-commit`。钩子通过 Node 检查暂存区，每次提交最多新增一个 `migrations/*.sql`（包含子项目迁移目录）；多个新增文件会阻止提交并列出文件名。不运行全套测试，也不会自动改写迁移。

需要合并时，仅整理本次尚未发布、远端未应用的迁移，并同步固定开发种子。若已在本地执行，先备份、确认 schema 和数据已完整应用，再整理本地迁移账本，不能重新执行相同 ALTER TABLE 或重建库丢弃数据。检查仅限制本次暂存内容，不能阻止分成多次提交或 `--no-verify` 绕过；新 checkout 需重新启用钩子。

- 使用当前领域模型，并保护正式数据、已发布契约和用户存档。首发后冻结已应用迁移，以增量迁移升级；不以清理废弃模型为由删除真实数据所需的升级支持。正式部署、数据维护和回退由负责人本人确认，见[正式手册](./production-deployment.md)，不要求多人评审。
- 本地开发数据的重建是破坏性操作：`npm run db:local:reset` 后按需 `npm run db:local:seed`，只影响 Wrangler 本地状态，不代表远端迁移。
- `npm test` 和 `npm run test:flow` 自行创建临时状态；不要与本地 D1 reset/seed 或另一条有状态检查并行。
- 在线游玩、上传和发布的自动检查通过，不等于人工移动端、全屏、文件选择或真实用户路径验收；这些仍须用户明确授权后单独执行。

## 测试设计与验收范围

- 在用户明确宣布进入预生产阶段前，项目按敏捷阶段验收：测试只守静态规范和持久契约，流程覆盖不是功能完成条件。
- 默认只运行与改动直接相关的最小检查；不得把 `check`、`test`、`build` 固定全套当作每项任务的最终验收。
- `npm run check` 负责类型、lint、静态架构和安全规则。静态规则不得绑定可见文案、当前组件使用关系、历史文件是否存在或其他一次性清理结果。
- `npm test` 负责隔离状态中的稳定契约，不启动浏览器流程。每条契约自行创建最小夹具，只断言公开输入输出、权限边界、数据约束或领域不变量，不依赖另一业务流程铺垫状态。
- 新功能默认不新增测试。只有持久领域不变量、权限或安全边界、数据损坏风险，或已复现且容易回归的缺陷，才增加一条位于最低可验证层的独立检查。
- 不断言可见文案、DOM 层级、点击顺序、耗时、内部函数拆分或 SQL/文件布局；不要用大快照、重试或放宽超时掩盖不稳定。
- `rg` 等残留扫描是迁移当次的验收证据，不转成永久测试。
- `npm run test:flow` 只在预生产、发布前或用户明确要求时运行；只保留上传、归档恢复、原生下载和浏览器安装等关键黄金路径，并使用语义化稳定标记。
- `npm run build` 只在构建配置、路由边界、部署链路变化，或预生产验收时运行；预生产完整入口是 `npm run verify:preprod`。
- 失败后先分类为产品、测试夹具、环境或调度问题；夹具和环境失败不能作为改造产品代码的依据。有状态 D1、API、Worker 和浏览器检查必须串行运行。
- 新增测试代码、人工 UI 测试或浏览器交互均需用户明确授权；当前任务已有授权时不重复询问。

### EasyRPG 官方游戏回归

真实游戏验收使用 [EasyRPG 官方 TestGame](https://github.com/EasyRPG/TestGame) 的 `TestGame-EasyRPG`，下载脚本锁定提交 `4bbedb73492c80b79d8290e0b06ea86875b0bdc8` 并逐文件校验 Git blob 哈希。只下载当前归档策略支持的游戏数据，不运行仓库内可执行文件；ZIP、来源/许可证清单和回归记录保存在忽略的 `output/easyrpg/`。

```text
npx tsx scripts/fetch-easyrpg-testgame.ts
npm run build
npx tsx scripts/system-self-check.ts flow --game output/easyrpg/testgame.zip
node scripts/easyrpg-worker-check.mjs
```

此可选流程沿用独立临时 D1/R2，串行完成上传恢复、归档、原生下载、OPFS 安装，以及真实游戏菜单存档、IDBFS 持久化、离页/返回、读档、启动中离页、安装中离页确认与重装。`regression.json`、`runtime.log` 和截图记录实际结果。它不默认引入 CI 下载依赖，也不替代触屏及移动设备全屏验收。新增浏览器操作授权沿用本文的任务授权规则。

`easyrpg-worker-check.mjs` 沿用已下载的官方游戏数据库，生成最小换图与音频事件，直接运行当前私有 Worker 运行包。它检查首次及重复换图不缺帧、运行期间资源读取不经过 HTTP、音频输出、游戏 Worker 与网页各阻塞 500 ms 时独立供音、画布与截图的颜色和方向，以及持久写入失败后保留数据并重试停止、释放两个 Worker。帧间隔与音频欠载仅记录为本机采样，不作为跨设备性能承诺；报告在 `output/easyrpg/worker/report.json`。这两条浏览器检查串行运行。大型游戏的冷音效、压缩 BGM 与 MIDI 切换须另用实际音频采样，不能由连续 WAV 测试代替。
