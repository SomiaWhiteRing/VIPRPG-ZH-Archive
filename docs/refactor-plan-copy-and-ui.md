# 文案与 UI 重构总计划（Copy & UI Refactor Plan）

制定日期：2026-07-06。基于对当前工作区（main 分支 + 未提交改动）的三份全量审计（路由/组件/CSS 结构盘点、全站文案审计、UI 实现层审计），并经过一轮对照仓库的事实核查修订。

执行状态：已完成（2026-07-13）。

本计划解决三个问题：

1. **AI 味冗余文案**——每页模板化解说、内部术语泄漏进 UI、跨页复制句式。
2. **混乱排版**——2311 行单文件 CSS、三代样式叠加、无间距/字号体系、区块结构随意。
3. **UI 审美**——festival 主题是"刷漆式补丁"而非体系，与 `docs/ui-viprpg-festival-design-brief.md` 的目标存在系统性差距。

---

## 0. 执行者须知（先读这一节）

### 0.1 执行规则

1. **严格按 Phase 顺序执行**（Phase 0 → 6）。Phase 内按编号步骤执行。每个步骤有「操作」和「完成标准（DoD）」，DoD 不满足不得进入下一步。
2. **每完成一步，在本文档对应的 `- [ ]` 上打勾**（改为 `- [x]`），这是唯一的进度记录。
3. **一个 Phase 一个 commit（或一组小 commit）**，commit message 用中文写明对应的 Phase/步骤编号，例如 `Phase 2.3: 语义 token 化，消除 festival 覆盖层`。
4. 本文档引用的**行号是 2026-07-07 快照**，代码会漂移。执行时以「grep 定位」为准：每条都附了可搜索的原文片段或类名，先 grep 再改。
5. **发现计划与现状冲突时**：小冲突（行号漂移、文件已改名）自行适配并在本文档该步骤下追加一行备注；大冲突（功能已不存在、方案不可行）停下来向维护者报告，不要自作主张换方案。
6. **不顺手重构无关代码**。本计划范围外的 bug、优化，记录到文末「§7 执行中发现的问题」清单，不当场修。

### 0.2 禁改边界（红线）

- 不改 `lib/server/**`、`migrations/**`、`app/api/**` 的任何业务逻辑。允许的唯一例外：从多个页面抽取重复的**纯展示函数**（如 `engineLabel`）到 `lib/labels.ts`（见 Phase 1.1）。
- 不改数据模型、不新增依赖（唯一可选例外：Phase 4.11 的本地像素字体文件，走 `next/font/local`，不装 npm 包）。
- 不读取 `.env.local`、`.wrangler/`、`.next/`、`.open-next/`、`node_modules/`。
- 不删除任何用户可达的功能。移动入口必须先填写该步骤的「功能保全表」（格式见 `docs/ux-rebuild-brief.md` 的 preservation map）。

### 0.3 每步通用验证协议

- **代码级**：`npm run check`（tsc + eslint）必须通过。
- **页面级**（凡是改了 UI 的步骤）：`npm run dev` 启动本地服务，用 Playwright 或 Chrome DevTools MCP 打开受影响页面，检查两个视口：桌面 `1440x900`、移动 `390x844`。检查项：无横向滚动、无元素重叠/溢出、主要操作可见可点、焦点态可见、控制台无新增错误。
- **阶段级**（每个 Phase 结束）：跑一遍 §6.1 的截图矩阵，并调用仓库自带的 reviewer agent 复核：UI 视觉用 `festival-ui-reviewer`，涉及导航/流程的用 `ux-flow-reviewer`。reviewer 提出的问题修完再进入下一 Phase。

### 0.4 需要预先知道的仓库事实

- 全站 39 个 `page.tsx` + 1 个 `app/layout.tsx`（无 loading/error/not-found）。约 8900 行 TSX。
- 样式 100% 集中在 `app/globals.css`（2311 行），无 CSS Modules / Tailwind / 其他 css 文件。
- 共享组件只有 4 个：`app/components/site-header.tsx`、`site-header-nav.tsx`、`site-footer.tsx`、`theme-body-class.tsx`。**没有** PageHeader / EmptyState / Badge / DataTable / FormField 等任何 UI 组件。
- 主题机制：`theme-body-class.tsx` 用 `useEffect` 按 pathname 给 `<body>` 挂 `theme-admin` / `theme-festival` 类；`layout.tsx` 里 body 默认 `theme-festival` → **admin 页首屏会先渲染成 festival 再闪变成 admin**。
- 文案约 90% 散落在 JSX 字面量中，无字典文件；枚举→中文的映射函数在多文件重复（`engineLabel`×4、`statusLabel`≈10 份等）。
- 内联样式几乎不存在（仅 3 处进度条宽度，合理），问题全在 globals.css 和 JSX 文案里。

---

## 1. 问题诊断（证据索引）

执行者不需要重新调查，直接使用本节结论；每条附 grep 关键词便于重新定位。

### 1.1 文案：八类 AI 味模式

| # | 模式 | 规模 | 典型证据（文件:行号，行号会漂移，以引文 grep 为准） |
|---|---|---|---|
| A | 每页标题下挂一段「这页是干嘛的」解说 subtitle | 41 页中约 25 页 | `app/games/page.tsx:38`「下载和在线游玩入口挂在各作品的发布版本与归档快照下」；`app/characters/page.tsx:27`「角色是独立于标签的资料类型」；`app/about/page.tsx:17`「项目背景、保存范围、技术架构与边界。」 |
| B | 「这里维护…/都在这里…/会显示在这里」句式 | 约 14 行（变体多，见 1.2-B 的 grep 口径） | `app/admin/works/page.tsx:23`「这里维护作品层的基础资料：（七连枚举）」；`app/me/page.tsx:50`「…都在这里集中管理」；`app/inbox/page.tsx:42`「都会在这里显示」 |
| C | 「XX 暂不在这里修改，避免破坏…」逐字复制 | 6 个 admin 编辑页 | grep `暂不在这里修改` 与 `暂不修改`：works/[workId]、creators/[creatorId]、releases/[releaseId]、tags/[tagId]、characters/[characterId]、series/[seriesId] |
| D | 空状态三件套跨页复制 | 「调整关键词后再试。」×5、「暂无简介。」×8 | grep `调整关键词`、`暂无简介` |
| E | 「N 个 X 符合当前条件」计数句式 | 5 处 | grep `符合当前条件` |
| F | 内部实现术语当用户文案 | 上传/游玩/首页/admin hint | `app/upload/page.tsx:54`「扫描、SHA-256、core pack、preflight、缺失对象上传与最终 commit」；`app/games/[slug]/page.tsx:58`「标记为「current」的归档」；web-play-client「MVP 阶段不展示…」；`app/admin/creators/[creatorId]/page.tsx:97`「简介写入 creators.extra_json.bio，不新增迁移」 |
| G | 「申请→管理员→站内信」流程在 4 处各解释一遍 | `app/page.tsx`、`app/me/page.tsx`×2、`app/upload/page.tsx` | grep `管理员` + `站内信` 共现 |
| H | admin 表单机器味枚举 hint（「每行一个：a\|b\|c\|d。X 可用 m / n / o」） | 9 条，集中在 2 个文件 | `app/admin/works/[workId]/page.tsx`（4 条）、`app/admin/releases/[releaseId]/page.tsx`（2 条）；另 register 与 reset-password 的验证码长文案逐字重复 |

附带发现：`app/components/site-footer.tsx:11` 反馈链接指向 `https://github.com/anthropics/claude-code/issues`（错误占位）；首页 hero 与「这是什么」区（`app/page.tsx:62-93`）是全站最像 AI 简介的段落；About 页是实现术语文案的「母本」。

### 1.2 CSS：三代样式叠加

`app/globals.css` 的实际结构（按文件内注释）：

1. L46–660：`body.theme-festival` 覆盖层（**63 处规则**）——写在文件**前**部。
2. L662–737：`body.theme-admin` 覆盖层（23 处规则）。
3. L845–2311：基础 reset + 中性浅色「基底代」样式（.card/.button/.field/.data-table 等）——写在文件**后**部。

即「覆盖在前、基底在后」，全靠选择器特异性生效。festival 主题靠群举选择器给基底组件刷漆（如 L246 `body.theme-festival .card, .creator-card, .game-card, ...`），**每新增一个组件就要在两处维护**。

Token 现状：`:root` 27 个变量，但**无字号/圆角/阴影/z-index token**，间距 token 仅 3 档且只被引用 13 次；硬编码颜色 126 个 hex + 62 个 `rgb()` ≈ 与 `var()` 引用一比一。死 token：`--vip-sky`、`--vip-sky-soft`、`--vip-focus`、`--vip-action`（定义了 0 引用）。admin 主题整套是无 token 裸 hex。设计稿要求的 `.festival-pane` 统一面板类**不存在**。

重复/死代码：同一选择器定义两次的有 `body`、`.data-table th`、`.field textarea`、`.inline-unread-dot`、`.upload-panel`、`.web-play-log-card`、`@media (max-width:760px)`（两块）；tsx 中 0 引用的死样式有 `.grid`、`.download-table`（及其 `td:last-child`）、`.session-panel`、`.download-section`、`.health-line`、admin 主题的 `.button.danger`；反向死类 `.empty-card` 被 6 个页面引用但 CSS 从未定义。等宽字体栈逐字复制 5 遍。

### 1.3 组件缺口与排版混乱

- `page-header`（eyebrow+h1+subtitle+actions）结构在 **38 个文件手写 39 遍**，actions 内容与按钮主次每页随手排：works 页「返回管理端」是 `button primary`，users 页是普通 button + 多一个「返回首页」，maintenance 页叫「返回控制台」。**把返回链接标成 primary 是主操作语义错误**（works、tags、creators、audit、works/[workId] 均如此）。
- 「站内信 + notification-badge」按钮片段在 admin 页头重复 8+ 次。
- 手写 `<table className="data-table">` 18 处，仅 ArchiveVersionTable 一处抽了组件；admin 标签/角色/系列列表都借用 `.admin-creators-table` 类名。
- 空状态 3 种写法（`.card empty-card` / 表格 `colSpan` 行 / `.muted-line`）；状态徽章映射函数 `statusBadgeClass` 6 份拷贝（另有 users 页内联三元与独立 `roleBadgeClass`），且 badge 用「approved/rejected/pending」审批词汇表达发布状态。
- 「面板」样式至少 8 套、「dt/dd 统计块」4 套、「圆角胶囊」7 套、网格 10+ 套、表格 min-width 修饰类 8 个。
- 区块间距靠相邻选择器补丁（`.page-header + .card, .card + .card {margin-top:16px}`）维持，新组合就漏。
- admin 首页的「内容管理」快捷导航与顶栏 ADMIN_LINKS 完全重复一遍入口。

### 1.4 可访问性 / 响应式硬伤

- 焦点态只在 festival 主题定义（黄色 outline），admin 主题无；`--vip-focus` 空置。
- **对比度不达标**：`.detail-list dt` 等 `--muted`（#667085）灰字压 festival 绿渐变底（游戏详情页 hero、play/upload 页多处）；admin 主题 `--muted` 压 `#11181f` 深底约 2.9:1。
- `.button` 基础态无 hover/focus；admin 页首屏主题闪变（见 §0.4）。
- 点击区偏小：`.chip-list a` 26px、`.site-nav a` 32px。
- 断点只有 760px 一个（另有一条只管 `.entry-grid` 的 761–960 规则）；`.library-toolbar` 写死 7 列 grid；公开详情页嵌套 980px 宽表格靠横滚，违反 ux-rebuild-brief「公共发现页不得只靠宽表格」。
- 仓库根目录散落 17 张 `*.png` 审计截图（`audit-*.png`、`baseline-*.png`、`screenshot-*.png`），未 gitignore。

---

## 2. 目标状态定义

### 2.1 文案宪法（重写全站文案时逐条对照）

> 语气基准：**一个懂行、话少的档案馆管理员**。陈述事实，不解释系统，不指导显而易见的操作。

1. **页面不解释自己。** subtitle 只在承载「用户不知道且此刻需要知道」的信息时存在，否则整行删除。判断法：把 subtitle 遮住，用户会不会因此受阻？不会 → 删。
2. **不复述界面已有信息。** 按钮/链接旁不写「点击 X 可以 Y」；有导航就不写「都在这里管理」。
3. **内部术语不出现在公共页面。** 术语对照表见 §2.2。管理端允许保留必要的领域名词（归档快照、发布版本），但禁止数据库/代码词（extra_json、current 标记、migration、MVP、preflight、core pack、commit、manifest、OPFS、SHA-256、D1/R2——最后两个仅 About 技术段与 admin/maintenance 可用）。
4. **空状态两句原则：** 第一句陈述状态（≤12 字），第二句给下一步动作（如有明确动作），没有就不写第二句。统一走 EmptyState 组件（Phase 3.3）。
5. **按钮/链接动词开头，2–6 字**：「下载 ZIP」「在线游玩」「提交申请」「返回列表」。禁止「点击这里」「前往 X 开始」。
6. **表单 hint 说格式，不说原理。** 格式说明用示例而不是枚举句：placeholder 写一行真实示例，hint 只补充示例覆盖不到的约束。禁止「X 写入 y 表 z 字段」式实现注释——那是代码注释，移回代码里。
7. **同一信息全站只解释一次**，放在它的「家」：上传权限流程只在 `/me` 完整解释，其他页面一句话 + 链接；技术架构只在 `/about`。
8. **不可用 ≠ 不解释，但解释 ≤ 一句**：「Maniacs Patch 作品暂不支持在线游玩，请下载 ZIP。」（删掉「MVP 阶段」这种排期词）。
9. **删除前做信息降级判断：** 该句是否含用户必需信息（权限门槛、不可逆警告、格式约束）？含 → 移到就近的字段级/操作级位置再删原句；不含 → 直接删。
10. **同类页面用同一句式**，且句式由共享组件承载（EmptyState、FormField），不允许再在 JSX 里手写第 N 个变体。

### 2.2 术语对照表（公共页面强制替换）

| 内部词 | 用户词 | 备注 |
|---|---|---|
| preflight | 上传前检查 | 上传页进度文案可用「检查中」 |
| core pack | （不出现） | 必要时说「引擎公共文件」 |
| commit / 最终 commit | 提交入库 / 完成入库 | |
| manifest | 文件清单 | |
| ArchiveVersion | 归档快照 | admin 表格列名可保留英文短码 |
| 标记为「current」 | 最新快照 | |
| Release | 发布版本 | |
| OPFS | 浏览器本地存储 | |
| SHA-256 / CRC32 | （不出现，统称「校验」） | 豁免：admin 表单的功能性字段名（如 works/[workId] 的「图标 blob SHA-256」输入框）保留原词——那是操作对象不是解说 |
| MVP 阶段 | （删除，改为「暂不支持」） | |
| extra_json / 表名.字段名 | （绝不出现） | 移回代码注释 |
| D1 / R2 | 数据库 / 对象存储 | 仅 About 技术段、admin/maintenance 保留原词 |

### 2.3 设计 token 目标（`app/styles/tokens.css` 的完整初稿）

原则：**primitives（原色）+ semantic（语义）两层**。组件只引用语义层；`.theme-festival` / `.theme-admin` 只重定义语义层 → 现有 63 条 festival 覆盖规则和 23 条 admin 覆盖规则绝大部分消失。

```css
:root {
  /* ===== primitives：festival 原色（来自 design brief） ===== */
  --vip-bg: #052367;
  --vip-sky: #2a78d4;
  --vip-text: #f0faff;
  --vip-warm: #ffebcd;
  --vip-yellow: #fffd87;
  --vip-border: #ebf7ff;
  --vip-ink: #1d1d1e;
  --vip-pane-gradient: linear-gradient(#507d5f, #3f6c4e, #2c593b, #1a4729, #073416);
  --vip-pane-deep: linear-gradient(#1a4729, #073416);
  --vip-focus: #38bdf8;
  --vip-danger: #ef4444;
  --vip-action: #f97316;
  /* primitives：admin 控制台原色（把现有裸 hex 收编） */
  --console-bg: #0c1722;
  --console-surface: #11181f;
  --console-border: #2d3a4a;
  --console-text: #e2e8f0;
  --console-muted: #a7b4c4;   /* 原 #94a3b8 提亮，保证 4.5:1 */
  --console-accent: #f0b429;

  /* ===== 尺度（全站唯一来源） ===== */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px;
  --radius-sm: 4px; --radius-md: 8px; --radius-pill: 999px;
  --text-xs: 12px; --text-sm: 13px; --text-base: 15px;
  --text-lg: 18px; --text-xl: 24px; --text-2xl: clamp(26px, 4vw, 34px);
  --shadow-pane: 3px 3px 0 rgb(0 0 0 / 45%);
  --shadow-pop: 4px 4px 0 var(--vip-ink);
  --font-body: Arial, "Microsoft YaHei", "PingFang SC", sans-serif;
  --font-mono: "Cascadia Mono", Consolas, "Liberation Mono", monospace;
  --font-display: var(--font-body); /* Phase 4.11 可换像素字体 */
  --container-max: 1120px; --container-pad: 16px;

  /* ===== semantic：默认 = festival（公共页是默认形态） ===== */
  --page-bg: var(--vip-bg);
  --surface: var(--vip-pane-gradient);      /* 面板 */
  --surface-solid: #2c593b;                 /* 不能用渐变的地方（如 sticky 头） */
  --surface-deep: var(--vip-pane-deep);     /* 强调/危险区底 */
  --surface-border: rgb(235 247 255 / 50%);
  --text: var(--vip-text);
  --text-muted: #c9dccf;                    /* 绿底上可读的灰绿，替代 #667085 */
  --heading: var(--vip-warm);
  --heading-strong: var(--vip-yellow);
  --link: var(--vip-yellow);
  --focus-ring: var(--vip-focus);
  --btn-bg: rgb(255 255 255 / 14%);
  --btn-text: var(--vip-text);
  --btn-primary-bg: var(--vip-yellow);
  --btn-primary-text: #1d1300;
  --danger: var(--vip-danger);
  --ok: #4ade80; --warn: var(--vip-action);
}

body.theme-admin {
  --page-bg: var(--console-bg);
  --surface: var(--console-surface);
  --surface-solid: var(--console-surface);
  --surface-deep: #0a1017;
  --surface-border: var(--console-border);
  --text: var(--console-text);
  --text-muted: var(--console-muted);
  --heading: var(--console-text);
  --heading-strong: var(--console-accent);
  --link: var(--console-accent);
  --focus-ring: var(--vip-focus);
  --btn-bg: #1f2a36;
  --btn-text: var(--console-text);
  --btn-primary-bg: var(--console-accent);
  --btn-primary-text: #1d1300;
}
```

断点约定（CSS 变量进不了 media query，写成注释纪律）：`480px`（窄手机）、`760px`（手机/平板分界，沿用现状）、`960px`（平板/桌面分界）。禁止发明第四个断点。

### 2.4 样式文件目标结构

`app/globals.css` 拆为（在 `app/layout.tsx` 按此顺序 import）：

```text
app/styles/tokens.css      ← §2.3 全文
app/styles/base.css        ← reset、body、排版、:focus-visible、a、code
app/styles/layout.css      ← main 容器、site-header/footer/nav、page-header、festival-zone
app/styles/components.css  ← pane/button/field/badge/chip/data-table/empty-state/stat-list/toolbar
app/styles/pages.css       ← 真正页面独有的样式（home hero、upload、web-play、admin 专属）
```

拆完后 `app/globals.css` 删除。验收指标：五个文件合计行数 ≤ 1600（现 2311）；`#`hex 出现次数 ≤ 40 且全部位于 tokens.css；`body.theme-festival` 选择器 ≤ 5 条、`body.theme-admin` ≤ 10 条（只允许语义 token 覆盖不了的极少数结构差异）。

### 2.5 共享组件目标清单（全部放 `app/components/ui/`）

| 组件 | Props 签名（TypeScript） | 消灭的旧写法 |
|---|---|---|
| `PageHeader` | `{ eyebrow?: string; title: ReactNode; subtitle?: string; actions?: ReactNode }` | 38 处手写 `header.page-header` |
| `Pane` | `{ tone?: "default" \| "deep" \| "danger"; heading?: ReactNode; headingAction?: ReactNode; children }`，渲染 `section.pane` | `.card`/`.notice-pane`/`.release-block`/`.lookup-panel` 等 8 套面板 |
| `EmptyState` | `{ title: string; action?: { href: string; label: string } }` | 3 种空状态写法 + 未定义的 `.empty-card` |
| `StatusBadge` | `{ kind: "release" \| "task" \| "role" \| "approval"; value: string }`，内部查 `lib/labels.ts` | 3 份 `statusBadgeClass` 拷贝、语义错用 |
| `StatList` | `{ items: { label: string; value: ReactNode }[] }`，渲染 dl/dt/dd | 4 套 dt/dd 统计块样式 |
| `FormField` | `{ label: string; hint?: string; error?: string; children }` | `label.field` 的 3+ 种变体、upload 页私有 TextField |
| `TableWrap` | `{ minWidth?: number; children }`，渲染 `.table-wrap > table.data-table` 结构约定 | 8 个只设 min-width 的表格修饰类 |
| `InboxLink` | `{ unread: number; variant?: "button" \| "nav" }` | admin 页头重复 8+ 次的站内信按钮片段 |
| `BackLink` | `{ href: string; label: string }`，永远是普通链接样式、带 `←` | 各页乱标 primary 的「返回 XX」按钮 |
| `ChipList` | `{ items: { href?: string; label: string }[] }` | `.chip-list` 手写变体 |

配套：`lib/labels.ts`（纯函数，无 server 依赖）收编 `engineLabel`×4、`releaseTypeLabel`×2、`baseVariantLabel`×2、`creatorRoleLabel`×3、`namespaceLabel`×3，以及 `statusLabel`×12 / `statusBadgeClass`×6——后两者跨 6 个枚举域，**必须按域拆分导出而非合并**（详见 Phase 1.1），外加 register/reset 共用的验证码提示文案常量。

### 2.6 视觉方向摘要（Phase 4 的审美基准）

细节以 `docs/ui-viprpg-festival-design-brief.md` 为准，这里只列本计划新增的落地决策：

- 公共页 = 「祭典公告板」：深蓝页底 + 绿渐变 `pane` + 奶黄标题 + 硬阴影；**所有**公共页面板统一用 `Pane`，不再有浅色块混入（现状 `.lookup-panel`、`.segmented-control` 是浅色漏网）。
- 管理端 = 「主题化控制台」：深海军蓝 + 金色强调，密表格、窄间距；**不做**绿渐变，与公共页靠 token 区分而非两套 CSS。
- 圆角统一 `--radius-md`（面板）/`--radius-sm`（控件）/`--radius-pill`（徽章）；阴影只允许 `--shadow-pane`、`--shadow-pop` 两种。
- 图标暂沿用 emoji 方案但收敛使用位置（入口卡、导航），不引入 icon 库。
- 像素感来源：标题字（可选 Phase 4.11）、硬阴影、pane 亮边，**不是**把正文改等宽。

---

## 3. 分阶段执行计划

### Phase 0 —— 止血与地基（半天，零风险）

- [x] **0.1 建立基线截图。** `npm run dev`，用 Playwright/Chrome DevTools 按 §6.1 矩阵截图，存到 `docs/audit/2026-07-baseline/`（新建目录）。此后每个 Phase 结束对照。
- [x] **0.2 清理仓库根截图垃圾。** 把根目录 `audit-*.png`、`baseline-*.png`、`screenshot-*.png`（共 16 张）删除或移入 `docs/audit/`；在 `.gitignore` 追加根目录截图模式（如 `/screenshot-*.png`、`/audit-*.png`、`/baseline-*.png`）。DoD：`git status` 根目录无散落 png。
- [x] **0.3 修页脚反馈链接。** `app/components/site-footer.tsx` 中 `https://github.com/anthropics/claude-code/issues` 改为本仓库 issues 地址（`https://github.com/<owner>/VIPRPG-ZH-Archive/issues`，owner 以 `git remote -v` 为准）。同文件第二行口号「RPG Maker 2000/2003 去重归档系统 · 致敬 VIPRPG 祭典文化」改为「VIPRPG 中文归档 · RPG Maker 2000/2003」或直接删除第二个 `<p>`。
- [x] **0.4 修主题闪变。** 在 `app/layout.tsx` 的 `<body>` 开头插入阻塞式内联脚本：`<script dangerouslySetInnerHTML={{ __html: "document.body.className=location.pathname.startsWith('/admin')?'theme-admin':'theme-festival'" }} />`，body 的默认 className 保留 `theme-festival`（作为无 JS 兜底），**并给 `<body>` 加 `suppressHydrationWarning`**——React 19 对 hydration 属性不匹配处理严格，不加会在控制台报错甚至把 className 改回去使修复失效（此属性只作用于 body 自身的属性比对，是 next-themes 同款标准做法）；`theme-body-class.tsx` 保留用于客户端路由切换。DoD：直接刷新 `/admin` 无浅绿→深蓝闪变，且控制台无 hydration 警告。
- [x] **0.5 Phase 验证**：`npm run check` 通过；`/`、`/admin` 两页截图与基线一致（除页脚文字）。

### Phase 1 —— 文案重构（1–2 天，不改样式与布局结构）

> 本 Phase 只动字符串和重复的 label 函数，不动 className、不动 CSS。这是最快让站点「拿得出手」的一步。

- [x] **1.1 建 `lib/labels.ts`。** 新建文件，收编重复的展示映射函数。**两类处理方式，不可混淆：**
  - **同域重复 → 合并为单一导出**：`engineLabel`×4（四份逐字一致，直接合并）、`creatorRoleLabel`×3、`namespaceLabel`×3、`releaseTypeLabel`×2、`baseVariantLabel`×2。所有调用点改 import，删除本地拷贝。
  - **同名异域 → 按域拆分导出，禁止合并**：名为 `statusLabel` 的函数有 **12 份、横跨 6 个互不兼容的枚举域**（同键不同义：`deleted` 在不同域分别译为「已删除」「回收站」「未安装」）。拆为六个导出：`workStatusLabel`（内容发布状态 published/hidden/draft/deleted，7 份拷贝，deleted 分支有无不一，取含 deleted 的版本）、`archiveStatusLabel`（归档快照，含 `purgedAt` 参数，源自 archive-version-table.tsx）、`inboxStatusLabel`（站内信审批，inbox/page.tsx）、`importTaskStatusLabel`（导入任务，upload/tasks/page.tsx）、`uploadTaskStatusLabel`（浏览器上传任务，upload-task-provider.tsx）、`installStatusLabel`（在线游玩安装，web-play-client.tsx）。`statusBadgeClass` 同理有 **6 份**（archive-version-table、inbox、admin/works、admin/works/[workId]、admin/releases/[releaseId]、admin/series）+ users 页一处内联三元 + 独立的 `roleBadgeClass`，一并按域收编。
  - 角色文案注意：`roleLabel` 现存于 `lib/server/auth/roles.ts`（红线不改）。labels.ts 里如需角色展示映射，自建展示层副本并加注释「须与 lib/server/auth/roles.ts 的 roleLabel 保持一致」。
  - 同时迁入 register/reset 重复的验证码提示为常量 `VERIFICATION_EMAIL_HINT`。
  - DoD：`grep -rn "function engineLabel\|function releaseTypeLabel\|function statusLabel\|function baseVariantLabel\|function creatorRoleLabel\|function namespaceLabel\|function statusBadgeClass" app` 结果为 0；`npm run check` 通过。
- [x] **1.2 逐模式清洗（按 §1.1 的 A–H 顺序，重写规则与示例见附录 B）：**
  - [x] 1.2-A 全站 subtitle 过审：按附录 A 的逐页处置表执行（删 / 改 / 保三种处置，附录已逐页给出）。
  - [x] 1.2-B 清除全部「这里维护/都在这里/会显示在这里/这里只显示」类句式。**grep 口径：裸词「这里」全站搜索（约 14 行命中），逐行人工分流**——属于模式 C（暂不在这里修改）的留给 1.2-C 处理，其余凡是向用户解释「本页/本区是干嘛的」的句子全部删除或压缩。不要只搜「这里维护」等固定短语，变体（「都会在这里显示」「会显示在这里」）会漏网。
  - [x] 1.2-C 六个编辑页的「slug 暂不修改」句：从 subtitle 删除，将该信息降级为对应只读字段旁的一行 hint（如果页面上没有展示该字段，则在表单顶部保留一行，措辞统一为「原名与 slug 不可修改」）。
  - [x] 1.2-D 空状态统一措辞（本 Phase 先统一文字，Phase 3.3 再换组件）：列表页空态一律「没有找到匹配的{作品/作者/角色/标签/系列}。」，删除「调整关键词后再试」；「暂无简介。」统一改为不渲染该行（无简介就不显示占位文案，除非布局需要，需要时用「—」）。
  - [x] 1.2-E 「N 个 X 符合当前条件」→「共 N 个{作品/…}」（grep `符合当前条件`）。
  - [x] 1.2-F 按 §2.2 术语对照表全站替换（逐词 grep：`preflight`、`core pack`、`commit`、`manifest`、`current`、`OPFS`、`SHA-256`、`MVP`、`extra_json`；注意只改**中文 UI 字符串内**的出现，不改代码标识符）。web-play worker 的用户可见日志（`web-play-install-worker.ts` 中的中文串）改为用户语言或降为一句「正在安装游戏文件…」+ 详情折叠。
  - [x] 1.2-G 权限流程解释收敛：`/me` 保留完整版（两句以内），`app/page.tsx`、`app/upload/page.tsx` 各改为一句 + 链接（示例见附录 B-G）。
  - [x] 1.2-H admin 枚举 hint 重写：每条按「placeholder 放一行真实示例 + hint 只写示例外约束」改写（示例见附录 B-H）；删除 hint 中所有数据库解说句。
- [x] **1.3 重点文件复查。** 对文案最重的 5 个文件做整文件通读复查（不只 grep）：`app/page.tsx`、`app/about/page.tsx`、`app/me/page.tsx`、`app/upload/upload-client.tsx`、`app/admin/maintenance/page.tsx`。对照 §2.1 十条逐条过。About 页技术段保留但按对照表换词，宣言体（「目标是建立一个…」）改为事实句。
- [x] **1.4 Phase 验证**：`npm run check`；grep 验收——`调整关键词`/`符合当前条件`/`都在这里`/`暂不在这里修改`/`MVP`/`extra_json` 全站命中 0（限 UI 字符串）；抽查 6 个页面截图确认无因删句导致的布局塌陷；调用 `ux-flow-reviewer` 复核信息没有丢失（重点：权限门槛、危险操作警告仍可见）。

### Phase 2 —— CSS 令牌化与拆分（1–2 天，目标「视觉基本不变，结构彻底换血」）

- [x] **2.1 建 `app/styles/tokens.css`**，内容 = §2.3 初稿全文。`app/layout.tsx` 在现有 `globals.css` **之前** import 它（此时新旧共存，旧 :root 会覆盖同名变量，无视觉变化）。
- [x] **2.2 建其余四个空文件**（base/layout/components/pages.css）并按 §2.4 顺序 import。
- [x] **2.3 机械搬运。** 把 globals.css 的规则按桶搬家：reset/body/排版 → base.css；`site-*`、`page-header`、`festival-zone`、main 容器、页脚 → layout.css；`.card .button .field .badge .chip-list .data-table .status-pill .table-wrap` 等通用类 → components.css；`festival-hero`、`entry-*`、`upload-*`、`web-play-*`、`me-*`、`admin-*`、`library-*` → pages.css。搬运时**顺手完成**：(a) 附录 C 死代码不搬（等于删除）；(b) 重复选择器合并为一份；(c) 等宽字体栈 5 处替换为 `var(--font-mono)`。搬空后删除 `app/globals.css`。DoD：`npm run check`；全站截图与 Phase 1 结束时肉眼无差异。
- [x] **2.4 语义 token 替换（本 Phase 核心）。** 在 components/base/layout 三个文件里，把颜色相关声明替换为 §2.3 语义变量（映射表见附录 D）。然后**逐条消解** `body.theme-festival` / `body.theme-admin` 覆盖规则：若该规则只是改颜色/边框/阴影 → 语义 token 已覆盖，整条删除；若是结构差异（display/padding 不同）→ 保留并搬到对应文件末尾的「theme structural overrides」区。DoD：达到 §2.4 的验收指标（hex ≤ 40 且全在 tokens.css、festival 覆盖 ≤ 5 条、admin ≤ 10 条）。
- [x] **2.5 尺度 token 替换。** `font-size` 字面量 → `--text-*`（11 种值就近归入 6 档）；`margin-top: 16/24px` 等 → `--space-4/5`；`border-radius: 6/8/10/12px` → `--radius-sm/md`（10/12 归入 md）；8 种阴影 → 两种 token。允许 ±2px 的视觉漂移。
- [x] **2.6 补基础交互态。** 在 components.css 为 `.button`、`a`、`.chip-list a` 写基础 `:hover`（亮度提升）与全局 `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }`（两主题共用，删除 festival 专属焦点规则）。对比度修复随 2.4 的 `--text-muted` 换色自动完成，用 DevTools 抽查 4 处曾不达标位置（游戏详情 dt、play 状态行、upload 路径行、admin metric 副文字）≥ 4.5:1。
- [x] **2.7 区块间距去补丁。** 删除 `.page-header + .card` 式相邻选择器补丁，改为 `main > * + * { margin-top: var(--space-5); }`（layout.css），个别需要紧凑的地方用局部类覆盖。注意两点：(a) `.festival-zone { margin-top: 28px }` 特异性高于新规则，必须一并删除，否则首页 zone 间距不会被 token 接管；(b) 旧补丁是 16px、新 token 是 24px，admin 列表页会整体变松——**属预期**，admin 密度在 4.10 统一收紧。已核实全部 39 个 `<main>` 的直接子元素均为 header/section/布局 div，无 fixed/hidden 元素受此规则误伤（upload-dock 渲染在 main 之外）。
- [x] **2.8 Phase 验证**：§6.1 全矩阵截图对比基线，允许差异：间距微调、对比度提升、焦点态出现；不允许：布局塌陷、颜色主题错乱。`festival-ui-reviewer` 复核。

### Phase 3 —— 共享组件抽取（1–2 天，纯等价替换，不改视觉）

> 每个组件一步：建组件 → grep 全部旧写法 → 逐文件替换 → 删旧 CSS 变体。顺序从机械到需判断。

- [x] **3.1 `BackLink` + `InboxLink`**（先建这两个，3.2 的 PageHeader 替换要用）。BackLink 永远普通样式（消灭「返回按钮标 primary」错误——这是语义修复，视觉允许变化）；InboxLink 内部含未读徽章逻辑。DoD：组件存在且 `npm run check` 通过（调用点在 3.2 一并替换）。
- [x] **3.2 `PageHeader`**。替换 39 处手写 header。替换时同步执行两条纪律：actions 里「返回 XX」一律换成 `BackLink` 且排最前；「站内信」按钮换成 `InboxLink`。DoD：`grep -rln '"page-header"' app --include=*.tsx` 只剩组件自身；grep `notification-badge` 的 tsx 命中只剩 InboxLink 组件。
- [x] **3.3 `EmptyState`**。替换 6 处 `card empty-card`、inbox 的 colSpan 空行、admin 的 muted-line 空态；在 components.css 定义 `.empty-state`（此前 `.empty-card` 从未被定义过，顺带解决）。
- [x] **3.4 `StatusBadge` + labels 联动**。三份 statusBadgeClass 拷贝并入 `lib/labels.ts` 的单一映射；badge 样式类按语义重命名（发布状态不再借用 approved/rejected）。play 页 `.status-pill` 判断是否与 badge 合并：若视觉可统一则并入 StatusBadge 的一个 variant，不能则保留但写明理由。
- [x] **3.5 `Pane` + `SectionHeading`**。公共页 8 套面板类收敛到 `.pane`（tone 变体）；festival 群举刷漆选择器（`body.theme-festival .card, .creator-card, ...`）随之删除。admin 的 card 也走 Pane（靠 token 呈现深色）。
- [x] **3.6 `StatList`**。替换 4 套 dt/dd 统计块。
- [x] **3.7 `FormField`**。替换公共表单 `label.field` 变体与 upload 私有 TextField；admin 编辑页表单行统一。hint/error 渲染位置固定（label 下、控件上 hint；控件下 error）。
- [x] **3.8 `TableWrap` + 表格类收敛**。8 个 min-width 修饰类改为 `TableWrap` 的 `minWidth` prop；「admin 标签页借用 .admin-creators-table」这类错借随之消失。
- [x] **3.9 `ChipList`**。
- [x] **3.10 Phase 验证**：`npm run check`；grep 验收每个组件对应旧类名/旧片段归零；§6.1 矩阵截图，视觉应与 Phase 2 结束时基本一致；`git diff --stat` 确认 CSS 净减少。

### Phase 4 —— 逐页视觉与结构重构（3–5 天，真正的「变好看」阶段）

> 每个 slice 独立可交付。**凡移动了入口/操作的 slice，先在本文档该步骤下写功能保全表再动手**（格式：现有能力 | 现位置 | 新位置 | 验证方式）。每个 slice 完成即跑 §0.3 页面级验证。

- [x] **4.1 公共壳。** site-header：品牌区加 festival 感（标题字用 `--heading-strong` + 硬阴影；`.site-brand-mark` 的字母 V 方块可保留）；导航当前位置高亮（`aria-current` + 样式）；移动端导航横滑加渐隐遮罩暗示。site-footer 排版对齐 pane 风格。
- [x] **4.2 首页。** 现有骨架（hero → 简介 → 浏览板 → 参与贡献 → 最近更新）保留，做三处修正：(a) hero 与 zone 间距统一到 `--space-6`；(b) 「参与贡献」未登录时 2 张卡被 auto-fit 拉宽 → 给 `contribute-grid` 设 `max-width` 或固定 `minmax(240px, 320px)`；(c) 简介 pane 文案已在 Phase 1 压缩，此处校验视觉密度。
- [x] **4.3 游戏列表页。** `.library-toolbar` 从写死 7 列 grid 改为 flex-wrap 流式布局（搜索框占满剩余宽度，筛选控件自然换行），移动端自动堆叠；结果计数行并入工具条尾部；卡片网格间距/圆角对齐 token。**不做分页功能**（记入 §7 遗留项）。
- [x] **4.4 游戏详情页（全站最重要页面）。** 现状 7 段无层次堆叠 + 980px 嵌套表格。目标结构：
  1. PageHeader（标题 + 状态徽章）；
  2. hero 区两列：封面/预览 | StatList 关键信息 + WorkActionBar（下载/在线游玩为唯一 primary）；
  3. 「发布版本」区：每个 release 一个 Pane，**桌面保留表格，≤760px 切换为版本卡片列表**（每行快照 = 一张小卡：版本名/大小/日期/下载/游玩按钮），消灭公共页横滚表格；
  4. 制作人员/角色/标签/系列 合并为一个「资料」Pane 内的分组，替代现在的 4 张散卡；
  5. 空归档 fallback 复用 WorkActionBar 组件（删除 :56-61 的手写第二份）。
  功能保全表必填（下载/游玩/每个快照的操作一条不少）。

  | 现有能力 | 现位置 | 新位置 | 验证方式 |
  |---|---|---|---|
  | 返回作品资料库 | PageHeader actions | PageHeader actions 首位 | 详情页点击后到 `/games` |
  | 当前推荐归档下载 | hero 上方 WorkActionBar | hero 信息列唯一 primary | 请求命中对应 archive download API |
  | 当前推荐归档在线游玩 | hero 上方 WorkActionBar | hero 信息列次操作 | 跳转 `/play/[archiveId]` |
  | 复制作品 ID | hero 上方 WorkActionBar | hero 信息列次操作 | 点击后按钮反馈“已复制” |
  | 发布来源 | release Pane 标题右侧 | release Pane 标题右侧 | 新标签打开原来源 URL |
  | 每个归档快照下载 | release 桌面表格操作列 | 桌面表格 / 移动快照卡操作区 | 每个 archive ID 均命中 download API |
  | 每个可游玩快照在线游玩 | release 桌面表格操作列 | 桌面表格 / 移动快照卡操作区 | `canPlay` 条目均有 `/play/[id]` |
  | 制作人员、角色、标签、系列、外链、相关作品跳转 | 6 个散置区块 | 资料 Pane 分组 | 逐组点击首项到对应详情/外链 |
- [x] **4.5 目录页四件套（creators/characters/tags/series 及其详情）。** 统一「索引板」模板：PageHeader + 搜索条 + 卡片网格（复用同一卡片样式，只是字段不同）+ EmptyState。详情页 = PageHeader + StatList + 作品列表。这 8 个页面改完应该像一个系列。
- [x] **4.6 账号页（/me、/inbox、login/register/forgot/reset）。** 认证四页：单列窄 Pane（max-width ~420px）居中，按 brief「认证页不过度装饰」。/me 重排为三张 Pane：账号状态（含权限流程唯一完整解释）/ 站内信入口 / 最近任务。/inbox 表格移动端降级为消息卡片列表。

  | 现有能力 | 现位置 | 新位置 | 验证方式 |
  |---|---|---|---|
  | 登录、注册、找回、重置提交 | 各认证页 Pane | 居中窄 Pane 原表单内 | 各表单 action/method 与字段不变 |
  | 退出登录 | `/me` 账户 Pane | 账号状态 Pane | 提交后回到未登录态 |
  | 申请/撤回上传权限 | `/me` 权限 Pane | 账号状态 Pane 的权限区 | 两种角色分别检查可见按钮与 action |
  | 上传、任务、控制台、审计入口 | `/me` 多张 Pane | 账号状态 / 最近任务 Pane | 对应角色逐一点击可达 |
  | 全部标记已读、用户层级 | `/inbox` PageHeader actions | PageHeader actions | action 与角色可见性不变 |
  | 单条批准、拒绝、标记已读 | `/inbox` 表格操作列 | 桌面表格 / 移动消息卡操作区 | 同一 item ID 的三个 form action 不变 |
- [x] **4.7 上传工作区（/upload、/upload/tasks、upload-client、任务 dock）。** 不改流程逻辑，只做视觉与分组：upload-client 按现有阶段分组为带 SectionHeading 的 Pane 序列；进度/错误状态用 StatusBadge 统一；dock 样式对齐 token。1203 行的 upload-client.tsx 若替换组件时自然缩短则好，**不强行拆文件**（记入 §7 可选项）。

  | 现有能力 | 现位置 | 新位置 | 验证方式 |
  |---|---|---|---|
  | 文件夹/ZIP 模式、源文件选择 | 游戏文件 Pane | 左侧源文件 Pane | 切换模式后 input 类型与已选统计更新 |
  | 恢复本地任务、套用已有作品/发布 | 源 Pane / 查找结果 | 原分组内 | 选择后表单字段回填 |
  | 三阶段元数据编辑与开始导入 | 右侧三个 Pane | 同顺序 Pane 序列 | 所有 name/value 与 submit handler 不变 |
  | 查看导入任务、开始新上传 | PageHeader actions | PageHeader actions | `/upload` 与 `/upload/tasks` 双向可达 |
  | dock 展开/关闭、继续上传、暂停、恢复、取消、清除 | 右下 dock | token 化 dock 原位置 | 每种任务状态对应按钮与 handler 不变 |
- [x] **4.8 在线游玩页。** 按 brief「模拟器区域主导」：游玩画布优先占宽，控制/日志收进侧栏或折叠区；日志文案已在 Phase 1 清洗；状态行用 StatusBadge。

  | 现有能力 | 现位置 | 新位置 | 验证方式 |
  |---|---|---|---|
  | 返回首页、下载 ZIP | PageHeader actions | PageHeader actions | 链接目标与 download API 不变 |
  | 安装、取消、重试、更新本地内容 | 左侧安装 Pane | 控制侧栏 | 各安装状态逐一检查按钮与 handler |
  | 启动、全屏、删除本地内容 | 左侧安装 Pane | 控制侧栏 | 已安装状态三个操作均可见 |
  | 游戏画布与运行状态 | 右侧 player Pane | 主内容第一视觉区域 | iframe/canvas 容器与启动结果可见 |
  | 清空日志 | 底部日志 Pane | 侧栏折叠日志区 | 点击后日志数组清空 |
- [x] **4.9 admin 壳与仪表盘。** (a) 删除 admin 首页与顶栏重复的「内容管理」快捷导航区，改为：顶栏 ADMIN_LINKS 是唯一模块导航，admin 首页只留 指标 metric-grid + 待办 + 近期导入（功能保全表必填：确认每个模块入口在顶栏仍可达）；(b) metric-grid 3+3+3+1 孤儿行 → `repeat(auto-fill, minmax(180px, 1fr))`；(c) 各 admin 页 PageHeader 的 actions 收敛为：BackLink + InboxLink + 该页专属操作（≤1 个）。

  | 现有能力 | 现位置 | 新位置 | 验证方式 |
  |---|---|---|---|
  | 仪表盘 | admin 顶栏 + 首页快捷区 | admin 顶栏 | `/admin` 可达且 aria-current 正确 |
  | 作品、归档、作者、角色、标签、系列、用户、维护 | admin 顶栏 + 首页快捷区 | admin 顶栏唯一入口 | 8 个链接逐一点击并核对 pathname |
  | 审计 | 超级管理员顶栏 + 首页快捷区 | 超级管理员顶栏唯一入口 | super-admin 可达 `/admin/audit` |
  | 站内信与返回站点 | admin 顶栏 / 各 PageHeader | 顶栏保留，PageHeader 只保留上下文动作 | 两入口均可达且无重复专属按钮 |
  | 待办中的维护、审计入口 | 仪表盘待办 Pane | 待办 Pane 保留 | 点击分别到维护、审计 |
- [x] **4.10 admin 列表与编辑页。** 列表页：表头 sticky、行 hover、`.data-table th/td` padding 收紧为 admin 密度（`--space-2 --space-3`）；users 页操作列两个 form 竖排改横排小控件。编辑页（works/[workId] 为样板）：表单按「基础信息 / 关联数据 / 危险操作」分 Pane，枚举输入的格式说明用 `FormField` hint 呈现（Phase 1.2-H 已改好文案）；危险操作永远在最后一个 `tone="danger"` 的 Pane。改完 works/[workId] 后把同模式应用到其余 5 个编辑页。
- [x] **4.11（可选）像素显示字体。** 未获得维护者明确确认，本轮按约束跳过下载与引入。若维护者愿意：下载 [缝合怪像素字体 Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)（OFL 许可，含中文）到 `public/fonts/` 或 `app/fonts/`，用 `next/font/local` 挂到 `--font-display`，只用于 h1/h2/品牌区。**先向维护者确认再做**；不做则跳过，硬阴影 + 亮边已提供像素感。
- [x] **4.12 Phase 验证**：§6.1 全矩阵；`festival-ui-reviewer` + `ux-flow-reviewer` 双复核；对照两份 brief 的 Acceptance Checklist 逐条打勾。

### Phase 5 —— 响应式与可访问性专项（1 天）

- [x] **5.1 平板断点补齐。** 在 761–960px 区间：`.game-card-grid`/`.creator-card-grid` 降为 2 列；`me-grid`/`work-hero`/`upload-layout`/`web-play-layout` 双列布局在此区间评估是否提前塌为单列。
- [x] **5.2 窄手机检查（390 与 480 以下）。** festival-hero padding 随屏缩（clamp）；`.data-table th/td` 在 ≤760 收紧 padding；确认 Phase 4.4 的移动端版本卡片生效。
- [x] **5.3 点击区。** `.chip-list a`、`.site-nav a`、`.lookup-row button` 等 min-height 提到 ≥ 40px（通过 padding，不破布局）。
- [x] **5.4 键盘走查。** 每类页面（首页/列表/详情/表单/admin 表格）纯 Tab 走一遍：焦点顺序符合任务顺序、焦点环可见、无焦点陷阱；`.web-player-frame canvas` 保持现状但给外层容器加可见焦点样式。
- [x] **5.5 对比度终审。** DevTools 逐主题抽查正文/muted/链接/徽章底色组合 ≥ 4.5:1（大标题 ≥ 3:1），不达标改 token 值而不是加特例。
- [x] **5.6 Phase 验证**：三视口（390/820/1440）× 代表页面截图，无横滚、无重叠。

### Phase 6 —— 终验与收尾（半天）

- [x] **6.1 全量验收**：§6.1 完整矩阵截图存 `docs/audit/2026-07-after/`；与 baseline 并排对比。
- [x] **6.2 清单核销**：两份 brief 的 Acceptance Checklist、§2.1 文案宪法抽查 10 页、§2.4 CSS 指标复测、本文档所有 checkbox。
- [x] **6.3 文档更新**：若组件库/样式结构与 `docs/claude-code-ui-workflow.md`、CLAUDE.md 描述不符，更新之；本计划文档标记「已完成」并把 §7 遗留项转为 issue 或 docs 待办。
- [x] **6.4 最终 `npm run check` + `npm run build` 通过。**

---

## 4. 工作量与里程碑概览

| Phase | 内容 | 预估 | 交付判定 |
|---|---|---|---|
| 0 | 止血与地基 | 0.5 天 | 基线截图在案、闪变消失、页脚正确 |
| 1 | 文案重构 | 1–2 天 | grep 验收全 0、labels.ts 收编完成 |
| 2 | CSS 令牌化拆分 | 1–2 天 | hex≤40、覆盖层≤15 条、文件拆分完成 |
| 3 | 组件抽取 | 1–2 天 | 10 个组件落地、旧写法 grep 归零 |
| 4 | 逐页重构 | 3–5 天 | 12 个 slice 各自过页面级验证 |
| 5 | 响应式/可访问性 | 1 天 | 三视口无横滚、对比度达标 |
| 6 | 终验 | 0.5 天 | 全部 checkbox 勾完 |

Phase 1 结束即可见「文案不再丢人」；Phase 4.4 结束即核心页面「拿得出手」；如需分批发布，1 / 2+3 / 4 / 5+6 是四个安全的合并点。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| Phase 2 搬运 CSS 时行为悄变（特异性顺序变化） | 搬运与改写分开提交（2.3 纯搬运 → 截图对比 → 2.4 才改写）；出问题 revert 单个 commit |
| Phase 3 组件替换漏语义（某页 header 有特殊结构塞不进 PageHeader） | 组件 props 里 `actions/title` 均为 ReactNode 留弹性；确实塞不进的记 §7，不硬塞 |
| 文案删除弄丢关键信息（权限/危险警告） | §2.1 第 9 条降级判断 + Phase 1.4 的 ux-flow-reviewer 复核 |
| 详情页表格→移动卡片化引入功能回归 | 4.4 功能保全表逐快照操作核对；桌面表格保留不动 |
| 工作区已有未提交改动被误回滚 | 开工前 `git stash list` / `git status` 存档现状；只提交本计划触碰的文件 |

---

## 6. 验证附件

### 6.1 截图矩阵（每 Phase 结束执行）

视口：`1440x900`、`390x844`（Phase 5 加 `820x1180`）。页面（12 个代表页覆盖所有模板）：

`/`、`/games`、`/games/[某个有归档的 slug]`、`/creators`、`/tags/[某 slug]`、`/login`、`/me`、`/inbox`、`/upload`、`/play/[某 id]`（可用状态即可）、`/admin`、`/admin/works/[某 id]`。

每张截图检查：横滚、重叠溢出、对比度、主操作可见性、空态/徽章渲染、控制台错误。

### 6.2 grep 验收速查

```bash
# ===== Phase 1 术语验收 =====
# 裸 grep 永远不为 0（current×278、manifest×134、commit×47 等是代码标识符），
# 正确口径：术语与中文字符同行。真实待改基数（2026-07-06 实测）：
#   preflight 5 | core pack 8 | commit 5 | manifest 4 | current 10
#   OPFS 5 | SHA-256 7（部分豁免，见 §2.2）| MVP 1 | extra_json 1
grep -rn "preflight\|core pack\|manifest\|OPFS\|extra_json\|MVP" app --include=*.tsx --include=*.ts | grep "[一-龥]"
# commit / current 中文同行仍有少量合法巧合（如注释），逐条人工判断：
grep -rn "commit\|current" app --include=*.tsx --include=*.ts | grep "[一-龥]"
# 句式验收（应为 0）：
grep -rn "调整关键词\|符合当前条件\|暂不在这里修改" app --include=*.tsx
grep -rn "这里" app --include=*.tsx        # 人工分流，解说句应清零

# ===== Phase 2 后 =====
grep -o "#[0-9a-fA-F]\{3,6\}" app/styles/*.css | wc -l   # ≤ 40，且全部位于 tokens.css
grep -c "body.theme-festival" app/styles/*.css            # ≤ 5
grep -c "body.theme-admin" app/styles/*.css               # ≤ 10

# ===== Phase 3 后 =====
grep -rln '"page-header"' app --include=*.tsx     # 仅 ui/page-header.tsx
grep -rn "empty-card" app                          # 0
```

---

## 7. 执行中发现的问题（执行者追加，不当场修）

- （预置）游戏/作者等列表无分页，查询硬上限 120–200 条——功能增强，超出本计划范围。
- （预置）`upload-client.tsx` 1203 行可拆分为阶段子组件——可选，Phase 4.7 后评估。
- （预置）多数页面缺 per-page metadata（SEO）——独立小任务。
- （预置）无 loading.tsx / error.tsx / not-found.tsx——独立小任务。
- 开发种子的上传权限申请状态为 `open`，审批 UI 与 resolver 只接受真实申请 API 产生的 `pending`；需单独修正种子，当前只读截图无法覆盖批准/驳回按钮。
- 当前上传权限流程没有撤回申请 API；保全表中的“撤回”不属于既有能力，本次未新增业务流程。

---

## 附录 A：逐页文案处置表（Phase 1.2-A 执行清单）

处置：**删** = 整行 subtitle 删除；**改** = 按给出的建议改写；**保** = 保留。建议文案可微调，但须过 §2.1 十条。

| 页面 | 现 subtitle（摘要） | 处置 | 新文案建议 |
|---|---|---|---|
| `/` hero | 「收录、整理、保存…可在线游玩、下载归档、查阅…」 | 改 | 「保存 VIPRPG 祭典相关的 RPG Maker 2000/2003 作品，可在线游玩与下载。」（一句） |
| `/` 「这是什么」段 | 结构讲解 + 引流句 | 改 | 两句以内：收录范围一句 + 「技术细节见 <关于>」一句；删「作品→发布版本→归档快照」结构解说 |
| `/` ENTRIES 五卡 description | 「按 X 筛选/浏览/查看…」同构句 | 改 | 每卡 ≤ 8 字短语或直接删 description（卡片标题已自明） |
| `/games` | 第二句讲数据模型 | 改 | 只留「按作品浏览已归档的游戏。」或整行删 |
| `/games/[slug]` | —（重点是 :58 current 术语） | 改 | 「该作品暂无可下载的最新快照，可在版本列表中选择历史快照。」 |
| `/creators` `/characters` `/tags` `/series` | 各有一句资料类型解说 | 删 | （目录页标题自明） |
| `/characters` 专项 | 「角色是独立于标签的资料类型…」 | 删 | 数据库设计不是用户须知 |
| 4 个目录详情页 | 视具体句 | 删/保 | 只保留含收录口径等真实信息的句子 |
| `/about` | 「项目背景、保存范围、技术架构与边界。」 | 删 | 四名词排比，正文已分节 |
| `/login` `/forgot-password` `/reset-password` | 较短 | 保/微调 | 超过一句的删到一句 |
| `/register` | 「注册后需要管理员批准才可以上传游戏。」 | 保 | 有信息量（真实门槛） |
| `/me` | 「站内信、上传权限、最近导入任务都在这里集中管理。」 | 删 | 三张卡自明；权限完整解释按 1.2-G 收敛到状态卡内 |
| `/inbox` | 「…都会在这里显示。」 | 改 | 只留「当前层级：X」状态行 |
| `/upload` | 两段（权限复述 + 六步流水账） | 改 | 「选择本地 RPG Maker 2000/2003 游戏目录，浏览器会完成检查并上传缺少的文件。」一句 |
| `/upload/tasks` | 第二句复述 + 实现细节 | 改 | 「正在进行和最近完成的导入任务。」 |
| `/play/[id]` | 视具体句 | 改 | 术语按对照表清洗 |
| `/admin` | 「{name}，欢迎。这里是…」 | 改 | 删欢迎句式，subtitle 整行删（仪表盘自明） |
| `/admin/works` | 「这里维护…（七连枚举）」 | 删 | |
| `/admin/works/[id]` | 模式 C | 删→降级 | 见 1.2-C |
| `/admin/creators`（含详情） | 模式 B + 「第一版先…」开发笔记 | 删 | 开发笔记移回代码注释 |
| `/admin/releases/[id]` | 模式 C | 删→降级 | |
| `/admin/archive-versions`（含 trash） | 条件三选一超长 subtitle | 改 | ≤ 一句状态说明；trash 页保留「还原后会重新发布」这一句（真实行为警示） |
| `/admin/tags` `/characters` `/series`（含详情） | 模式 B/C | 删→降级 | |
| `/admin/users` | 视具体句 | 删 | |
| `/admin/maintenance` | 名词五连排比 + 三段解说 | 改 | subtitle 删；「回收站默认保留 N 天」「最终清理不可逆」两条真实信息保留并移至对应操作旁 |
| `/admin/audit` | 「仅超级管理员可访问。这里集中查看…」 | 改 | 第一句删（能进来即有权限）；第二句压成「登录、归档维护与权限调整的审计日志。」 |

## 附录 B：逐模式重写示例（before → after）

### B-B（这里维护）`app/admin/works/page.tsx`

- 前：「这里维护作品层的基础资料：中文名、简介、别名、标签、外部链接、引擎和在线游玩兼容标记。」
- 后：（删除。列表列头已经展示了这些字段。）

### B-C（slug 暂不修改）`app/admin/works/[workId]/page.tsx`

- 前（subtitle）：「作品原名和 slug 暂不在这里修改，避免破坏已有公开 URL 和导入识别。」
- 后：subtitle 删除；原名/slug 展示为只读字段，旁注一行 hint「不可修改」。

### B-D（空状态）

- 前：「没有找到符合条件的作品。调整关键词、引擎或标签后再试。」
- 后（Phase 1 文字版，不建组件）：「没有找到匹配的作品。」（不写第二句；搜索框就在上方）。
- 后（Phase 3 组件版）：EmptyState `title="没有找到匹配的作品。"`，替换手写 JSX。

### B-F（术语）`app/page.tsx` 上传入口卡

- 前：「在浏览器内完成扫描、去重、preflight、commit，无需上传完整 ZIP。」
- 后：「在浏览器内直接导入本地游戏目录，只上传缺少的文件。」

### B-F2（术语）web-play Maniacs 提示

- 前：「该作品标记为 Maniacs Patch。MVP 阶段不展示 EasyRPG 在线游玩入口，请使用 ZIP 下载。」
- 后：「该作品使用 Maniacs Patch，暂不支持在线游玩，请下载 ZIP。」

### B-G（权限流程收敛）

- `/me`（唯一完整版）：「当前为普通用户。提交上传者申请后，管理员会通过站内信回复结果。」+（已申请状态）「申请已提交，等待处理。」
- `/`、`/upload`（引用版）：「上传需要上传者权限，可在 <我的账户> 申请。」

### B-H（枚举 hint）`app/admin/works/[workId]/page.tsx` 角色关联

- 前：hint =「每行一个：角色名|职务|排序|备注。职务可用 main / supporting / cameo / mentioned / other。角色独立写入角色表，不再作为标签保存。」
- 后：placeholder =「艾露莎|main|1|初代主角」；hint =「每行一个角色，字段用 | 分隔；职务：main、supporting、cameo、mentioned、other。」（第三句删除——数据库解说。）

### B-验证码长文案（register/reset 共享）

- 前：两页各一份「验证码已发送到…请检查垃圾邮件或广告邮件，并确认发件人…未被拦截」
- 后：`lib/labels.ts` 常量 `VERIFICATION_EMAIL_HINT` =「验证码已发送至 {email}，未收到时请检查垃圾邮件。」两页引用。

## 附录 C：死代码删除清单（Phase 2.3 执行）

CSS（tsx 中 0 引用，删除前按下面的防误判 grep 再确认一次）：

- `.grid`——**有两处定义**：globals.css:941 附近与 760px media query 内（约 :2268）第二处，都要删。注意裸 `grep grid` 会命中 `entry-grid`/`section-grid`/`upload-form-grid` 等 30+ 处误报，确认命令：`grep -rnE 'className="([^"]* )?grid( [^"]*)?"' app --include=*.tsx`（应为 0）+ `grep -rn 'className={\`' app --include=*.tsx | grep -w grid`（模板字符串兜底，应为 0）。
- `.download-table`——连同其 `td:first-child`（约 :1569）与 `td:last-child`（约 :1573）三条一起删。
- `.session-panel`——**警告：它与在用类共享一条规则**（globals.css:928 是 `.session-panel, .header-actions { ... }`，`.header-actions` 被 26 个文件使用）。只把 `.session-panel,` 从选择器列表里移除，**不得删除整条规则**。
- `.download-section`、`.health-line`、admin 主题的 `.button.danger`——各自独立规则，整条删除。删除前逐个用上面的 className 精确 grep 确认。

重复选择器（合并为一份）：`body`（两处）、`.data-table th`、`.field textarea`、`.inline-unread-dot`、`.upload-panel`、`.web-play-log-card`、两块 `@media (max-width:760px)`。

旧 token 处置：`--vip-sky-soft` 删除；`--vip-sky`、`--vip-focus`、`--vip-action`、`--vip-danger` 并入新 tokens.css（§2.3 已含）；旧浅色系 `--background/--foreground/--panel/--accent` 等在 2.4 完成后删除。

## 附录 D：高频硬编码颜色 → token 映射（Phase 2.4 执行）

| 旧值 | 出现 | 新 token |
|---|---|---|
| `#f0b429`（×6） | admin 金色 | `--console-accent` |
| `#1d1300`（×5） | 黄底按钮文字 | `--btn-primary-text` |
| `#fbfbf8`（×5） | 卡内浅底 | 视上下文：festival 内改 `rgb(255 255 255 / 10%)` 并入 `--btn-bg` 系，或该块整体改深色（浅色块混在深色页是要消灭的对象） |
| `rgb(235 247 255 / 50%)`（×6） | festival 边框 | `--surface-border` |
| `rgb(0 0 0 / 45%)`（×4） | 硬阴影 | `--shadow-pane` |
| `rgb(255 255 255 / 14%)` | 半透明按钮底 | `--btn-bg` |
| `#0c1722 #11181f #2d3a4a #94a3b8 #1f2a36` | admin 裸配色 | `--console-*` 系（#94a3b8 → `--console-muted` 提亮值） |
| `#667085`（--muted 旧值） | 各处灰字 | `--text-muted`（两主题各自可读的新值） |

表外的 hex：就近归入语义 token；确属一次性装饰色的，提升为 tokens.css 里的 primitive 并注释用途。禁止在 tokens.css 以外新增任何 hex。
