# 正式上线调整记录

2026-09-26，负责人明确：这是单人项目；正式部署与 Codex 维护数据需要本人确认，网站正常业务按既有权限运行。

常驻操作规则已整理到[正式部署手册](./production-deployment.md)、[GitHub Actions 说明](./github-actions-deployment.md)和 [AGENTS.md](../AGENTS.md)。本记录不重复操作步骤，也不构成首次上线或数据修改授权。

## 已落实到代码和文档

- 明确的 deploy:production 入口、目标预览和确认边界，禁止省略目标时直接发布；正式构建前后核对环境身份。
- 主站候选隔离检查后进入正式确认；本人可以批准自己的发布，不增加第二位审核人、强制 PR 或 main 推送限制。
- 正式 D1 迁移默认关闭；代码发布前只读核对账本，显式批准后才执行迁移。根账户轮换默认显示计划，执行时解析所选配置中的 DB。
- 正式 Environment 使用专用 secret 名称，避免误用仓库级旧配置；模板和本地目标 origin 更新为 viprpg.org，保留既有 Worker 身份。
- 首发后冻结已应用迁移；种子准备执行完整迁移链并记录各文件校验和。
- 网站 Kai 导入来源包含 viprpg.org，移除旧 Workers.dev 来源；本站 Android 区分 staging 自动预发布和 production 手动发布。
- 状态页增加独立正式 monitor ID，保留 staging 历史；状态服务改为本人确认后发布。正式 smoke 使用明确目标、超时和禁止重定向。

## 2026-09-26 正式上线

负责人随后明确授权正式部署，并同步 Kai 与 RPGRewriter-Ownuse 的导入／更新指向。首发代码为 `f056fb8cc0cefd0d95c90dc40760fade016f0326`，通过 production Environment 的本人确认发布至 [viprpg.org](https://viprpg.org)。[发布运行](https://github.com/SomiaWhiteRing/VIPRPG-ZH-Archive/actions/runs/36208034503)保留候选、审批、部署与 smoke 记录；初次绑定域名后立即运行的 smoke 连接失败，域名生效后本机九个 smoke 路径均返回 200，重跑同一候选的发布 job 后 CI 全部通过。

GitHub production/status 的唯一确认人为 SomiaWhiteRing，允许本人自审、禁止绕过确认、只允许 main 发布；staging 无审批保护，main 没有增加分支保护或 PR 限制。production 三项专用名称的 secrets 已填入正式配置；移除了无消费者的旧仓库级 CLOUDFLARE_API_TOKEN 和 WRANGLER_CONFIG_JSONC，staging/status Environment 保留各自配置。正式 AUTH_SECRET 独立生成；部署 API token 沿用现有可用凭据，当前凭据无 token 管理权限，未声称已经实现 Cloudflare token 的逐资源权限隔离。

新建独立 D1/R2 `viprpg-archive-production`，保留旧 prod 和 staging 资源。应用 0001 首发基线后导入干净种子：930 个角色、132 个分类、887 个默认头像、30 个默认表情、8 个链接，17,173 个对象共 150,282,413 字节；用户和作品为零。逐表数量、完整 schema、外键及迁移账本一致；本地 SHA-256 与全量远端对象大小／MD5 ETag 一致。资源身份、旧版本绑定、种子及校验报告保存在本机 `output/production-setup/`，其中 source.sqlite 含完整开发快照，只用于本地准备，没有上传。

正式 robots 允许索引，staging 保留 noindex；注册页和资源页返回 200，匿名后台重定向登录，抽查公开素材字节和 SHA-256 一致。正式、预生产和开发环境均沿用首个验证注册账号自动获得 `super_admin` 的逻辑，已有超级管理员时不重复授予。首发时误加的正式域名例外已按负责人要求移除。负责人已完成邮箱验证和注册，其现有根权限保持不变。

[状态页](https://status.viprpg.org)已发布正式站的四项监控，网页、API、D1、R2 均记录为 operational，预生产监控及历史保留。[状态页发布运行](https://github.com/SomiaWhiteRing/VIPRPG-ZH-Archive/actions/runs/36208394737)在首次部署后的即时检查仍读到边缘节点旧配置，确认新配置和实际监控正常后重跑同一候选。

Kai 独立仓库提交 `0b5aabae5` 将 Android 来源切到 viprpg.org 并保留 staging；`c4bd3179e` 修复旧仓库路径的 Windows 构建缓存。WindyTranslator 提交 `1695373` 同步修改默认地址、构建元数据和 CI 变量，并已发布新版 Nightly。两个项目均保持人工版本号 2026.9.2，不覆盖已有正式版本；旧安装包需手动更新一次。网站软件版本、安装包与更新频道没有随种子导入，仍由负责人注册后在后台上传并发布；未配置频道的更新 API 返回 404。

主站定向 lint、类型检查、安全／UI 静态检查、正式构建及 CI 既有候选检查通过；Kai 本地 Android Java／资源编译通过，Windy 的 Python 编译、版本校验、构建元数据与 Windows 打包通过。没有新增测试用例或进行人工浏览器／真机交互，不将这些证据描述为真机验收。
