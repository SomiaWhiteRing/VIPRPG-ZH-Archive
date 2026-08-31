# VIPRPG.org

基于 Next.js、OpenNext 和 Cloudflare D1/R2 的 VIPRPG 游戏归档站。

## 环境要求

- Windows、macOS 或 Linux
- Node.js `>=22`
- npm（随 Node.js 安装）

## 本地启动

在仓库根目录执行：

```powershell
npm install
Copy-Item .env.example .env.local
```

如果已经有自己的 `.env.local`，不要覆盖它；只需确认至少设置了 `AUTH_SECRET`、`APP_ORIGIN=http://localhost:3000`。

首次使用或需要演示数据时，初始化本地 D1 和 R2：

```powershell
npm run db:local:reset
npm run db:local:seed
```

这两个命令只操作 Wrangler 的本地资源，不会修改 Cloudflare 远端数据库或对象存储。演示账号密码均为 `dev123456789`：

| 账号 | 角色 |
| --- | --- |
| `super@dev.local` | super_admin |
| `admin@dev.local` | admin |
| `uploader@dev.local` | uploader |
| `user@dev.local` | user |

启动开发服务器：

```powershell
npm run dev
```

然后打开 <http://localhost:3000>。如果 3000 端口已被占用，可以指定其他端口：

```powershell
npm run dev -- -p 3001
```

## 常用命令

```powershell
npm run check           # 类型、lint、静态架构和安全规则
npm test                # 隔离 D1/API 的持久契约，不启动浏览器
npm run test:flow       # 预生产关键流程：Chromium、Worker、R2/OPFS
npm run verify:preprod  # check + test:flow + production build
npm run smoke:staging   # 已部署 staging 的最小健康检查
npm run build           # Next.js 生产构建
npm run preview         # OpenNext/Cloudflare Workers 本地预览
```

敏捷开发默认按改动选择 `npm run check` 或 `npm test`；流程测试不作为每项功能的完成条件。首次运行 `npm run test:flow` 或 `npm run verify:preprod` 前执行 `npx playwright install chromium`。两种测试都不依赖开发 seed，也不修改 `.wrangler/state`；成功后删除临时状态，失败时输出保留的日志与截图目录。

`npm run dev` 适合页面和普通 API 开发；需要验证原生 Worker、D1/R2 binding 或下载链路时使用 `npm run preview`。

唯一根账户只能通过受审计运维命令轮换。远程环境还必须提供与目标邮箱相同的 `--confirm`：

```powershell
node scripts/rotate-bootstrap-admin.mjs --email admin@example.com --local
node scripts/rotate-bootstrap-admin.mjs --email admin@example.com --staging --confirm admin@example.com
node scripts/rotate-bootstrap-admin.mjs --email admin@example.com --production --confirm admin@example.com
```

## Cloudflare 部署

部署前先配置 Cloudflare 凭据和远端 secrets，并运行预生产验收：

```powershell
npm run verify:preprod
```

远程 D1 migration、部署和 smoke test 必须按目标环境串行执行。具体命令不在快速入门中复制，以 [`docs/README.md`](docs/README.md) 链接的 OpenNext 与 GitHub Actions 运行手册为准。

## 目录概览

- `app/`：Next.js App Router 页面和 API
- `lib/`：归档、数据库、认证和 Cloudflare 运行时逻辑
- `migrations/`：D1 schema migration
- `public/play/`：EasyRPG Web Player 运行时
- `scripts/`：本地数据库、种子数据、构建和 smoke test 脚本
- `docs/`：产品、领域、存储、部署和运行手册
