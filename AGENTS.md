# Codex 约定

## 数据模型兼容策略

- 在项目尚未正式上线、没有需要保护的生产数据时，不为已经废弃的内部模型保留兼容层。
- 不新增 `legacy_*` 字段、兼容包装器、双写路径或旧表引用，除非用户明确要求保留历史数据。
- 如果架构决策改变，应直接把文档、migration、代码路径推进到唯一当前模型，并清理旧模型残留。
- 只有存在真实生产数据、外部 API 契约或用户明确要求平滑迁移时，才设计兼容层；兼容层必须写明退出条件。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
