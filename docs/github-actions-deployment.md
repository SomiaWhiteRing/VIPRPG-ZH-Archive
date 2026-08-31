# GitHub Actions 自动部署

本仓库使用 OpenNext Cloudflare adapter 和 Wrangler 构建 Cloudflare Workers 部署。自动部署的唯一步骤定义位于 `.github/workflows/deploy.yml`；本文只说明触发方式和前置配置，不记录某次环境是否已经上线。

## 当前策略

- 推送到 `main`：自动部署到 staging。
- 手动运行 `Deploy` workflow 且 `target=staging`：部署到 staging。
- 手动运行 `Deploy` workflow 且 `target=production`：部署到 production。

production 只允许显式选择 `target=production` 的手动发布；该 job 会在部署前执行远程 D1 migration。

## GitHub Secrets

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中添加：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `WRANGLER_CONFIG_JSONC`

`CLOUDFLARE_API_TOKEN` 不要写入仓库。Cloudflare 官方文档也建议在 CI/CD 平台中通过 secrets 保存 API token。

`wrangler.jsonc` 是被 Git 忽略的本地配置。`WRANGLER_CONFIG_JSONC` 必须保存目标仓库所需的完整配置文本；workflow 会在检查和部署前恢复该文件，缺失时直接失败。

API token 至少需要能部署 Worker，并能对本项目使用到的 D1、R2、Email、Rate Limiting 等绑定执行 Wrangler 部署所需操作。权限应尽量限定到当前 Cloudflare account。

## Cloudflare runtime secrets

Worker 运行时 secrets 不由 GitHub Actions 写入，应先在本机或受控终端设置到 Cloudflare：

```bash
npx wrangler secret put AUTH_SECRET --env staging
npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL --env staging

npx wrangler secret put AUTH_SECRET
npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL
```

`.env.local` 只用于本地开发，不要提交，也不要把其中的值硬编码到 workflow。

## 部署流程

精确顺序以 `.github/workflows/deploy.yml` 为准。staging 与 production job 都会安装依赖、恢复 Wrangler 配置、执行静态检查、安装 Chromium、运行 `npm run test:flow`，然后才对目标环境应用 D1 migration 并部署。staging 部署后另运行最小 smoke test；production 不自动复用 staging 的检查结果。

`npm run deploy:staging` 和 `npm run deploy` 自身负责 OpenNext 构建。CI 不应绕过 workflow 中 migration 之前的检查阶段。

Cloudflare D1 文档说明，在 CI/CD 等非交互环境中执行 migration apply 时会跳过确认提示，但仍会捕获备份；失败的 migration 会回滚。

## 参考

- Cloudflare Workers GitHub Actions: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- OpenNext Cloudflare CLI: https://opennext.js.org/cloudflare/cli
- Cloudflare D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- GitHub workflow_dispatch inputs: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
