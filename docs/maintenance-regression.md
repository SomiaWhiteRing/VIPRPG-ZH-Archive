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
| `npm test` | 独立临时 D1/R2 中的稳定 HTTP/API 契约 | 不启动浏览器流程；不依赖开发 seed |
| `npm run regression` | 日常自动回归 | 串行运行 `check` → `test`，保留报告和阶段日志 |
| `npm run regression -- --flow --build` | 预生产或发布前完整候选 | 额外运行浏览器/Worker 流程和生产构建，耗时较长 |
| `npm run smoke:staging` | 已部署 staging 的健康入口 | 只在已有部署上执行，不替代本地回归 |

`npm run regression` 发现的证据目录是 `output/regression/<timestamp>/`：`report.json` 保存工作树快照、阶段状态、退出码和日志路径；每个阶段的 `.log` 保存原始 stdout/stderr。成功时目录仍被保留但不进入 Git；失败时先看报告和最后一个失败阶段的日志，再决定是否需要修产品代码。

## 失败分类

- `scheduling`：出现 `SQLITE_BUSY` 或 database lock；停止并行 D1/Worker 检查，串行重跑一次。
- `test-harness`：出现 watchdog timeout、Next.js dev overlay、Playwright locator 或浏览器驱动问题；不能据此重设计产品。若一个 HTTP 请求没有自己的超时，先把它视为测试可观测性缺口。
- `environment`：出现权限、文件不存在、命令不存在或本机依赖问题；先补运行环境。
- `unknown-product-or-harness`：脚本只表明失败，不能直接断言是产品缺陷；结合失败阶段、最小复现和日志分类。

两次重跑仍无新 observable 时停止，不扩大到相邻模块。夹具、环境和调度失败不作为改造产品代码的依据。没有执行 `npm run regression -- --flow --build` 或人工浏览器操作时，不得描述为完整流程或 UI 验收通过。

## 当前已验证的经验

- 本项目尚未正式上线且无需保护的生产数据；废弃内部模型直接收敛到当前模型，不添加 `legacy_*`、旧端点别名、双写或浏览器状态兼容层。
- 本地开发数据的重建是破坏性操作：`npm run db:local:reset` 后按需 `npm run db:local:seed`，只影响 Wrangler 本地状态，不代表远端迁移。
- `npm test` 和 `npm run test:flow` 自行创建临时状态；不要与本地 D1 reset/seed 或另一条有状态检查并行。
- 在线游玩、上传和发布的自动检查通过，不等于人工移动端、全屏、文件选择或真实用户路径验收；这些仍须用户明确授权后单独执行。
