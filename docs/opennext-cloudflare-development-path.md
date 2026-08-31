# OpenNext 与 Cloudflare 运行手册

本文说明当前 Next.js 应用如何在 OpenNext / Cloudflare Workers 上开发和部署。游戏资料模型见[游戏领域架构](./game-domain-architecture.md)，归档对象规则见[去重存储架构](./rpg-maker-2000-2003-deduplicated-storage-plan.md)，认证安全边界见[认证与权限基线](./authentication-authorization-baseline-plan.md)。

会随环境变化的资源 ID、域名、兼容日期、cron 和版本号不在本文复制；从当前 `wrangler.jsonc`、`package.json` 和 `.github/workflows/deploy.yml` 读取。

## 1. 运行时结构

```text
request
  -> worker.mjs
       -> worker/archive-download.mjs 处理原生流式下载
       -> .open-next/worker.js 处理其余 Next.js 请求

scheduled event
  -> worker.mjs
       -> worker/archive-gc.mjs
```

- `worker.mjs` 是 Cloudflare Worker 入口。原生下载必须先于 OpenNext fetch handler 执行。
- `open-next.config.ts` 只定义 OpenNext adapter；框架缓存不得复用归档对象 bucket。
- `next.config.ts` 通过 `initOpenNextCloudflareForDev()` 为 `next dev` 提供本地 binding。
- 页面和 App Route 保持默认 runtime，不单独声明 Next.js edge runtime。
- `public/_headers` 只控制框架静态资产；游戏下载缓存由原生下载 Worker 管理。

## 2. 权威配置

| 事实 | 权威位置 |
| --- | --- |
| npm 命令与依赖 | `package.json` |
| Worker、binding、环境和 cron | `wrangler.jsonc` |
| OpenNext adapter | `open-next.config.ts` |
| Next.js 开发 binding | `next.config.ts` |
| Worker 组合入口 | `worker.mjs` |
| CI 部署顺序 | `.github/workflows/deploy.yml` |
| 本地变量名称 | `.env.example` |
| 生成的 binding 类型 | `cloudflare-env.d.ts` |

修改 `wrangler.jsonc` 后运行 `npm run cf-typegen`。不要手工编辑 `cloudflare-env.d.ts`。

## 3. 本地开发

首次安装：

```powershell
npm install
Copy-Item .env.example .env.local
```

至少设置本地 `AUTH_SECRET` 和与开发地址一致的 `APP_ORIGIN`。本地认证邮件限流 binding 不可用时自动跳过；远程环境缺少 binding 时请求失败。

初始化本地 D1/R2 演示状态：

```powershell
npm run db:local:reset
npm run db:local:seed
```

日常页面和 App Route 开发：

```powershell
npm run dev
```

需要验证原生下载、scheduled handler 或真实 Workers binding 语义时使用：

```powershell
npm run preview
```

`npm run db:local:reset` 会清空 Wrangler 本地状态；它不操作远端 D1/R2。远端命令必须显式携带 `--remote`，staging 还必须携带 `--env staging`。

## 4. Binding 与密钥

应用依赖以下 Cloudflare binding：

| Binding | 职责 |
| --- | --- |
| `DB` | D1 业务数据、对象引用和审计 |
| `ARCHIVE_BUCKET` | blob、core pack 和 manifest canonical 对象 |
| `ASSETS` | OpenNext 静态资产 |
| `WORKER_SELF_REFERENCE` | OpenNext 自引用请求 |
| `EMAIL` | 认证邮件 |
| `AUTH_EMAIL_RATE_LIMITER` | 认证邮件限流 |

非敏感环境值由 `wrangler.jsonc` 的 `vars` 提供；敏感值使用 Wrangler secrets。当前 secret 名称从 `.env.example` 与认证代码读取，禁止在本文或 workflow 中保存值。

生产与 staging 必须分别配置资源、self-reference、发件地址、限流 namespace、`APP_ORIGIN` 和 secret。不要依赖顶层环境配置隐式继承。

业务代码通过 `lib/server/cloudflare/env.ts` 取得 binding。除该访问层和原生 Worker 外，不直接散布 `getCloudflareContext().env` 读取。

## 5. D1

- schema 只由 `migrations/` 发布；当前项目未上线且没有需保留的生产数据时，直接推进唯一当前 migration 模型。
- 本地 reset/seed 脚本是开发基线，不作为生产迁移工具。
- migration 与同一目标环境的部署必须串行执行；本地、staging 和 production 各自维护状态，不能用一个环境的成功结果推断另一个环境已经迁移。
- D1 只保存可查询的资料、状态、统计和对象引用；归档内文件路径只存在于 manifest。

常用命令：

```powershell
npm run db:local:migrate
npx wrangler d1 migrations apply DB --env staging --remote
npx wrangler d1 migrations apply DB --remote
```

production migration 具有外部副作用，只能在明确的生产发布流程中运行。

## 6. R2

`ARCHIVE_BUCKET` 只保存 canonical 对象。R2 key 必须由 `lib/server/storage/archive-keys.ts` 的 `blobKey`、`corePackKey` 和 `manifestKey` 生成；业务代码不拼接对象路径。

允许的对象族：

```text
blobs/sha256/...
core-packs/sha256/...
manifests/sha256/...
```

完整游戏 ZIP 只作为流式响应或 Workers Cache/CDN 中的可丢弃派生数据存在，不写入 R2。上传暂存目录、源 ZIP 和下载缓存也不属于 canonical bucket。

对象身份只使用系统计算的 SHA-256，不使用 R2 ETag。相同 hash 的重复 PUT 必须幂等；D1 与 R2 不一致时显式报告并进入维护流程。

## 7. 构建与部署

日常开发的检查分层遵循根目录 `AGENTS.md`。进入预生产或准备手动部署时运行完整入口：

```powershell
npm run verify:preprod
```

手动部署 staging：

```powershell
npm run verify:preprod
npx wrangler d1 migrations apply DB --env staging --remote
npm run deploy:staging
npm run smoke:staging
```

手动部署 production：

```powershell
npm run verify:preprod
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

GitHub Actions 的实际触发条件、environment、secrets 和步骤以 `.github/workflows/deploy.yml` 为准；操作说明见[GitHub Actions 自动部署](./github-actions-deployment.md)。长期文档不记录某次部署的 UUID、测试 ArchiveVersion ID 或当时的线上响应。

发布验收只保留环境相关的增量检查：

- 部署前确认 `npm run verify:preprod` 和目标 D1 migration 成功；
- 部署后读取 `/api/health`、`/api/health/db`、`/api/health/r2` 的实际响应，staging 运行 `npm run smoke:staging`；
- 从目标环境日志确认 scheduled GC 是否成功，不通过文档中的旧结果推断当前状态。

## 8. Windows

OpenNext 命令统一通过 `scripts/open-next.mjs` 启动。该脚本在 Windows 上设置专用临时目录并加载文件复制 workaround；不要绕过它直接把 CLI 写回 npm scripts。

若仓库或系统临时路径中的非 ASCII 字符仍导致构建复制失败，从 ASCII 路径镜像执行构建，或使用已安装 Node 的 WSL/Linux 环境。代理导致 Cloudflare API 失败时，先检查当前 `HTTP_PROXY` / `HTTPS_PROXY` 是否符合预期，再重试同一命令。

## 9. 故障定位

| 现象 | 先检查 |
| --- | --- |
| `next dev` 访问不到 binding | `next.config.ts` 的 OpenNext dev 初始化和本地 Wrangler 状态 |
| preview 与 dev 行为不同 | 请求是否依赖原生 Worker、streaming、cron 或真实 binding |
| D1 表或字段缺失 | 当前 migration 列表、目标环境和是否误用了 local/remote |
| R2 对象找不到 | manifest SHA-256、`archive-keys.ts` 生成结果和对象状态 |
| 认证邮件失败 | `EMAIL` binding、发件地址、限流 binding 与 secret |
| 同源请求被拒绝 | 目标环境的 `APP_ORIGIN` 与请求 Origin |
| OpenNext Windows 复制失败 | `scripts/open-next.mjs` 是否生效、临时目录和仓库路径 |

诊断只记录本次命令、目标环境和实际错误；不要把一次部署结果回写为长期“当前状态”。

## 10. 非目标

- Cloudflare Pages 适配。
- 完整 ZIP、源 ZIP 或下载派生缓存写入 R2。
- Web Play 专用 ZIP 或跨域 EasyRPG iframe。
- 将 OpenNext incremental cache 与归档 bucket 混用。
- 没有真实协调瓶颈前引入 Durable Objects 或拆分多个 Worker。

## 11. 参考

- OpenNext Cloudflare: https://opennext.js.org/cloudflare/get-started
- Cloudflare Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- Cloudflare R2: https://developers.cloudflare.com/r2/
