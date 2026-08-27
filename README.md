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

如果已经有自己的 `.env.local`，不要覆盖它；只需确认至少设置了 `AUTH_SECRET`、`APP_ORIGIN=http://localhost:3000`。本地登录开发时可在 `.env.local` 加上：

```dotenv
TURNSTILE_ENABLED=false
```

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
npm run check            # TypeScript + ESLint
npm run check:security   # typed 权限目录与领域边界自检
npm run check:security:d1 # 已 seed 的本地 D1 安全集成检查
npm run check:security:api # 本地服务运行时的 401/403/ownership 检查
npm run build            # Next.js 生产构建
npm run preview          # OpenNext/Cloudflare Workers 本地预览
```

`npm run dev` 适合页面和普通 API 开发；需要验证原生 Worker、D1/R2 binding 或下载链路时使用 `npm run preview`。

唯一根账户只能通过受审计运维命令轮换。远程环境还必须提供与目标邮箱相同的 `--confirm`：

```powershell
node scripts/rotate-bootstrap-admin.mjs --email admin@example.com --local
node scripts/rotate-bootstrap-admin.mjs --email admin@example.com --staging --confirm admin@example.com
node scripts/rotate-bootstrap-admin.mjs --email admin@example.com --production --confirm admin@example.com
```

## Cloudflare 部署

部署前先配置 Cloudflare 凭据和远端 secrets。生产环境命令具有外部副作用，请确认目标环境后再执行：

```powershell
npm run deploy:staging
npm run deploy
```

详细的 OpenNext、D1、R2 和 GitHub Actions 说明见 [`docs/README.md`](docs/README.md) 及其中链接的架构文档。

## 目录概览

- `app/`：Next.js App Router 页面和 API
- `lib/`：归档、数据库、认证和 Cloudflare 运行时逻辑
- `migrations/`：D1 schema migration
- `public/play/`：EasyRPG Web Player 运行时
- `scripts/`：本地数据库、种子数据、构建和 smoke test 脚本
- `docs/`：产品、领域、存储、部署和运行手册
