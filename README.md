# VIPRPG.org

基于 Hono、React Router SSR 和 Cloudflare Workers/D1/R2 的 VIPRPG 游戏归档站。

## 环境要求

- Windows、macOS 或 Linux
- Node.js 24 LTS（精确开发版本见 `.node-version`）
- npm（随 Node.js 安装）

## 本地启动

在仓库根目录执行：

```powershell
npm ci
Copy-Item wrangler.example.jsonc wrangler.jsonc
Copy-Item .env.example .env.local
```

如果已经有自己的 `.env.local`，不要覆盖它；只需确认至少设置了 `AUTH_SECRET`、`APP_ORIGIN=http://localhost:3000`。

首次使用时，从已审核的固定种子恢复本地 D1 和 R2：

```powershell
npm run db:local:seed
```

此命令只操作 Wrangler 的本地资源，不会修改 Cloudflare 远端数据库或对象存储；已有业务数据时会拒绝覆盖。恢复种子后会自动应用尚未执行的 migration，不必先运行 reset 或 migrate。演示账号密码均为 `dev123456789`：

| 账号 | 角色 |
| --- | --- |
| `super@dev.local` | super_admin |
| `admin@dev.local` | admin |
| `uploader@dev.local` | uploader |
| `user@dev.local` | user |

将后续整理完成的本地数据库和 R2 固化为新版种子：

```powershell
npm run db:local:seed:capture
npm run db:local:seed:verify
```

种子位于 `data/local-seed/`，直接保留角色 ID、人工分类、头像格子及素材绑定，不再从词典或演示生成器重建。导出前暂停编辑和上传；恢复前停止本地服务器。导出、恢复及演示账号详情见[本地展示数据](docs/local-demo-data.md)。

启动开发服务器：

```powershell
npm run dev
```

然后打开 <http://localhost:3000>。如果 3000 端口已被占用，可以指定其他端口：

```powershell
npm run dev -- --port 3001
```

## 常用命令

```powershell
npm run check           # 类型、lint、静态架构和安全规则
npm test                # 隔离 D1/API 的持久契约，不启动浏览器
npm run regression      # 串行运行 check + test，并保留回归报告
npm run test:flow       # 预生产关键流程：Chromium、Worker、R2/OPFS
npm run verify:preprod  # check + test:flow + production build
npm run smoke:staging   # 已部署 staging 的最小健康检查
npm run build           # Vite 浏览器资源与 SSR Worker 构建
npm run preview         # 构建后在 workerd 中预览生产产物
```

敏捷开发默认运行 `npm run regression`，或按改动选择 `npm run check` / `npm test`；流程测试不作为每项功能的完成条件。首次运行 `npm run test:flow` 或 `npm run verify:preprod` 前执行 `npx playwright install chromium`。回归入口会串行执行有状态检查，并在 `output/regression/` 保留报告和阶段日志；失败分类与停止条件见 [`docs/maintenance-regression.md`](docs/maintenance-regression.md)。

`npm run dev` 用于主站和论坛开发；开发环境即运行于 workerd；验证生产产物使用 `npm run preview`。

论坛图片复用 `ARCHIVE_BUCKET`，无需额外图床密钥。原始文件单张最多 2 MiB，浏览器同格式处理后在发布时上传；读取权限和人工清理规则见[论坛设计文档](docs/forum-discussion-design.md#图片存储与清理)。

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

远程 D1 migration、部署和 smoke test 必须按目标环境串行执行。具体命令不在快速入门中复制，以 [`docs/README.md`](docs/README.md) 链接的 Workers 与 GitHub Actions 运行手册为准。

## 目录概览

- `app/`：React Router 页面、loader、组件；`app/.server/`：Hono API、认证与业务服务
- `lib/`：共享 DTO、领域规则和浏览器纯函数
- `worker.ts`：Hono、SSR 与 scheduled 事件入口
- `migrations/`：D1 统一初始化（上线前仅维护 `0001_init_archive_schema.sql`）
- `public/play/`：EasyRPG Web Player 运行时
- `scripts/`：本地数据库、种子数据、构建和 smoke test 脚本
- `docs/`：产品、领域、存储、部署和运行手册
