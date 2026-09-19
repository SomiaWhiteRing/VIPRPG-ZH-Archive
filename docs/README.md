# VIPRPG.org 项目文档入口

现行文档描述当前代码、数据模型和操作方式。研究、想法和历史记录单列，不能用其中的旧步骤初始化环境或推断功能已上线。

## 当前契约

- [产品方向](./product-direction.md)：产品边界和信息架构
- [操作反馈](./ui-feedback.md)：全局 toast、表单错误、加载与恢复状态的展示规则
- [资源与软件托管](./resources.md)：根管理员资源管理、原始包发布、平台推荐、下载与本站 Windy 更新协议
- [站内讨论区产品与界面设计](./forum-discussion-design.md)：单一帖子流、多 TAG、精品、单级楼中楼、搜索、权限与响应式界面
- [提醒产品与界面契约](./inbox-design.md)：讨论互动、角色申请、已读状态与未读入口
- [认证与权限基线](./authentication-authorization.md)：认证、角色、授权和审计边界
- [游戏领域架构](./game-domain-architecture.md)：Work、ArchiveVersion、关系、目录和公开查询
- [上传资料、发布声明与制作署名](./upload-metadata.md)：上传表单、署名、更多信息、偏好与恢复
- [RPG Maker 2000/2003 去重存储架构](./archive-storage.md)：上传、对象存储、下载和 GC
- [EasyRPG 在线游玩架构](./easyrpg-web-play-architecture.md)：浏览器安装、OPFS、Service Worker 和运行时边界
- [Android Kai 游戏导入](./easyrpg-android-import.md)：作品导入链接、快照清单与 Android 客户端接入边界
- [角色分类](./character-index.md)：角色身份、分类归属、管理权限与公开浏览
- [角色素材库](./character-material-library.md)：素材展示、多人绑定、排序与本地导入
- [角色脸图表情库](./face-emoji-library.md)：个人库、默认清单、热门统计与正文编辑

## 运行手册

- [Workers 与 React Router](./workers-development.md)：本地运行、binding、构建、部署和故障定位
- [GitHub Actions 自动部署](./github-actions-deployment.md)：CI 前置配置、触发方式和发布边界
- [维护与回归](./maintenance-regression.md)：最小检查选择、故障归因与回归入口
- [本地展示数据](./local-demo-data.md)：固定种子、演示账号、备份和恢复；快照格式见[种子说明](../data/local-seed/README.md)
- [论坛开发与数据维护](./forum-maintenance.md)：论坛契约检查与离线导出
- [角色素材采集](./character-material-collection.md)：来源页面、缓存、原图与归属清单

## 研究资料与人工笔记

- [资源栏目与工具更新托管开发分析](./research/download-center-development-analysis.md)：设计取舍、包体测量与客户端接入的研究依据；现行功能见资源契约
- [Kai 与 Windy 包体压缩分析](./research/tool-package-size-analysis.md)：原生库压缩与 RTP 内容去重的测量、实现取舍及已发布包体结果
- [角色历史游戏分析](./research/character-history-game-analysis.md)：已完成的提取与比较，保留待核实的资料接入候选
- [灵感笔记](../灵感笔记.md)：由人类开发者维护，AI 不编辑或迁移；内容不作为现行功能或排期承诺

## 历史记录

[归档目录](./archive/README.md)保存一次性数据整理和交付证据。当前规则已进入上面的领域文档；重复交付清单、旧分支集成指令和已失效的迁移步骤不作为维护入口保留。

## 维护方式

- 行为变更直接修订对应章节，删除被替代的描述，不在文末叠加纠正旧文的补丁说明。
- 命令与依赖以 [package.json](../package.json) 为准，路由以 [app/routes.ts](../app/routes.ts) 和 [Hono API](../app/.server/api.ts) 为准，结构以[统一初始化 SQL](../migrations/0001_init_archive_schema.sql)为准。
- 已完成计划中仍有效的规则并入现行文档；只有独有的来源、决策或操作证据进入归档，纯重复记录由 Git 历史保留。
- 文档移动或删除时同步修正链接和章节锚点。静态核对、历史验收和本次实际运行的检查分别说明，不能相互替代。
