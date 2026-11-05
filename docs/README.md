# VIPRPG.org 项目文档入口

现行文档描述当前代码、数据模型和操作方式。研究、想法和历史记录单列，不能用其中的旧步骤初始化环境或推断功能已上线。

## 当前契约

- [产品方向](./product-direction.md)：产品边界和信息架构
- [个人喜爱展柜](./profile-showcase.md)：作品／角色／作者选择、排序、附言、公开边界与主页展示
- [账户偏好](./account-preferences.md)：外观、快捷入口、接收设置及下载偏好
- [时间线](./timeline.md)：动态来源、好友范围、首页选择、吐槽与互动
- [用户提及](./user-mentions.md)：评论与讨论的用户选择、身份引用和通知去重
- [短信箱](./private-messages.md)：一对一会话、图片、拒收、举报与未读状态
- [浏览器系统通知](./web-push.md)：浏览器订阅、Queue 投递、配置与启用边界
- [永恒之海](./eternal-sea.md)：公共聊天室、像素渲染、字体和管理边界
- [操作反馈](./ui-feedback.md)：全局 toast、表单错误、加载与恢复状态的展示规则
- [资源与软件托管](./resources.md)：根管理员资源管理、原始包发布、平台推荐、下载与本站 Windy 更新协议
- [站内讨论区产品与界面设计](./forum-discussion-design.md)：单一帖子流、多 TAG、精品、单级楼中楼、搜索、权限与响应式界面
- [提醒产品与界面契约](./inbox-design.md)：评论与讨论互动、申请、已读状态与未读入口
- [可申请角色配置](./requestable-roles.md)：固定种子的申请组、权限边界与环境差异
- [认证与权限基线](./authentication-authorization.md)：认证、角色、授权和审计边界
- [游戏领域架构](./game-domain-architecture.md)：Work、ArchiveVersion、关系、目录和公开查询
- [上传资料、发布声明与制作署名](./upload-metadata.md)：上传表单、署名、更多信息、偏好与恢复
- [RPG Maker 2000/2003 去重存储架构](./archive-storage.md)：上传、对象存储、下载和 GC
- [EasyRPG 在线游玩架构](./easyrpg-web-play-architecture.md)：浏览器安装、OPFS、Worker 本地播放器和运行时边界
- [浏览器已安装游戏与自动清理](./browser-game-storage.md)：安装列表、资源期限及本地数据兼容
- [Android Kai 游戏导入](./easyrpg-android-import.md)：作品导入链接、快照清单与 Android 客户端接入边界
- [角色分类](./character-index.md)：角色身份、分类归属、管理权限与公开浏览
- [角色素材库](./character-material-library.md)：素材展示、多人绑定、排序与本地导入
- [角色脸图表情库](./face-emoji-library.md)：个人库、默认清单、热门统计与正文编辑
- [浏览与游玩统计](./view-statistics.md)：去重口径、Durable Object 存储、读取缓存与合并
- [网站字体](./site-fonts.md)：字体来源、静态资源、分片与更新方式

## 运行手册

- [Workers 与 React Router](./workers-development.md)：本地运行、binding、构建、部署和故障定位
- [预生产初始化与验收](./staging-deployment.md)：当前访问入口、环境配置来源、干净种子与首次发布顺序
- [GitHub Actions 自动部署](./github-actions-deployment.md)：CI 前置配置、触发方式和发布边界
- [正式部署与数据维护](./production-deployment.md)：单人确认、正式候选、迁移、首次初始化和恢复
- [维护与回归](./maintenance-regression.md)：最小检查选择、故障归因与回归入口
- [本地展示数据](./local-demo-data.md)：固定种子、演示账号、备份和恢复；快照格式见[种子说明](../data/local-seed/README.md)
- [论坛开发与数据维护](./forum-maintenance.md)：论坛契约检查与离线导出
- [角色素材采集](./character-material-collection.md)：来源页面、缓存、原图与归属清单
- [上传素材引用清理](./resource-cleanup.md)：固定清理规则、缺失诊断、RTP 补充及报告复核
- [安装性能诊断](./install-diagnostics.md)：诊断入口、日志采集、安装阶段与开销边界
- [访问与网络体验统计](./site-analytics.md)：采集配置、事件口径与验证边界

## 研究资料与人工笔记

- [资源栏目与工具更新托管开发分析](./research/download-center-development-analysis.md)：设计取舍、包体测量与客户端接入的研究依据；现行功能见资源契约
- [Kai 与 Windy 包体压缩分析](./research/tool-package-size-analysis.md)：原生库压缩与 RTP 内容去重的测量、实现取舍及已发布包体结果
- [角色历史游戏分析](./research/character-history-game-analysis.md)：已完成的提取与比较，保留待核实的资料接入候选
- [灵感笔记](../灵感笔记.md)：由人类开发者维护，AI 不编辑或迁移；内容不作为现行功能或排期承诺

## 历史记录

[归档目录](./archive/README.md)保存一次性数据整理和交付证据。当前规则已进入上面的领域文档；重复交付清单、旧分支集成指令和已失效的迁移步骤不作为维护入口保留。

- [正式上线调整记录](./production-readiness.md)：2026-09 首次上线、环境隔离及当时的验证结果
- [2026-11 功能验收](./development-review-2026-11.md)：已完成的用户验收及移出范围
- [RTP-only 清理记录](./rtp-cleanup.md)与[全素材清理实验](./resource-cleanup-experiment.md)：历史策略与空间、耗时对照
- [作品公开性依赖审计](./work-publicity-dependency-audit.md)与[优化核算报告](./work-publicity-cost-report.md)：指定基线下的分析、取舍和测量
- [WindyTranslator 更新演练](./windy-update-rehearsal-2026-09-23.md)：2026-09 的实际更新与恢复验证

## 维护方式

- 环境地址以[预生产手册](./staging-deployment.md#环境地址与配置来源)为入口；代码白名单、被忽略的本地配置和历史发版记录不能证明域名已部署或可访问。
- 行为变更直接修订对应章节，删除被替代的描述，不在文末叠加纠正旧文的补丁说明。
- 命令与依赖以 [package.json](../package.json) 为准，路由以 [app/routes.ts](../app/routes.ts) 和 [Hono API](../app/.server/api.ts) 为准，结构以 [migrations](../migrations/) 中的首发基线和有序迁移链为准。
- 已完成计划中仍有效的规则并入现行文档；只有独有的来源、决策或操作证据进入归档，纯重复记录由 Git 历史保留。
- 文档移动或删除时同步修正链接和章节锚点。静态核对、历史验收和本次实际运行的检查分别说明，不能相互替代。
