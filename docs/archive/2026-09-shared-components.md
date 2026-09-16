# 公共组件整理记录

历史记录：下文只说明整理发生时的范围、分支和检查结果。当前组件以 `app/components/` 为准，不按历史分支重放集成。

## 当时的工作范围

- 分支：`codex/shared-components`。工作树：`VIPRPG-ZH-Archive-components`，与开发中的 `VIPRPG-ZH-Archive` 分开。
- 快照基线：`383cbcb907a0bdb1cb3a86e53425767bb02773de`，父提交 `08b891416fe5215d8b8aa60f59eb49fc78cafbe3`。快照包含审阅时尚未提交的角色页面、索引、权限、数据等内容，不属于公共组件重构。
- 原工作区的文件、分支和暂存区未被本次重构写入。没有推送、合并或部署。

## 已完成范围

沿用仓库级审阅编号，共 18 组。

| 编号 | 内容 | 实现与边界 | 提交 |
|---|---|---|---|
| 1 | 选择器基础行为 | 五个选择器共享输入法保护、上下键/Escape、选项容器、活动项滚动；Enter 的创建/关联逻辑留在领域组件 | ed3f2821 |
| 2 | Dialog | 普通弹窗共享 Overlay、Content、Title；裁剪器、抽屉等保留定位、滚动和焦点行为 | 74d57481 |
| 3 | Notice | 28 处提示共享成功/错误外观与默认 alert/status 语义，调用方继续管理请求状态 | 74d57481 |
| 4 | 作品展示片段 | 六处 WorkThumbnail；游戏库/目录条目共享 WorkListSummary，下载、编号、管理、剧透保持领域组合 | 17a5088f |
| 5 | InfoRow | 作品、作者、角色详情共享定义列表的资料行 | 74d57481 |
| 6 | ImageLightbox | 论坛/角色素材共享缩放、动画、关闭和中文标签；分别保留计数/下载插件、像素渲染 | 10d2fbdd |
| 7 | AuthPageShell | 登录、注册、找回密码、重置密码共享页面容器 | afe27f17 |
| 8 | 认证字段与标签 | 邮箱、验证码、密码输入共享；新密码前后端均为 12–256 位；FormField 必填 controlId，并补齐现有调用的控件 id | afe27f17 |
| 9 | AccountField | 修改密码/邮箱共享横向字段行 | 74d57481 |
| 10 | 用户评论摘要 | 私有/公开评论共享 CommentSummaryList，公开过滤和权限仍在服务端页面/查询中 | 17a5088f |
| 11 | 用户目录摘要 | 私有/公开目录共享 CatalogSummaryList，可选描述内容 | 17a5088f |
| 12 | EmojiGrid | 评论和论坛共享表情网格；加载、插入光标与编辑状态由编辑器管理 | 10d2fbdd |
| 13 | SectionNavigation | 作品/作者共享链接型分区导航；与切换面板的 Radix Tabs 保持不同语义 | 74d57481 |
| 14 | StaffCreditRow | 上传/后台共享署名行；职务范围、校验、备注、提交格式及增删后焦点由调用方管理 | 4545fd83 |
| 15 | 评论组件归位 | CommentPanel 从作品路由移入 components/comments，更新作品、作者、角色、游玩页引用 | af0fab41 |
| 16 | 编辑组件归位 | 选择器、token 输入、媒体、语言字段移入公共领域目录；去掉 TokenPicker 对上传类型的依赖 | af0fab41 |
| 17 | 用户资料组件归位 | AccountSection、AccountWorkGrid、AccountEmpty、DiscussionList 移入 components/profile | af0fab41 |
| 18 | 复用 Badge/EmptyState | Badge 使用行内元素并增加 subtle/credit 变体；搜索结果、署名标签和账户空态接入已有组件 | 74d57481 |

另外将角色索引的动态缩进、树线和按测量宽度分列放入 TreeIndent、TreeGuides、ColumnGrid，解决原有四处 UI 静态检查违规，没有放宽检查规则。

## 验证

- 快照基线及最终代码：`node node_modules/typescript/bin/tsc --noEmit --project tsconfig.check.json` 通过。
- 各批次涉及的 TypeScript/TSX 文件：既有 ESLint 配置检查通过。
- `node --import tsx scripts/ui-self-check.ts` 通过，最终扫描 212 个页面/组件文件；基线为四处角色索引内联样式违规。
- 认证批次后运行 `node --import tsx scripts/security-self-check.ts` 通过。
- 检查旧模块引用、提交差异和 `git diff --check`；未保留旧路径转发兼容层。
- 未新增测试，未运行浏览器、人工 UI、D1/API/Worker 检查、全套测试或构建。静态检查不能确认视觉效果、焦点体验和触摸交互；后续 UI 验证仍需另行授权。

## 主要复核点

后续 UI 验证建议关注中文输入法确认、选择器滚动及 Escape、嵌套弹窗焦点恢复、12 位密码边界、署名行切换自定义职务、看图缩放/下载与角色索引分列。业务大文件仅抽取已有复用职责，没有创建统一的上传/论坛/游戏运行状态机。
