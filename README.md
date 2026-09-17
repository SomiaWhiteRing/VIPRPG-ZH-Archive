# VIPRPG.org

基于 Hono、React Router SSR 和 Cloudflare Workers/D1/R2 的 VIPRPG 游戏归档站。

[文档入口](docs/README.md)包含现行产品与架构、运行手册、研究资料及历史归档。

## 环境要求

- Windows、macOS 或 Linux
- Node.js 24 LTS（精确开发版本见 `.node-version`）
- npm（随 Node.js 安装）

## 本地启动

在仓库根目录安装依赖；两个配置文件仅在尚不存在时从示例复制：

```powershell
npm ci
if (!(Test-Path wrangler.jsonc)) { Copy-Item wrangler.example.jsonc wrangler.jsonc }
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

在 `.env.local` 中设置 `AUTH_SECRET`。`npm run dev` 自动使用当前请求的主机名和端口，无需设置 `APP_ORIGIN`。macOS／Linux 使用相应的 shell 复制命令，同样保留已有配置。

首次使用时，从已审核的固定种子恢复本地 D1 和 R2：

```powershell
npm run db:local:seed
```

此命令只操作 Wrangler 本地 D1 和 R2，已有业务数据时拒绝覆盖。种子包含当前 schema、审核后的角色分类、头像格子及素材绑定，不必先运行 reset 或 migrate。恢复前停止本地服务器。

可使用 `super@dev.local` 或 `user@dev.local` 登录，密码均为 `dev123456789`。完整演示账号、场景、快照捕获及备份恢复步骤见[本地展示数据](docs/local-demo-data.md)。

启动开发服务器：

```powershell
npm run dev
```

默认使用 3000 端口；被占用时自动尝试 3001、3002 等后续端口，请打开终端输出的 `Local` 地址。也可以指定起始端口：

```powershell
npm run dev -- --port 3001
```

开发模式下，同源校验和邮件回调链接会自动跟随实际访问地址，切换端口无需修改 `.env.local`。生产构建及 `npm run preview` 仍使用配置的 `APP_ORIGIN`，应将其设为对应环境的访问地址。

## 常用命令

```powershell
npm run check           # 类型、lint、静态架构和安全规则
npm test                # 隔离 D1/API 的持久契约，不启动浏览器
npm run regression      # 需要回归时串行运行 check + test，保留报告
npm run test:flow       # 预生产关键流程：Chromium、Worker、R2/OPFS
npm run verify:preprod  # check + test:flow（流程入口含构建）
npm run smoke:staging   # 已部署 staging 的最小健康检查
npm run build           # Vite 浏览器资源与 SSR Worker 构建
npm run preview         # 自动构建并在 workerd 中预览生产产物
```

日常开发按改动选择最小既有检查；明确进行回归时使用 `npm run regression`。新增测试和浏览器操作遵守任务授权边界。运行已授权的浏览器流程前，先执行 `npx playwright install chromium` 安装驱动。检查范围、串行规则、报告与失败处理统一见[维护与回归手册](docs/maintenance-regression.md)。

`npm run dev` 用于主站和论坛开发；开发环境即运行于 workerd；验证生产产物使用 `npm run preview`。

论坛图片复用 `ARCHIVE_BUCKET`，无需额外图床密钥。原始文件单张最多 2 MiB，浏览器同格式处理后在发布时上传；读取权限和人工清理规则见[论坛设计文档](docs/forum-discussion-design.md#图片存储与清理)。

账户、维基人模板与根账户轮换规则见[认证与权限](docs/authentication-authorization.md)。

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
