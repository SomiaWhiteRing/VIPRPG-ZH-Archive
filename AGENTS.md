# Project constraints

- 当前项目处于上线前阶段。没有真实数据或外部契约需要保护时，使用唯一当前模型，不为废弃内部模型新增兼容层。
- 分类、角色和归属关系是不同对象。修改当前分类库时先核实实际数据源及目标 ID；删除一个分类归属不代表角色没有其他归属。
- 默认运行与改动直接相关的最小既有检查，不默认新增测试，不将全套 check、test、build 或浏览器流程作为每项任务的验收。
- 共享状态的 D1、API、Worker 和浏览器检查串行执行；不用修改产品逻辑来掩盖夹具、环境或调度故障。
- 明确进行回归、维护诊断或测试设计时，按需查阅 [docs/maintenance-regression.md](docs/maintenance-regression.md)。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
