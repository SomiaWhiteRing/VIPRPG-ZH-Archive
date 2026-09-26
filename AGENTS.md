# Project constraints

- 远端访问入口与配置来源见 [docs/staging-deployment.md](docs/staging-deployment.md#环境地址与配置来源)。不要从 Worker 名称、历史白名单或本地顶层配置推断当前站点地址。
- 本项目由一人维护。主站正式发布由负责人手动选择 `target=production` 并运行 workflow 即完成确认，候选检查通过后直接发布，不再要求 `Review deployments`；production Environment 不配置 required reviewers。Codex 代为触发仍须本次任务已有明确部署授权，不因技术上可运行而自行发布。不要求第二位审核人、强制 PR 或多人评审。预生产继续随 main 推送自动发布。
- 正式目标为 `https://viprpg.org`。Codex 执行正式部署、回滚、配置或凭据变更，以及 D1、R2、DO、后台/API 的数据写入、导入、修复、清理、恢复或根账户轮换前，必须取得用户对具体目标和操作范围的明确确认。先完成候选、适用检查、目标和影响预览；确认可覆盖明确批次，范围未变时不重复询问。修改代码或推送 main 不自动授权正式发布或正式数据操作；token、会话、`--confirm` 和 `CI=true` 不代替用户确认。具体入口见 [正式部署手册](docs/production-deployment.md)。
- 网站正常业务与已批准的既有自动任务仍按原权限及策略运行，不增加逐次运维审批。Codex 手动触发清理或修改自动任务策略仍遵守正式操作确认边界。
- 使用唯一当前领域模型；保护真实数据、已发布 API/manifest/更新协议和用户存档。为实际升级或回退所需的兼容不能当作废弃内部实现直接删除。
- `app/shared.css` 只存放网站与 Android APK 离线页实际共用的样式。新增或修改前核对两端入口、实际导入的组件和 Tailwind `@source`，并在对应样式块注释中记录两端消费者；仅被网站多个页面使用、位于 `components/ui` 或可能将来复用不算跨端共享。网站专用样式放 `app/globals.css` 或网站组件样式，Android 专用样式放 `android/web/`；失去一端消费者时移出共享文件，不为保留样式而扩大 Android 扫描或构建触发范围。
- EasyRPG Web runtime 只保留 `lib/archive/easyrpg-runtime.json` 指定的当前版本；升级使用导入脚本清理旧目录，保留版本化 URL 以隔离缓存，不并存发布旧运行时。
- `migrations/0001_init_archive_schema.sql` 为首发基线；正式初始化后冻结已应用文件，结构、内置权限和触发器通过后续有序增量迁移更新。固定开发种子同步 schema 与迁移账本。不得通过修改已登记的 0001 或重建正式库代替升级；备份、重建和恢复按批准范围执行。
- 分类、角色和归属关系是不同对象。修改当前分类库时先核实实际数据源及目标 ID；删除一个分类归属不代表角色没有其他归属。
- 默认运行与改动直接相关的最小既有检查，不默认新增测试，不将全套 check、test、build 或浏览器流程作为每项任务的验收。
- 共享状态的 D1、API、Worker 和浏览器检查串行执行；不用修改产品逻辑来掩盖夹具、环境或调度故障。
- 明确进行回归、维护诊断或测试设计时，按需查阅 [docs/maintenance-regression.md](docs/maintenance-regression.md)。
