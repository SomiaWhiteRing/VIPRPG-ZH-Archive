# GitHub Actions 部署

本项目由一人维护。负责人直接推送 main，正式发布由本人确认，不要求第二位审核人或强制 PR。正式数据与操作边界以[正式部署手册](./production-deployment.md)为准。

## 触发方式

| 流程 | main 推送 | 手动发布 |
| --- | --- | --- |
| [Deploy](../.github/workflows/deploy.yml) | 主站相关变更自动部署 staging | 选择 staging；或选择 production，在检查完成后由本人批准 |
| [Deploy Status](../.github/workflows/status-deploy.yml) | 不自动发布 | 检查通过后由本人批准，部署 status.viprpg.org |
| [Android Release](../.github/workflows/android.yml) | Android 及共用构建依赖变化生成 staging APK 预发布包 | target=production 先构建并验证正式 origin APK，再由本人批准发布正式 Release |

主站 candidate 使用隔离配置运行 check 和既有 test:flow，固定本次 SHA。production job 在 candidate 成功后等待 production Environment 的唯一负责人审批，允许自审；无第二人要求。部署 job 签出同一 SHA，生成目标配置、构建并核对最终绑定，再部署和运行对应环境 smoke。

staging 继续自动应用迁移。production 的 apply_migrations 默认 false：只读核对账本，有待应用迁移就停止；勾选时才在发布前应用本次候选的待执行文件。数据修复、导入、重建和恢复不属于普通发布步骤。状态服务的 apply_migrations 也需显式选择。

主站正式发布、状态服务和正式 Android 使用 production-maintenance 互斥组，不在远端写入过程中自动取消；staging 与自动 Android 构建保留自己的队列。本地维护需避免与远端有状态任务并发。

## GitHub Environment 与凭据

production Environment 配置负责人本人为 required reviewer，允许本人批准自己的运行，关闭审批绕过，只允许 main。status 使用同样的单人确认方式。无需设置强制 PR、代码评审人数或 main 分支写入限制。

- staging Environment：CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN、WRANGLER_CONFIG_JSONC；SMOKE_BASE_URL 保持 https://staging.viprpg.org。
- production Environment：PRODUCTION_CLOUDFLARE_ACCOUNT_ID、PRODUCTION_CLOUDFLARE_API_TOKEN、PRODUCTION_WRANGLER_CONFIG_JSONC。使用专用名称，缺失时失败，不回落到旧仓库级凭据。
- status Environment：CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_STATUS_DEPLOY_TOKEN、STATUS_D1_DATABASE_ID。
- Android 固定签名仍使用四项 ANDROID_KEYSTORE_BASE64、ANDROID_KEYSTORE_PASSWORD、ANDROID_KEY_ALIAS、ANDROID_KEY_PASSWORD；详见 [Android 说明](../android/README.md)。

部署资源配置留在本地或 Environment secret，代码不保存真实 ID 或 token。prepare-wrangler-config.mjs 必须指定 --env staging 或 --env production；可读取完整本地结构并选择目标，也支持只保存该环境自己的资源。Worker 入口和资产规则由仓库模板维护，staging 构建的未选中顶层没有远端绑定，正式构建移除 staging 段；不携带另一环境的私有资源。

不能从仓库级旧 secret 名称判断目标或权限。核实消费者后再移除／轮换具有正式写权限的旧副本；不要破坏 staging 的现有凭据。配置与 token 的实际启用状态见[上线调整记录](./production-readiness.md)，文档声明不等于 Environment 已完成设置。

## 运行时与首次上线

AUTH_SECRET 等 Worker runtime secrets 不由 workflow 写入；正式与 staging 分开设置。正式域名、邮件、资源初始化和根账户注册先按[正式部署手册](./production-deployment.md#首次正式初始化)准备并确认。第一个验证注册者会获得根权限，首次注册必须在受控访问下完成。

npm run deploy:staging 和 npm run deploy:production 自身负责 Vite/SSR 构建。构建选 staging 时设置 CLOUDFLARE_ENV=staging，部署已生成的 build/server/wrangler.json 时必须清空该变量，不再传 --env staging，避免重复追加 Worker 名称。

Android 自动产物继续连接 staging；正式产物连接 viprpg.org。GitHub 发布不自动修改网站更新频道，后台选择 APK 并发布更新属于另一项正式数据操作。独立 Kai APK 的来源白名单不由本站 Android workflow 管理。

## 隔离检查

[verify.yml](../.github/workflows/verify.yml) 在自愿使用 PR 或手动触发时使用隔离配置，运行 check、test:forum 和既有 test:flow，不依赖正式凭据，不迁移或部署远端。它不是强制 PR 流程。自动浏览器检查仅在这些既有 CI 流程中保留；本地浏览器操作仍按任务授权执行。

参考：[GitHub Environment 管理](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)、[部署保护](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)、[Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。
