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

## 外部状态与上线边界

只读核对时，本地和 GitHub main 基线为 ce2288d42425e5fbacadfd62f2ced70641f80859。GitHub 仅有 staging/status Environment；main 未设置保护。Cloudflare 的旧正式 Worker 仍使用 Workers.dev origin，存在既有 prod D1/R2，但 viprpg.org 尚未绑定，不能认定这些数据库为空或已适配当前 schema。

已通过 GitHub API 创建 production 并更新 status Environment：唯一确认人为 SomiaWhiteRing，允许本人自审、禁止绕过确认、只允许 main 发布；staging 无审批保护，main 仍未增加分支保护或 PR 限制。未运行任何发布 workflow。

production 的三项专用 secrets 尚未填入：需先确认实际首发资源与专用 token，再配置。旧仓库及 staging/status 凭据保持原状，未复制旧 prod 配置来启用正式发布；生产 job 缺少专用凭据时会停止。实际首发的资源／凭据设置属于下一次明确批准的上线批次。

旧 prod 库的只读账本核对返回已登记 0001、没有其他待应用文件；这仅核对名称，不证明历史同名 schema 与当前基线一致。已有资源保留到明确批准初始化方案后再处理。

首次上线尚需确定正式数据基线、备份恢复方案和受控根账户初始化，确认实际邮件送达；正式网站、状态服务、Android Release 与网站软件频道分别按已批准范围执行。独立 Kai 项目的 APK 白名单与设备验收不由本仓库修改自动完成。

本次未运行人工 UI／浏览器操作或新增测试用例，未部署 Worker、发布 APK、迁移或编辑线上业务数据。已运行定向 lint、主站和状态服务类型检查、由隔离目标配置生成的 staging／production 两种构建和最终绑定校验，以及干净种子准备；种子候选在忽略的 output/production-setup/seed-candidate，用户和作品均为零。构建、只读计划和 GitHub 设置各自记录实际结果，不代表完整线上／设备验收。
