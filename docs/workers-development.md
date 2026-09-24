# Workers 与 React Router 运行手册

本站以 Hono 编排 API、资源响应与 React Router Framework Mode SSR。开发和生产均使用 workerd；Node 24 只负责构建、类型生成及工具脚本。依赖版本以 package.json 和锁文件为准。

## 请求与数据边界

静态资源由 Cloudflare Static Assets 优先处理；资源未命中时进入 worker.ts。原生下载先分发，再由 app/.server/api.ts 处理 API 与 sitemap，其余交给 React Router。app/routes.ts 显式列出页面路由。未知 API 返回 JSON 404，未知页面返回文档 404，静态资源不启用 SPA fallback。

每个请求创建独立 AppRuntime，显式携带 Request、bindings、ExecutionContext、D1、R2 和请求 memo。Hono 与 loader 共用这一上下文，业务函数不读取全局请求状态。每个受保护 loader 独立鉴权，父布局不能替代它。

服务实现位于 app/.server/，Vite 在构建时拒绝将其带入客户端。loader 直接调用业务服务，只返回显示所需数据；认证记录、密钥和配置不得序列化给浏览器。HTML 与页面数据响应采用 private, no-store。归档下载保持流式响应与独立缓存策略。

## 本地运行

首次安装 Node 24 后执行 npm ci，将 wrangler.example.jsonc 复制为 wrangler.jsonc，将 .env.example 复制为 .env.local。已有配置不覆盖。填写本地 AUTH_SECRET；远程资源 ID 只存本地配置或 CI secret。

`npm run dev` 由 Vite 的开发标志启用请求地址推导：`AppRuntime.origin` 取当前请求 URL 的 origin，同源校验和邮件回调链接随主机名、端口自动变化，无需配置本地 `APP_ORIGIN`。生产构建和 `npm run preview` 仍使用对应环境的 `APP_ORIGIN`；开发模式也不接受缺失或不匹配的 Origin 请求头。

空的本地数据库按[本地展示数据](./local-demo-data.md)执行 `npm run db:local:seed`。schema 初始化、固定快照恢复及已有开发库的备份与重建都以该手册为准。

| 命令 | 职责 |
| --- | --- |
| npm run dev | Vite + React Router，在 workerd 中运行页面、API、下载与 bindings |
| npm run check | binding/路由类型生成、TypeScript、独立 ESLint、安全/UI 静态检查 |
| npm run build | 生成 build/client、build/server 与 Wrangler 部署配置 |
| npm run preview | 构建并预览生产产物 |
| npm test | 构建后在临时 D1/R2 中验证 HTTP、SSR 与权限契约 |
| npm run test:flow | 构建后串行运行浏览器、上传、归档与 OPFS 流程 |
| npm run deploy:staging | 构建时选择 staging，然后部署该产物 |
| npm run deploy | 构建 production，然后部署该产物 |

scripts/app.mjs 在 Windows 和 Linux 使用同一 Node 启动路径，通过 CLOUDFLARE_ENV 选择构建环境。不要将已按一个环境生成的产物改用另一个环境部署。preview 使用 Vite 预览端口；可通过 --port 指定。

Vite 热更新监听排除 `output/`、`.wrangler/` 和 `data/`：这些目录保存诊断产物、本地数据库与对象存储、离线导入素材及种子，可能包含数万文件。Vite 不会自动按 `.gitignore` 排除它们，在 Windows 上逐个建立监听会让启动长时间停在依赖优化日志附近。`data/` 的更新通过对应导入或种子命令生效。

`app/globals.css` 将 Tailwind 类名扫描限定在 `app/` 与 `lib/`，避免首次页面请求编译样式时再遍历整个仓库。若将包含 Tailwind 类名的前端源码移到其他目录，需要同步添加 `@source`。

## Binding 与存储

DB 提供 D1，ARCHIVE_BUCKET 保存 canonical 对象，ASSETS 提供构建后的静态资源，EMAIL 与 AUTH_EMAIL_RATE_LIMITER 提供邮件和限流。顶层与 staging 必须各自完整配置；敏感值使用 Wrangler secrets。本地 dotenv 由 Cloudflare 插件加载，不进入浏览器 bundle；build 目录和其中开发变量不得提交。

作品和主题浏览量使用 `VIEW_STATS` SQLite Durable Object，`VIEW_RATE_LIMITER` 单独限制匿名上报；不向 D1 回写计数。每日去重、按需读取缓存、作品合并待办与本地重置规则见[浏览量模型](./view-statistics.md)。

认证邮件限流在本地与线上使用相同失败语义：达到限额则拒绝，绑定缺失或调用异常则记录原始错误并报告服务不可用，不因 localhost 放行。隔离运行配置也必须声明 `AUTH_EMAIL_RATE_LIMITER`。`scripts/run-wrangler.mjs` 只按正常退出码 `0` 判定成功，不解析成功日志或强杀后报成功；若调用方超时或中断，写入结果仍须另行核实，不能直接重试远程写入。

修改配置后运行 npm run cf-typegen。cloudflare-env.d.ts 为生成文件。CI 使用 scripts/prepare-wrangler-config.mjs 从 WRANGLER_CONFIG_JSONC 提取环境资源配置，Worker 入口与资源路由由仓库模板决定。

D1 schema 统一维护 `migrations/0001_init_archive_schema.sql`。`ARCHIVE_BUCKET` 中的 blobs、core-packs、manifests 通过 `app/.server/storage/archive-keys.ts` 生成 key；完整 ZIP 只用作流式响应及可丢弃的下载缓存。scheduled 事件调用 `worker/archive-gc.mjs`。论坛图片也使用该桶，但由[论坛图片清理规则](./forum-discussion-design.md#图片存储与清理)独立管理。

## 发布和回滚

远端入口及 production／staging 配置来源见[部署环境](./staging-deployment.md#环境地址与配置来源)。Worker 名称是部署标识，不用于推导站点 URL；顶层配置与 `env.staging` 属于不同目标。

发布前完成 `npm run verify:preprod`，核对目标域名、bindings、邮件、限流与 secrets。推送到 `main` 会自动发布 staging；production 需手动选择。具体门禁与顺序见[GitHub Actions 自动部署](./github-actions-deployment.md)。

保留切换前 Worker 版本及对应静态资源，回滚时恢复完整应用版本，并确认该版本与目标数据库结构兼容。远程 migration 与部署按目标环境串行执行；数据库备份、重建和恢复属于独立运维操作，不随应用发布或回滚自动执行。

## 故障定位

binding 缺失先检查 Wrangler 目标环境；同源拒绝时，开发模式核对请求 URL 与 Origin 请求头，生产及预览模式核对 APP_ORIGIN；资源 404 先检查 build/client 与 Vite Worker/WASM 路径；浏览器收到服务端模块时检查 .server 边界与 loader 返回字段。D1/R2/浏览器检查串行执行，测试状态与开发状态分离。完整规则见 [维护与回归](./maintenance-regression.md)。

参考：[Cloudflare React Router](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/)、[Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)。
