# VIPRPG-ZH-Archive Claude Code Guide

请默认使用中文与维护者沟通，除非任务明确要求其他语言。

## 项目概况

- 技术栈：Next.js App Router、React、TypeScript、原生 CSS。
- 部署目标：OpenNext / Cloudflare Workers，数据与对象存储围绕 D1/R2。
- 常用命令：
  - `npm run dev`：本地开发。
  - `npm run check`：TypeScript 与 ESLint。
  - `npm run build`：Next.js 构建。

## 数据模型兼容策略

- 项目尚未正式上线、没有需要保护的生产数据时，不为已经废弃的内部模型保留兼容层。
- 不新增 `legacy_*` 字段、兼容包装器、双写路径或旧表引用，除非维护者明确要求保留历史数据。
- 如果架构决策改变，直接把文档、migration、代码路径推进到唯一当前模型，并清理旧模型残留。
- 只有存在真实生产数据、外部 API 契约或维护者明确要求平滑迁移时，才设计兼容层；兼容层必须写明退出条件。

## UI/UX 目标

本项目当前 UI 应逐步改造成“现代化的 VIPRPG 祭典页”，参考 `https://vipsummer2024.x.2nt.com/index.html` 的外形气质，但不能做成不可用的复古网页复刻。

做 UI/UX 相关任务前必须先读：

- `docs/ui-viprpg-festival-design-brief.md`

核心方向：

- 公共浏览页可以更有祭典、像素游戏、蓝天海面、绿色面板、横幅入口的风格。
- 管理端、上传页、在线游玩页仍然要高效、密集、可扫描，视觉上套用同一主题但不牺牲操作效率。
- 参考站点的 iframe、广告位、`font` 标签、表格布局等旧实现只作为视觉来源，不照搬实现方式。

## UI 工作流

处理 UI 改动时按这个顺序执行：

1. 先阅读相关页面、`app/globals.css`、共用组件和设计 brief。
2. 若需求范围较大，先提出 2-3 个视觉方向与页面分层方案，等待维护者确认后再大改。
3. 优先改现有 CSS 变量、布局模式和局部组件，不为了视觉效果引入无必要依赖。
4. 完成后运行 `npm run check`。
5. 使用 Playwright 或 Chrome DevTools MCP 打开本地页面，至少检查桌面 `1440x900` 和移动端 `390x844`。
6. 截图后检查：溢出、重叠、对比度、焦点态、按钮可点击区域、移动端换行、控制台错误。
7. 发现视觉问题要继续修正，不要只报告“已完成”。

## 文件边界

- 不读取或依赖 `.env.local`、`.wrangler/`、`.next/`、`.open-next/`、`node_modules/`。
- 不改动与当前任务无关的 migration、数据库模型或归档存储逻辑。
- 工作区可能已有维护者未提交改动；不要回滚不属于当前任务的变更。
