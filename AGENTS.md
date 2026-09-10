# Codex 约定

## 数据模型兼容策略

- 在项目尚未正式上线、没有需要保护的生产数据时，不为已经废弃的内部模型保留兼容层。
- 不新增 `legacy_*` 字段、兼容包装器、双写路径或旧表引用，除非用户明确要求保留历史数据。
- 如果架构决策改变，应直接把文档、migration、代码路径推进到唯一当前模型，并清理旧模型残留。
- 只有存在真实生产数据、外部 API 契约或用户明确要求平滑迁移时，才设计兼容层；兼容层必须写明退出条件。

## 测试策略

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
- 新增测试代码或执行人工 UI 测试仍需用户明确授权。

日常回归使用 `npm run regression`，它串行执行 `npm run check` 和 `npm test`，并把工作树快照、每阶段日志和失败分类写入被忽略的 `output/regression/`。只有预生产、发布前或用户明确要求时，才使用 `npm run regression -- --flow --build`；不要并行运行有状态 D1、API、Worker 或浏览器检查。

本文件只保留必须始终生效的边界。命令用途、故障定位顺序和回归证据格式以 `docs/maintenance-regression.md` 为准；产品领域文档只记录各自领域的不变量，不复制整套测试流程。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
