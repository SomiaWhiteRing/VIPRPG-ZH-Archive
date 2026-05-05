# Claude Code UI Workflow

This repository includes project-level Claude Code configuration for a modern VIPRPG festival-inspired redesign.

## One-Time Setup In VSCode

1. Open this repository in VSCode.
2. Open Claude Code from the VSCode extension.
3. Run `/status` and confirm project settings are loaded from `.claude/settings.json`.
4. Run `/mcp` and confirm `playwright` and `chrome-devtools` are enabled. Claude Code may ask you to trust project MCP servers the first time.
5. Optional but recommended: run `/plugin`, open Discover, and install Anthropic's `Frontend Design` plugin.

If project MCP servers do not appear, add them at user scope from the VSCode terminal:

```powershell
claude mcp add playwright --scope user -- cmd /c npx -y @playwright/mcp@latest
claude mcp add chrome-devtools --scope user -- cmd /c npx -y chrome-devtools-mcp@latest
```

## Recommended Commands

Use this when asking Claude to redesign pages:

```text
/ui-redesign app/page.tsx app/globals.css
目标：把首页改成现代化 VIPRPG 祭典入口页，保留现有登录、站内信、下载、在线游玩和上传入口。
先给 2-3 个视觉方向，等我确认后再改代码。
```

Use this after UI edits:

```text
/ui-audit app/page.tsx app/globals.css
请用 Playwright 或 Chrome DevTools MCP 检查桌面和移动端截图，按严重程度列出问题。
```

For a larger redesign, start with public pages first:

```text
/ui-redesign 首页、游戏列表、作品详情页
不要动管理端和数据库逻辑。先统一公共页的视觉系统和导航。
```

## What Claude Should Verify

- `npm run check`
- desktop screenshot: `1440x900`
- mobile screenshot: `390x844`
- console errors
- layout overflow and text overlap
- focus/hover states
- fidelity to `docs/ui-viprpg-festival-design-brief.md`
