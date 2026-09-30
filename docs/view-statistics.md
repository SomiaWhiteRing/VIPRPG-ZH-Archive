# 作品与主题浏览量、作品游玩统计

作品详情和在线游玩共享作品 ID；主题的所有分页共享主题 ID。页面实际可见时才上报浏览量。在线游戏引擎启动成功后另行上报游玩，匿名和登录用户均计入。作品统计栏、主题列表、数字格式和文字保持原样，评论数及收藏仍沿用原业务模型。

## 计数口径

- 服务端按 UTC+8 自然日去重：`日期 + 条目类型 + 条目 ID + 当日访客摘要`，成功接收的同一组合只累计一次。
- 作品浏览（`work`）、主题浏览（`topic`）和作品游玩（`play`）分别计数。游玩与浏览采用同一访客摘要，同一访客在同一天启动同一游戏只累计一次；跨日再次启动可再累计。计数是每日去重后的累计量，不代表永久去重的自然人数。
- 访客摘要为随机日盐作密钥的 HMAC-SHA256，输入是站点、Cloudflare 提供的 IP、User-Agent。不使用登录账号，不保存原始 IP/UA，不设置身份 cookie 或 localStorage。不能保证识别真实自然人：相同出口与浏览器可能合并，换网络或浏览器可能重复。
- 浏览器内存中的每日集合只减少重复请求；刷新、多个标签页和直接打开游玩页仍由 DO 最终去重。不轮询，不因单纯停留跨日自动增加一次。
- 游玩只在引擎 `ready` 后上报，访问游玩页、安装或启动失败不计入。每次成功启动均提交请求，以更新登录用户的最近游玩时间；匿名请求不写个人记录。统计失败仍更新有效登录用户的历史，统计接口返回相应错误，游戏启动不受影响。
- 两类上报入口均检查同源、正整数 ID、明显机器人 UA 和 IP 限流。浏览上报不查询条目是否公开或存在；游玩上报保留作品公开性检查。访问权限仍由原页面和业务 API 检查；成功上报不代表游戏确实运行，伪造请求仍可能产生计数，本方案不是反作弊系统。

## 存储与读取

每个 Worker 环境绑定一个 SQLite Durable Object 类 `ViewStats`，使用固定对象名 `site`。浏览和游玩共用该对象、日盐及清理机制，通过 `kind` 隔离计数，不新增 binding 或 D1 schema。生产、staging 和本地状态各自隔离。总数长期保存在 `totals`，当日随机盐和去重摘要按当天及前一天的保留窗口清理；分批清理或平台故障可能延后实际删除。日盐先安排过期 alarm 再入库；过期清理每批最多 5,000 条，必要时继续下一批，清空后不再唤醒。没有按条目扫描、五分钟任务或计数回写 D1。

已有登录账号的游玩人数保留为初始累计量：作品首次读取游玩数、按游玩排序或收到有效游玩上报时，将 `user_work_entries` 中该作品的现有游玩账号数通过 `INSERT OR IGNORE` 写入 `totals` 的 `play` 行。初始化和新增上报在 DO 中串行处理；初始化完成后不再把个人历史条数加到公共计数。D1 的游玩记录仅负责个人历史，并为尚未初始化的作品提供初始值。

展示时仅缓存匿名计数。边缘 Cache API 中 15 分钟内的计数直接复用，缺失或过期的 ID 每批最多 128 个通过一次 DO RPC 读取。首页、游戏列表、详情和游玩页使用同一游玩计数；“最多游玩”排序和“最多浏览”一样，由 DO 按完整筛选 ID 集排序后返回当前页。读取由真实页面请求触发，不主动刷新；Cloudflare 各机房缓存独立，可能提前淘汰，15 分钟不代表全球只请求一次。缓存保留期为 24 小时，DO 故障时优先显示已有旧值；没有旧值时浏览显示 `0`，游玩显示 D1 提供的账号初始值，该兜底值不写入 DO 或缓存，故障写入 Worker 错误日志。

同一日重复上报在 DO 中不会增加总数，也不会写入新的去重记录；它仍消耗 Worker/DO 请求以及去重查询。新计数写去重表和总数表，过期删除也计入 DO SQLite 写用量。前端内存去重、批量读取和缓存负责减少这些开销。额度由整个 Cloudflare 账号共享，不能只凭单站访问量承诺不超套餐；IP 限流也不是总费用硬上限。

## 作品合并

作品合并时同时累加浏览与游玩总数。先在 DO 初始化两个作品的游玩初始值，再执行 D1 的合并事务，避免个人历史搬迁／去重后丢失尚未导入的旧计数；初始化失败则不执行合并。D1 事务写入原有 `view_stat_merges` 待办；随后通知 DO 原子转移两类总数和尚未过期的去重摘要。DO 保存操作 ID，重复投递不会再次累加。转移完成后删除待办；失败由原有每日维护任务按 ID 顺序重试，每次最多 50 条。正常浏览上报和 DO／缓存计数读取均不访问 D1；游玩初始值来自页面已有的 D1 查询，游玩上报另行验证公开作品并读取初始值，登录用户同时更新个人历史。维护任务只读取这张小待办表，不扫描作品或主题。

历史累计总数沿用相加语义，无法对已清理的历史访客做跨作品重新去重。合并不会建立永久 ID 别名；源作品以后恢复或再次收到上报，将从新的计数开始。缓存中的合并前计数在下次过期读取时更新。

## 配置与当前 schema

`wrangler.example.jsonc` 声明 `VIEW_STATS` binding 和 SQLite `exports.ViewStats`。当前 Wrangler 支持声明式 exports，不再叠加 DO migrations 配置。生产和 staging 均需单独声明 binding，不设置跨 Worker 的 `script_name`。

`VIEW_RATE_LIMITER` 使用独立的、账号内唯一的数字 `namespace_id`，每个 IP 在每个 Cloudflare 机房每分钟最多 120 次上报；不能与认证邮件限流共用 namespace。部署 secrets 中的 `WRANGLER_CONFIG_JSONC` 也必须包含此绑定，配置生成脚本会检查。仓库固定限流策略，私有配置提供 namespace ID。部署前按[环境配置来源](./staging-deployment.md#环境地址与配置来源)核对账号中的实际 ID。

首发使用 `0001_init_archive_schema.sql` 基线及后续有序迁移，正式初始化后不改写已应用文件；现行模型不保留废弃 D1 计数表或双写。固定开发种子不包含 DO 计数。`db:local:reset` 一并清理本地 D1 和 DO，避免重用内容 ID 时串入旧计数；该开发规则不能用于清除正式累计量。正式 DO 身份、计数、备份／恢复与迁移须单独列入批准范围，D1 备份不涵盖 DO；见[正式手册](./production-deployment.md)。

实现依据：[DO SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)、[声明式 exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)、[环境隔离](https://developers.cloudflare.com/durable-objects/reference/environments/)、[Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)、[DO 定价](https://developers.cloudflare.com/durable-objects/platform/pricing/)。
