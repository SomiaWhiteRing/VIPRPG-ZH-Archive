# 历史记录

这里保留已结束工作的来源与操作证据，不定义当前产品契约，也不提供新环境初始化或旧分支集成步骤。文中的数量、分支、路径和检查结果只适用于记录发生时；被忽略的 `output/` 产物不随仓库分发。

| 记录 | 保留价值 | 当前入口 |
| --- | --- | --- |
| [展柜选择器试点](./2026-09-showcase-combobox-evaluation.md) | 试点前后对比及当时异常 | [共享选择器](../ui-feedback.md#共享选择器) |
| [复杂选择器迁移](./2026-09-complex-picker-evaluation.md) | 迁移范围、交互复测与未测边界 | [共享选择器](../ui-feedback.md#共享选择器) |
| [公共组件整理](./2026-09-shared-components.md) | 重构范围、快照基线及当时的静态检查 | [运行与架构](../workers-development.md)、`app/components/` |
| [论坛本地开发](./2026-09-forum-local-development.md) | 图片模型切换范围、演示数据来源及当时的核对结果 | [论坛维护](../forum-maintenance.md)、[固定种子](../local-demo-data.md) |
| [角色数据整理](./2026-09-character-data.md) | 分类转换、名称选择与补全的历史范围及证据位置 | [角色分类](../character-index.md)、[素材库](../character-material-library.md) |

待核实的资料接入仍属于[研究](../research/character-history-game-analysis.md)，不因提取报告完成而视为导入完成。

## 框架迁移后退役的说明

`18600ecf` 将 Next.js／OpenNext 替换为 Hono、React Router SSR 与 Cloudflare Vite 插件，后续修正随 `a8aff3b3` 合入。旧框架手册在该迁移提交中已删除；其余领域文档保留当前规则，仅替换失效的实现说明。

| 历史内容 | 退役范围 | 当前入口 |
| --- | --- | --- |
| 原 `docs/opennext-cloudflare-development-path.md` | 整篇框架运行手册退役：OpenNext adapter、`worker.mjs`／`.open-next` 请求链、自引用 binding、开发与预览分工、Windows 复制 workaround | [Workers 与 React Router](../workers-development.md) |
| 原 `AGENTS.md` 的 Next.js 自动生成规则块 | Next.js 专用代理指令已随迁移删除 | [仓库约束](../../AGENTS.md) |
| 认证、论坛和提醒文档中的旧框架说明 | Server Component／App Router 身份读取、旧页面壳和首帖加载方案、旧 API 文件路径及 `router.refresh()` 表述 | [认证](../authentication-authorization.md)、[论坛](../forum-discussion-design.md)、[提醒](../inbox-design.md) |
| EasyRPG 页面直接挂载 canvas 的说明 | 生命周期修正 `a8d304ab` 已采用同源 iframe；旧“不使用 iframe”要求退役 | [EasyRPG 运行时](../easyrpg-web-play-architecture.md#11-easyrpg-runtime) |
| README、部署和回归手册中的旧工具链说明 | Next／OpenNext 命令、产物目录及开发故障定位方式 | [快速开始](../../README.md)、[部署](../github-actions-deployment.md)、[维护与回归](../maintenance-regression.md) |

旧手册仅在 Git 历史中保留，可从仓库根目录执行 `git show 18600ecf^:docs/opennext-cloudflare-development-path.md` 查阅，不复制为另一份运行指南。Work／ArchiveVersion、D1／R2 归档对象、权限和论坛产品规则不因替换框架而整体作废。
