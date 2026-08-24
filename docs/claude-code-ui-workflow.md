# UI 工作流

当前 UI 工作以 [`product-direction-plan.md`](./product-direction-plan.md) 为准：这是一个围绕作品发现、游玩、下载和讨论的 RPG 平台，不是 festival 视觉复刻项目。

## One-Time Setup In VSCode

1. Open this repository in VSCode.
2. Open Claude Code from the VSCode extension.
3. Run `/status` and confirm project settings are loaded from `.claude/settings.json`.
4. 确认当前浏览器控制能力可用；不要为本项目新增旧的 Playwright 工作流。
5. Optional but recommended: run `/plugin`, open Discover, and install Anthropic's `Frontend Design` plugin.

如果浏览器控制能力不可用，先使用当前 Codex/Chrome 集成的连接诊断；不要在本项目新增 Playwright MCP 或独立浏览器自动化依赖。

## Recommended Commands

Use this before a large interaction/navigation rewrite:

```text
请先阅读 docs/product-direction-plan.md，分析首页、游戏列表、作品详情、上传入口和管理入口的任务边界。不要先改代码；先给出会删除的冗余、保留的生产能力和最小实施顺序。
```

Use this when asking Claude to redesign pages:

```text
请按 docs/product-direction-plan.md 将首页改成作品推荐和发现空间，保留现有登录、站内信、下载、在线游玩和上传入口。
先给 2-3 个视觉方向，等我确认后再改代码。
```

Use this after UI edits:

```text
/ui-audit app/page.tsx app/globals.css
请用当前可用的原生 Chrome 控制检查桌面和移动端，按任务完成、溢出、重叠、焦点态和控制台错误列出问题。
```

For a larger redesign, start with public pages first:

```text
请按 docs/product-direction-plan.md 先处理首页、游戏列表、作品详情页。
不要动管理端和数据库逻辑。先统一公共浏览体验和导航，列出所有现有入口迁移到哪里。
```

## What Claude Should Verify

- `npm run check`
- desktop screenshot: `1440x900`
- mobile screenshot: `390x844`
- console errors
- layout overflow and text overlap
- focus/hover states
- fidelity to `docs/product-direction-plan.md`
- primary task paths still work after interaction changes

## Current UI Structure

- Shared primitives live in `app/components/ui/` and use Tailwind utility classes with Radix behavior.
- `app/globals.css` is the only application stylesheet. It contains the Tailwind import and design tokens; page styles do not use authored CSS selectors.
- Visible controls consume the shared `Button`, `Input`, `Textarea`, `Label`, `Checkbox`, `SelectField`, `Progress`, `AlertDialog`, `Badge`, `Card`, and `Table` primitives. Native controls are limited to hidden protocol inputs, file pickers, datalists, canvas, and iframe/runtime elements.
- Home tabs intentionally remain an `Rm2kButton` hash-anchor button group because their product contract is scroll-linked navigation; the unused generic Radix Tabs scaffold is not retained.
- 少量当前参考截图可放在 `docs/audit/reference/`；旧阶段截图不是当前验收标准。
