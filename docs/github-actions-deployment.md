# GitHub Actions 自动部署

本项目已经使用 OpenNext Cloudflare adapter 和 Wrangler 部署到 Cloudflare Workers。自动部署入口在 `.github/workflows/deploy.yml`。

## 当前策略

- 推送到 `main`：自动部署到 staging。
- 手动运行 `Deploy` workflow 且 `target=staging`：部署到 staging。
- 手动运行 `Deploy` workflow 且 `target=production`：部署到 production。

生产环境没有默认绑定到每次 `main` 推送，原因是 workflow 会在部署前执行远程 D1 migration。等 staging 验证稳定后，再手动发布生产更适合当前项目。

## GitHub Secrets

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中添加：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

`CLOUDFLARE_API_TOKEN` 不要写入仓库。Cloudflare 官方文档也建议在 CI/CD 平台中通过 secrets 保存 API token。

API token 至少需要能部署 Worker，并能对本项目使用到的 D1、R2、Email、Rate Limiting 等绑定执行 Wrangler 部署所需操作。权限应尽量限定到当前 Cloudflare account。

## Cloudflare runtime secrets

Worker 运行时 secrets 不由 GitHub Actions 写入，应先在本机或受控终端设置到 Cloudflare：

```bash
npx wrangler secret put AUTH_SECRET --env staging
npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL --env staging
npx wrangler secret put TURNSTILE_SECRET_KEY --env staging

npx wrangler secret put AUTH_SECRET
npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL
npx wrangler secret put TURNSTILE_SECRET_KEY
```

`.env.local` 只用于本地开发，不要提交，也不要把其中的值硬编码到 workflow。

## 部署流程

每次部署会执行：

```bash
npm ci
npm run check
npx wrangler d1 migrations apply DB --env staging --remote
npm run deploy:staging
npm run smoke:staging
```

生产部署对应执行：

```bash
npm ci
npm run check
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

Cloudflare D1 文档说明，在 CI/CD 等非交互环境中执行 migration apply 时会跳过确认提示，但仍会捕获备份；失败的 migration 会回滚。

## 改成 main 自动发布 production

如果后续确认每次 `main` 推送都应直接发布生产，可以把 `.github/workflows/deploy.yml` 中 production job 的触发条件改为：

```yaml
if: ${{ github.event_name == 'push' || inputs.target == 'production' }}
```

不建议在有真实生产数据前后频繁切换策略；D1 schema、Worker 代码和 smoke test 应保持同一条当前路径。

## 参考

- Cloudflare Workers GitHub Actions: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- OpenNext Cloudflare CLI: https://opennext.js.org/cloudflare/cli
- Cloudflare D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- GitHub workflow_dispatch inputs: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
