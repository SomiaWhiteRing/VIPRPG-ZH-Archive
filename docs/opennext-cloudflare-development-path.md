# OpenNext 应用与 Cloudflare 基础设施开发路径

本文档描述 VIPRPG-ZH-Archive 从当前架构计划落地到 OpenNext + Cloudflare Workers 的开发路径。它不重复解释去重存储模型，而是回答：

- Next.js / OpenNext 应用放在哪里。
- Cloudflare R2、D1、Workers、Workers Cache 如何配置。
- 本地开发、预览、迁移、部署按什么顺序推进。
- 哪些配置边界必须遵守，避免破坏“R2 不保存完整游戏 ZIP”的归档原则。

相关主文档：

- [RPG Maker 2000/2003 去重存储库架构计划](./rpg-maker-2000-2003-deduplicated-storage-plan.md)

## 1. 固定原则

- 应用运行时使用 OpenNext for Cloudflare，部署目标是 Cloudflare Workers，不使用 Cloudflare Pages。
- Web 应用放在仓库根目录；`docs/` 和 `tools/` 作为规划文档、本地分析工具目录保留在根目录同级。
- R2 archive bucket 只保存 canonical 数据：`blobs/`、`core-packs/`、`manifests/` 和元数据资产。
- R2 不保存任何完整游戏 ZIP，也不保存原始完整 ZIP 临时对象。
- Workers Cache/CDN 边缘缓存只用于可丢弃的最终下载响应，不作为存储层。
- OpenNext 自身的 R2 incremental cache 如果后续启用，必须使用单独 bucket，不能与归档 bucket 混用，也不能存完整游戏 ZIP。
- Cloudflare 绑定名固定、代码只依赖绑定名，不在业务代码中硬编码 bucket/database 真实名称。

## 2. 目标目录结构

```text
VIPRPG-ZH-Archive/
  app/
  components/
  lib/
    server/
      cloudflare/
      db/
      storage/
      import/
      download/
  migrations/
  public/
    _headers
  next.config.ts
  open-next.config.ts
  wrangler.jsonc
  package.json
  cloudflare-env.d.ts

  docs/
    rpg-maker-2000-2003-deduplicated-storage-plan.md
    opennext-cloudflare-development-path.md

  tools/
    rpgm-archive-scanner/
```

仓库根目录就是 OpenNext 应用根目录。除非特别说明，本文命令都在仓库根目录执行。

## 3. Cloudflare 资源命名

初版建议建立 `staging` 和 `production` 两套远端资源。开发本地默认使用 Wrangler local bindings，不直连生产资源。

| 用途 | Binding | Staging 资源名 | Production 资源名 |
|---|---|---|---|
| Worker | - | `<staging-worker-name>` | `viprpg-zh-archive` |
| D1 数据库 | `DB` | `<staging-resource-name>` | `<production-resource-name>` |
| 归档 R2 bucket | `ARCHIVE_BUCKET` | `<staging-resource-name>` | `<production-resource-name>` |
| OpenNext 静态资产 | `ASSETS` | `.open-next/assets` | `.open-next/assets` |
| Worker 自引用 | `WORKER_SELF_REFERENCE` | 同 Worker 名 | 同 Worker 名 |
| OpenNext incremental cache | `NEXT_INC_CACHE_R2_BUCKET` | 暂不启用 | 暂不启用 |

资源创建命令示例：

```powershell
npx wrangler d1 create <staging-resource-name>
npx wrangler d1 create <production-resource-name>

npx wrangler r2 bucket create <staging-resource-name>
npx wrangler r2 bucket create <production-resource-name>
```

执行后把 D1 返回的 `database_id` 写入 `wrangler.jsonc`。R2 bucket 名必须是小写字母、数字和连字符。

## 4. 应用初始化路径

### 4.1 新建应用

因为仓库根目录已经存在 `docs/` 和 `tools/`，不要用向导覆盖整个目录。推荐先在临时目录生成参考项目，再把需要的配置迁移回根目录：

```powershell
npm create cloudflare@latest -- ..\viprpg-opennext-template --framework=next --platform=workers
```

实际项目在仓库根目录手动初始化 Next.js / OpenNext：

```powershell
npm init -y
npm install next react react-dom
npm install --save-dev typescript @types/node @types/react @types/react-dom eslint eslint-config-next @opennextjs/cloudflare@latest wrangler@latest @cloudflare/workers-types
New-Item -ItemType Directory -Force app,components,lib,public,migrations
New-Item -ItemType Directory -Force lib/server/cloudflare,lib/server/db,lib/server/storage,lib/server/import,lib/server/download
```

如果决定直接用 `create-next-app`，应先在临时目录生成，再迁移 `app/`、`next.config.ts`、`tsconfig.json`、`eslint.config.*` 等文件到根目录。不要让脚手架清理或覆盖现有 `docs/`、`tools/`。

OpenNext 官方要求 Wrangler `3.99.0` 或更新版本。正式实施前运行：

```powershell
npx wrangler --version
```

### 4.1.1 Windows 注意事项

OpenNext 当前会提示 Windows 兼容性不完整。若仓库路径或系统临时目录包含非 ASCII 字符，OpenNext build 可能在复制 `.open-next/.build` 时失败。

当前项目采用两个规避措施：

- `scripts/open-next.mjs` 在 Windows 下把 `TEMP` / `TMP` 指向 `C:\tmp\viprpg-open-next`。
- 如果仓库本身位于非 ASCII 路径，部署时从 ASCII 路径镜像目录执行，例如 `C:\viprpg-archive-build`，或改用已安装 Node 的 WSL/Linux 环境。

Cloudflare API 如果在本机代理下超时，可以临时移除 `HTTP_PROXY` / `HTTPS_PROXY` 后再执行 Wrangler 命令。本次 staging 部署验证是在直连 Cloudflare API 的环境下完成。

### 4.2 package.json scripts

根目录 `package.json` 至少需要：

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build --webpack",
    "opennext": "node scripts/open-next.mjs",
    "preview": "node scripts/open-next.mjs build && node scripts/open-next.mjs preview",
    "deploy": "node scripts/open-next.mjs build && node scripts/open-next.mjs deploy",
    "deploy:staging": "node scripts/open-next.mjs build && node scripts/open-next.mjs deploy --env staging",
    "upload": "node scripts/open-next.mjs build && node scripts/open-next.mjs upload",
    "upload:staging": "node scripts/open-next.mjs build && node scripts/open-next.mjs upload --env staging",
    "cf-typegen": "node scripts/cf-typegen.mjs"
  }
}
```

使用原则：

- `npm run dev` 用于日常 UI 和 API 开发。
- `npm run preview` 用于在本地 Workers runtime 中验证 R2/D1 bindings 和 streaming 行为。
- `npm run deploy` 只用于明确部署 production。
- `npm run deploy:staging` 用于部署 staging。
- 修改 `wrangler.jsonc` 后运行 `npm run cf-typegen`。
- `npm run build` 固定使用 `next build --webpack`，避免当前 OpenNext bundle 在 Turbopack server chunk 上出现运行时加载失败。

### 4.3 next.config.ts

为了让 `next dev` 也能访问本地模拟的 Cloudflare bindings，加入 OpenNext dev 初始化：

```ts
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};

initOpenNextCloudflareForDev();

export default nextConfig;
```

不要在 route handler 中添加：

```ts
export const runtime = "edge";
```

OpenNext Cloudflare 当前不支持 Next.js edge runtime。保持默认 runtime，让 OpenNext 负责转换到 Workers。

### 4.4 open-next.config.ts

初版不启用 OpenNext R2 incremental cache，避免和归档 R2 策略混淆：

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
```

后续如果确实需要 ISR 或 Next.js incremental cache，再单独创建 `viprpg-opennext-cache-*` bucket，并启用 `NEXT_INC_CACHE_R2_BUCKET`。这个 bucket 只能保存 OpenNext 框架缓存，不能保存完整游戏 ZIP。

### 4.5 静态资源缓存头

创建 `public/_headers`：

```text
/_next/static/*
  Cache-Control: public,max-age=31536000,immutable
```

这只影响 OpenNext/Next.js 构建产物，不影响游戏文件下载缓存。游戏下载缓存由下载 API 显式设置响应头和 Workers Cache key。

## 5. wrangler.jsonc 基线

根目录 `wrangler.jsonc` 作为 Cloudflare 配置的 source of truth。

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "viprpg-zh-archive",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-04-30",
  "compatibility_flags": [
    "nodejs_compat",
    "global_fetch_strictly_public"
  ],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "services": [
    {
      "binding": "WORKER_SELF_REFERENCE",
      "service": "viprpg-zh-archive"
    }
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "<production-resource-name>",
      "database_id": "<PROD_D1_DATABASE_ID>",
      "migrations_dir": "migrations"
    }
  ],
  "r2_buckets": [
    {
      "binding": "ARCHIVE_BUCKET",
      "bucket_name": "<production-resource-name>"
    }
  ],
  "send_email": [
    {
      "name": "EMAIL",
      "allowed_sender_addresses": [
        "noreply@example.com"
      ]
    }
  ],
  "ratelimits": [
    {
      "name": "AUTH_EMAIL_RATE_LIMITER",
      "namespace_id": "2001",
      "simple": {
        "limit": 5,
        "period": 60
      }
    }
  ],
  "observability": {
    "enabled": true,
    "head_sampling_rate": 0.1
  },
  "vars": {
    "TURNSTILE_SITE_KEY": "<PROD_TURNSTILE_SITE_KEY>",
    "EMAIL_FROM": "noreply@example.com",
    "APP_ORIGIN": "https://example.com"
  },
  "env": {
    "staging": {
      "name": "<staging-worker-name>",
      "services": [
        {
          "binding": "WORKER_SELF_REFERENCE",
          "service": "<staging-worker-name>"
        }
      ],
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "<staging-resource-name>",
          "database_id": "<STAGING_D1_DATABASE_ID>",
          "migrations_dir": "migrations"
        }
      ],
      "r2_buckets": [
        {
          "binding": "ARCHIVE_BUCKET",
          "bucket_name": "<staging-resource-name>"
        }
      ],
      "send_email": [
        {
          "name": "EMAIL",
          "allowed_sender_addresses": [
            "noreply@example.com"
          ]
        }
      ],
      "ratelimits": [
        {
          "name": "AUTH_EMAIL_RATE_LIMITER",
          "namespace_id": "2002",
          "simple": {
            "limit": 5,
            "period": 60
          }
        }
      ],
      "observability": {
        "enabled": true,
        "head_sampling_rate": 0.25
      },
      "vars": {
        "TURNSTILE_SITE_KEY": "<STAGING_TURNSTILE_SITE_KEY>",
        "EMAIL_FROM": "noreply@example.com",
        "APP_ORIGIN": "https://staging.example.com"
      }
    }
  }
}
```

注意：

- `main` 固定为 `.open-next/worker.js`。
- `assets.directory` 固定为 `.open-next/assets`。
- `compatibility_date` 必须不早于 `2024-09-23`。
- `d1_databases`、`r2_buckets` 等环境绑定不要依赖继承，在 `staging` 中显式写出。
- 不要把 `ARCHIVE_BUCKET` 命名为 `NEXT_INC_CACHE_R2_BUCKET`；两者语义完全不同。
- 初版不配置 Cloudflare Images binding；图标和浏览图按普通 blob/metadata 资产处理，等确实需要图像变换服务时再加入。
- 正式账户体系接入后，`send_email`、`ratelimits` 和 `vars` 也要在 `staging` 中显式写出；Rate Limiting 的 `namespace_id` 不要让 staging/prod 共用，避免测试流量影响生产发送额度。
- `EMAIL_FROM` 必须是 Cloudflare Email Service Email Sending 中已验证、且在 `allowed_sender_addresses` 中允许的发件地址。
- 不要把 Cloudflare Email Routing 当作公开验证码发信服务；Routing/Email Workers 的发信能力可能只能投递到已验证目标地址，用户注册邮箱会触发 `destination address is not a verified address`。

## 6. 本地变量和密钥

根目录 `.env.local` 用于 Next/OpenNext 本地构建和脚本读取，`.dev.vars` 可用于 Wrangler
本地 runtime，两者都不能提交：

```text
NEXTJS_ENV=development
AUTH_SECRET=dev-only-random-secret
BOOTSTRAP_ADMIN_EMAIL=admin@example.local
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
TURNSTILE_SITE_KEY=1x00000000000000000000AA
EMAIL_FROM=noreply@example.com
APP_ORIGIN=http://localhost:3000
```

生产和 staging 密钥使用 Wrangler secrets：

```powershell
npx wrangler secret put AUTH_SECRET
npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL
npx wrangler secret put TURNSTILE_SECRET_KEY

npx wrangler secret put AUTH_SECRET --env staging
npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL --env staging
npx wrangler secret put TURNSTILE_SECRET_KEY --env staging
```

规则：

- 业务代码优先通过 `getCloudflareContext().env` 读取 Cloudflare bindings 和 secrets。
- 认证原型也会回退读取 `process.env.AUTH_SECRET` 和 `process.env.BOOTSTRAP_ADMIN_EMAIL`，便于 `next dev` 或本地脚本验证。
- `TURNSTILE_SECRET_KEY` 是 secret；`TURNSTILE_SITE_KEY` 和 `EMAIL_FROM` 可以作为 runtime vars，但不要从用户请求覆盖。
- `APP_ORIGIN` 是注册/找回密码邮件中回调链接的基准地址；staging 和 production 必须分别配置为各自的受信任公开 origin，不要从请求 Host header 临时拼接。
- Turnstile site key 优先通过服务端渲染或 `/api/auth/config` 输出给前端，避免依赖 Next.js 构建期 `NEXT_PUBLIC_*` 变量。
- 不把生产密钥写入 `.env`、`.dev.vars` 或文档。
- SSG 构建阶段不要读取敏感绑定；需要 Cloudflare 资源的页面优先保持动态渲染。

## 7. D1 开发路径

### 7.1 迁移目录

D1 migrations 放在：

```text
migrations/
```

第一版 migration 直接承接主架构文档中的表结构，但在落地时做一次字段清理：

- `blobs` 不保存文件名或路径。
- 文件路径只存在于 `game_version_files` 和 manifest。
- `download_builds.cache_key` 是边缘缓存 key，不是 R2 key。

### 7.2 创建和应用 migration

```powershell
npx wrangler d1 migrations create DB init_archive_schema
npx wrangler d1 migrations apply DB --local
npx wrangler d1 migrations apply DB --env staging --remote
npx wrangler d1 migrations apply DB --remote
```

执行顺序：

1. 本地 `--local` 先验证 SQL。
2. staging `--env staging --remote` 验证真实 D1。
3. production `--remote` 最后执行。

不要跳过 staging。D1 schema 错误会直接影响导入任务和下载索引。

## 8. R2 开发路径

### 8.1 对象布局

`ARCHIVE_BUCKET` 只允许以下前缀：

```text
blobs/sha256/{aa}/{bb}/{sha256}
core-packs/sha256/{aa}/{bb}/{sha256}.zip
manifests/games/{game_id}/{game_version_id}-{manifest_sha256}.json
metadata/{kind}/sha256/{aa}/{bb}/{sha256}
```

禁止前缀：

```text
downloads/cache/
imports/staging/
full-zips/
source-zips/
```

### 8.2 R2 服务层

先实现 `lib/server/storage/archive-bucket.ts`：

- `putBlob(sha256, stream, sizeBytes)`
- `getBlob(sha256)`
- `putCorePack(sha256, stream, sizeBytes)`
- `getCorePack(sha256)`
- `putManifest(gameId, versionId, manifestSha256, json)`

服务层必须通过 key builder 生成路径，业务代码不能手写 R2 key。

### 8.3 校验规则

- PUT 前后都以系统计算的 SHA-256 为准。
- 不使用 R2 ETag 作为内容身份。
- 同一 `sha256` 重复上传应幂等。
- D1 已存在但 R2 缺失时，标记 `missing` 并进入修复流程。

## 9. Cloudflare bindings 访问层

建立 `lib/server/cloudflare/env.ts`：

```ts
import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getCloudflareEnv() {
  return getCloudflareContext().env as CloudflareEnv;
}
```

然后业务代码只从这个封装取：

```ts
const env = getCloudflareEnv();
const db = env.DB;
const archiveBucket = env.ARCHIVE_BUCKET;
```

这样后续如果需要支持测试 mock、CLI 适配或 remote bindings，只改一处。

## 10. API 和页面落地顺序

### Phase A：应用外壳

目标：部署一个空应用到 Workers。

任务：

- 在仓库根目录初始化 Next.js / OpenNext 应用文件。
- 完成 `wrangler.jsonc`、`next.config.ts`、`open-next.config.ts`。
- 添加 `_headers` 和 `.gitignore`。
- `npm run preview` 通过。
- `npm run deploy:staging` 通过。

验收：

- staging Worker 首页可访问。
- `npm run cf-typegen` 生成 `cloudflare-env.d.ts`。

### Phase B：D1 schema 和管理入口

目标：D1 表结构可迁移，管理员账户可初始化。

任务：

- 编写第一版 D1 migration。
- 实现 `lib/server/db/*`。
- 实现用户表、超级管理员 bootstrap、四层角色和站内信申请。
- 添加 `/admin` 的最小管理页面。

验收：

- 本地和 staging D1 migration 都能成功。
- 管理员可查看低于自己层级的用户，并调整为低于自己层级的任意角色。
- 普通用户通过站内信申请上传者角色；未达到 `uploader` 层级的用户不能进入上传流程。

当前实现状态：

- 已实现基于 HTTP-only cookie 的邮箱登录原型，cookie 使用 `AUTH_SECRET` 做 HMAC 签名。
- 已实现 `BOOTSTRAP_ADMIN_EMAIL`：该邮箱首次登录会自动创建或提升为 `super_admin`，并默认具备上传权限。
- 已实现注册用户自动入库；非 bootstrap 用户默认为 `role_key = 'user'`。
- 已实现 `/login`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`。
- 已实现 `/admin/users`、`/inbox`、`POST /api/admin/users/{userId}/role`、`POST /api/inbox/{itemId}/resolve`、`POST /api/inbox/{itemId}/read` 和 `POST /api/inbox/read-all`。
- 站内信入口显示当前用户未读角标；站内信页支持一键标记全部可见未读项为已读。
- 已将 `/admin`、`GET /api/admin/summary`、`PUT /api/blobs/{sha256}`、`PUT /api/core-packs/{sha256}`、`POST /api/imports/preflight` 接入权限校验。
- 这套登录方式是 Phase B 的最小可用认证壳，用于固定权限边界；后续替换为 OAuth 或更正式的身份服务时，应保留 `users.role_key`、站内信行动项和 route guard 语义。

### Phase B.1：正式密码账户和验证码

目标：把临时邮箱登录替换为可公开使用的邮箱 + 密码登录；验证码只用于注册邮箱验证和找回密码。

任务：

- D1 增加 `email_verification_challenges`、`user_sessions`、`auth_audit_logs`，并为 `users` 增加 `email`、`password_hash`、`password_updated_at`、`email_verified_at`、`status`、`last_login_at`、`failed_login_count`、`locked_until`。
- 在 Cloudflare Dashboard 创建 Turnstile widget，配置 `TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET_KEY`。
- 在 Cloudflare Email Service 的 Email Sending 中验证发送域和 `EMAIL_FROM`，并在 `wrangler.jsonc` 配置 `send_email` binding；仅启用 Email Routing 不满足公开注册验证码投递需求。
- 在 `wrangler.jsonc` 配置 `AUTH_EMAIL_RATE_LIMITER` Rate Limiting binding；staging/prod 使用不同 `namespace_id`。
- 实现 `POST /api/auth/register/start`：校验 Turnstile、密码强度、短窗口 Rate Limiting 和 D1 长窗口频率，写入注册验证码 hash 与待激活密码 hash，并发送邮件。
- 实现 `POST /api/auth/register/verify`：校验注册验证码，消费 challenge，创建或激活用户并签发 session。
- 实现 `POST /api/auth/login`：校验邮箱 + 密码；登录失败按邮箱/IP 记录失败次数和临时锁定；常规登录不发送验证码。
- 实现 `POST /api/auth/password-reset/start`：校验 Turnstile、短窗口 Rate Limiting、D1 长窗口频率，写入找回密码验证码 hash 并发送邮件。
- 实现 `POST /api/auth/password-reset/confirm`：校验验证码和新密码强度，更新 `users.password_hash`，撤销旧 session 或要求重新登录。
- 实现邮件模板：注册邮件只包含验证码、过期时间和安全提示；找回密码邮件只包含验证码、过期时间和安全提示。
- 邮件模板应包含返回验证页面的回调链接，但链接不携带明文验证码或等价登录 token；发码成功页应提示检查垃圾邮件/广告邮件。
- 登录和上传权限保持分离：邮箱验证通过后默认为 `user`，普通用户通过站内信申请成为 `uploader` 后才能上传。

验收：

- 未通过 Turnstile 的发码请求被拒绝。
- 同一邮箱/IP 在短窗口内超过阈值会被 Rate Limiting binding 拦截。
- 注册和找回密码验证码过期、重复使用、超过尝试次数都会失败。
- 常规登录只接受正确密码，不接受验证码或 magic link 作为登录替代路径。
- D1 中不出现明文密码或明文验证码。
- 已验证邮箱和密码登录后可进入账户状态页，但低于 `uploader` 层级的用户调用上传 API 仍返回 403。

当前实现状态：

- 已实现 `0002_auth_password_schema.sql`，本地和 staging D1 已应用。
- 已实现 PBKDF2-SHA256 100000 次迭代密码哈希、注册验证码 challenge、找回密码验证码 challenge、认证审计写入和登录失败临时锁定。
- 已实现 Turnstile 服务端校验、Email Service `EMAIL` binding 发信、`AUTH_EMAIL_RATE_LIMITER` 短窗口限流。
- 应用侧会把 Email Routing 目标地址未验证错误转换为中文运维提示，并在发信失败时清理刚创建的验证码 challenge。
- 已实现 `POST /api/auth/register/start`、`POST /api/auth/register/verify`、`POST /api/auth/login`、`POST /api/auth/password-reset/start`、`POST /api/auth/password-reset/confirm`。
- 已实现 `/login`、`/register`、`/forgot-password`、`/reset-password` 页面。
- 常规登录已切换为邮箱 + 密码；验证码只用于注册和找回密码。

### Phase C：R2 canonical storage

目标：能上传和校验单个 blob/core pack。

任务：

- 实现 R2 key builder。
- 实现 `PUT /api/blobs/{sha256}`。
- 实现 `PUT /api/core-packs/{sha256}`。
- 实现 SHA-256 和 size 校验。
- 实现 D1 `INSERT OR IGNORE` 幂等写入。

验收：

- 重复上传同一 blob 不产生重复 D1 记录。
- blob 表不保存文件名。
- `/api/imports/preflight` 能在上传前返回 existing/missing blob 和 core pack。
- 管理端原型能展示当前 D1/R2 canonical storage 计数。
- R2 中不存在完整游戏 ZIP 路径。

当前实现状态：

- 已实现 `PUT /api/blobs/{sha256}`，会重新计算请求体 SHA-256，匹配后写入 R2 `blobs/sha256/{aa}/{bb}/{sha256}` 和 D1 `blobs`。
- 已实现 `PUT /api/core-packs/{sha256}`，会校验请求体 SHA-256、基础 ZIP magic、`x-core-pack-file-count` 和 `x-core-pack-uncompressed-size`。
- 已实现 `POST /api/imports/preflight`，输入 blob/core pack hash 列表，返回 existing/missing。
- 已实现 `/admin` 和 `GET /api/admin/summary`，用于查看 users、games、versions、blobs、core packs、import jobs 和 download builds 的计数。
- 上传和 preflight 接口现在要求 `uploader`、`admin` 或 `super_admin`；未登录返回 401，普通用户返回 403。

### Phase D：浏览器预索引导入

目标：前端选择文件夹或本地 ZIP，浏览器生成 manifest 草案和 core pack。

任务：

- 实现文件夹选择。
- 实现本地 ZIP 读取，但不上传完整 ZIP。
- 实现白名单过滤和 excluded 统计。
- 实现浏览器 SHA-256。
- 实现 core pack 生成。
- 实现 `/api/imports/preflight`。
- 实现缺失 blob/core pack 上传。
- 实现 `/api/imports/{id}/commit`。

验收：

- 导入成功后 D1 有 `games`、`game_versions`、`game_version_files`。
- manifest 可从 R2 `manifests/` 读取。
- 文件路径只在 manifest 和 `game_version_files` 中出现。

### Phase E：下载重组

目标：能从 manifest + core pack + blobs 重建 ZIP。

任务：

- 实现 `GET /api/games/{slug}/versions/{version}/download`。
- 实现 streaming ZIP builder。
- 实现 core pack entry 流式读取。
- 实现 R2 Get 次数预估。
- 对响应设置不可变缓存 key：`game_version_id + manifest_sha256 + packer_version`。
- 小于当前 Workers Cache/CDN 限制的响应尝试写入 Workers Cache。

验收：

- 下载 ZIP 可运行并保持目录结构。
- 缓存命中时不读取 R2。
- 缓存未命中时可重新生成。
- R2 仍不保存完整游戏 ZIP。

### Phase F：运营和观测

目标：成本、失败和缓存命中率可见。

任务：

- 记录导入耗时、排除大小、缺失 blob 数、R2 Put 数。
- 记录下载耗时、R2 Get 数、Workers Cache 命中/未命中。
- 添加管理端成本估算视图。
- 添加 D1/R2 一致性检查。
- 添加 GC dry-run。

验收：

- 管理端能看到每个版本预计和实际 R2 Get。
- 能发现 D1 有记录但 R2 缺失的对象。
- GC 不会删除仍被引用的 blob/core pack。

## 11. 部署和环境流程

日常开发：

```powershell
npm run dev
```

Workers runtime 本地预览：

```powershell
npm run preview
```

部署 staging：

```powershell
npm run deploy:staging
```

部署 production：

```powershell
npm run deploy
```

建议流程：

1. 所有 D1 migration 先本地执行。
2. staging migration 成功后部署 staging Worker。
3. 用 staging 真实 R2/D1 做一次小样本导入和下载。
4. production migration。
5. production deploy。
6. 部署后运行 smoke test：主页、登录、上传权限、preflight、单 blob 上传、单游戏下载。

当前 staging 验证地址：

```text
https://<staging-worker-domain>
```

基础检查：

```powershell
$base = "https://<staging-worker-domain>"

Invoke-WebRequest "$base/" -UseBasicParsing
Invoke-WebRequest "$base/admin" -UseBasicParsing
Invoke-WebRequest "$base/api/health" -UseBasicParsing
Invoke-WebRequest "$base/api/health/db" -UseBasicParsing
Invoke-WebRequest "$base/api/health/r2" -UseBasicParsing
Invoke-WebRequest "$base/api/admin/summary" -UseBasicParsing
```

单 blob 写入和 preflight 验证：

```powershell
$base = "https://<staging-worker-domain>"
$bytes = [System.Text.Encoding]::UTF8.GetBytes("viprpg prototype blob")
$hashBytes = [System.Security.Cryptography.SHA256]::HashData($bytes)
$hash = ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ""
$preflightBody = @{ blobs = @($hash); corePacks = @() } | ConvertTo-Json -Compress

Invoke-WebRequest "$base/api/imports/preflight" `
  -Method POST `
  -Body $preflightBody `
  -ContentType "application/json" `
  -UseBasicParsing

Invoke-WebRequest "$base/api/blobs/$hash" `
  -Method PUT `
  -Body $bytes `
  -ContentType "text/plain" `
  -UseBasicParsing

Invoke-WebRequest "$base/api/imports/preflight" `
  -Method POST `
  -Body $preflightBody `
  -ContentType "application/json" `
  -UseBasicParsing
```

期望结果：

- 上传前 preflight 返回该 blob 位于 `missing`。
- `PUT /api/blobs/{sha256}` 返回 `201` 和 R2 key。
- 上传后 preflight 返回该 blob 位于 `existing`。
- 这个测试会在 staging R2 写入一个 21 byte 的测试 blob；它符合 canonical blob 规则，不是完整游戏 ZIP。

## 12. CI 建议

先不急着做复杂 CI，最小检查包括：

```powershell
npm run lint
npm run build
npm run cf-typegen
npm run preview
```

后续 CI 可拆成：

- PR：lint、typecheck、unit tests、Next build。
- staging branch：D1 migration list、OpenNext upload/deploy staging。
- production：人工确认后执行 D1 migration + deploy。

D1 production migration 不要在普通 PR preview 中自动执行。

## 13. 明确暂不实现

- 不做 Cloudflare Pages 适配。
- 不做完整 ZIP 上传到 Worker/R2。
- 不做完整 ZIP R2 派生缓存。
- 不启用 OpenNext R2 incremental cache，除非后续明确需要 ISR。
- 不做多 Worker 拆分；单 Worker 无法承载时再评估。
- 不引入 Durable Objects；只有出现并发协调瓶颈时再考虑。

## 14. 第一轮实施清单

1. 在仓库根目录初始化 `package.json` 和 Next.js 基础文件。
2. 安装 `next`、`react`、`@opennextjs/cloudflare` 和 `wrangler`。
3. 写入根目录 `wrangler.jsonc`、`next.config.ts`、`open-next.config.ts`。
4. 创建 staging/prod D1 和 R2。
5. 生成 `cloudflare-env.d.ts`。
6. 编写第一版 D1 migration。
7. 实现 Cloudflare env 封装。
8. 实现 D1 health check API：`GET /api/health/db`。
9. 实现 R2 health check API：`GET /api/health/r2`。
10. `npm run preview` 验证本地 Workers runtime。
11. 部署 staging。
12. 在 staging 上验证 D1/R2 bindings。

第一轮结束时，系统还不需要支持真实游戏导入；目标是证明 OpenNext、Workers、D1、R2 和类型生成已经连通。

## 15. 第二轮实施清单

1. 实现 SHA-256 工具和 R2 key builder。
2. 实现 D1 blob/core pack 查询和幂等 insert。
3. 实现 `PUT /api/blobs/{sha256}`，验证 hash 后写入 R2 和 D1。
4. 实现 `PUT /api/core-packs/{sha256}`，验证 hash、基础 ZIP 头和 core pack 统计 header。
5. 实现 `POST /api/imports/preflight`，返回 existing/missing blob 和 core pack。
6. 实现 `GET /api/admin/summary`。
7. 实现 `/admin` 最小管理端原型页面。
8. 部署 staging。
9. 用 staging API 验证 preflight 前后状态变化和 blob 幂等写入。

第二轮结束时，系统已经能证明 canonical object storage 的基本写入、索引和查询链路可用，并且上传接口已接入 Phase B 的 `uploader`/`admin`/`super_admin` 角色权限边界。它仍不是完整导入系统：浏览器预索引、core pack 生成和 manifest commit 留到后续阶段。

## 16. 参考

- OpenNext Cloudflare Get Started: https://opennext.js.org/cloudflare/get-started
- OpenNext Cloudflare CLI: https://opennext.js.org/cloudflare/cli
- OpenNext Cloudflare Bindings: https://opennext.js.org/cloudflare/bindings
- Cloudflare Workers Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- Cloudflare R2 bucket creation: https://developers.cloudflare.com/r2/buckets/create-buckets/
- Cloudflare Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Cloudflare Email Service Workers API: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- Cloudflare Workers Rate Limiting binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Cloudflare API token template URL: https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/
