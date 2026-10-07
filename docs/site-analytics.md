# VIPRPG.org 访问与网络体验统计

## 免费服务与资源

- GA4 标准属性：`VIPRPG.org`，属性 ID `557906831`；已有 Firebase 账号 `214846870` 下的新属性。
- 网站数据流：`VIPRPG.org`，`https://viprpg.org`，数据流 ID `16059115864`，测量 ID `G-2X5NL5DG0X`。测量 ID 不是凭据，不需要 Measurement Protocol secret。
- 属性报告时区：中国时间 UTC+8，事件数据保留已设为 14 个月。增强型衡量已关闭，页面与行为由网站显式发送，避免重复页面事件和原始搜索/外链采集。
- 免费 Data Studio 报表：[VIPRPG.org](https://datastudio.google.com/reporting/81c5595a-de9c-4a89-acfc-45ec143bc964/page/uAkAG)，官方 Google Analytics 连接器；不设置公开分享，不启用 Pro、360、BigQuery 或付费连接器。
- 访问概览页：日期选择、用户总数、每日用户和浏览趋势、国家/区域表、地区地图、按日期和事件名称分组的事件次数与涉及用户、设备类别、浏览次数，共 7 张图表；行为表按日期降序显示。网络体验页：安装结果分布圆环图，以及地区/线路/日期小时安装耗时热图表，共 2 张图表。没有采集数据时显示零/无数据，不填模拟数字。

## 网站候选与启用边界

报表使用原生自适应布局与顶部页签，九张图表的响应式组合均启用横向内容拉伸，填满可用区域。网络表使用均分列宽、表头换行和横向滚动，避免地区/ASN 等字段挤成窄条；保存后已在侧栏查看模式核对图表实际宽度。

本候选默认关闭。运行时仅在 `GA_ENABLED=true`、有效 `GA_MEASUREMENT_ID` 与 `GA_GATEWAY_PATH`、正式 origin/请求主机为 `https://viprpg.org` 且 `SITE_NOINDEX=false` 时返回配置。本地、预生产、iframe 和未列入公共页面白名单的路径不采集；原生 Android 安装任务未接入 GA。

按本次授权，满足正式公共页面条件时在后台固定插入异步 Google 标签。组件不渲染任何界面，不增加提示、按钮、页脚入口或用户操作，不读取或修改账户偏好。代码不设置 User-ID、Google signals 或广告个性化。所有事件 URL 去掉 query/fragment，标题使用固定栏目名，referrer 只保留 origin；自定义参数不上传 IP、账户 ID/邮箱/显示名、搜索原文、存档、文件路径或原始错误信息。Google 仍会接收网络请求并按 GA 规则处理请求信息。

正式发布前按 [AGENTS.md](../AGENTS.md) 和 [发布手册](./production-deployment.md) 预览并确认。CI 从 production Environment 的三个公开变量读取统计配置，生成器在已有资源配置上仅覆盖这三个变量；不重写 `PRODUCTION_WRANGLER_CONFIG_JSONC` 或入口试用配置。公开配置为 `GA_MEASUREMENT_ID=G-2X5NL5DG0X`、`GA_GATEWAY_PATH=/metrics`；只有已确认启用的正式候选写入 `GA_ENABLED=true`，未设置开关时工作流默认 false。本地正式发布使用相同三个 Wrangler vars。先启用下文的网关并验证健康端点，再发布带这三个变量的代码。回退可将开关设为 false 并发布，同时关闭网关；没有 DB migration 或业务数据修复。

## 事件与口径

| 事件 | 触发点 | 主要参数 |
| --- | --- | --- |
| `page_view` | 已完成的公共路由导航；查询条件变化也计一次 | `page_group`，粗粒度 edge 地区/ASN |
| `scroll_depth` | 当前页面首次达到 25/50/90% | `scroll_percent` |
| `download_click` | 详情页或列表的 ZIP/外部下载普通点击或中键 | `action_kind`、作品/版本 ID、`size_bucket` |
| `install_start` | 浏览器安装操作开始 | 作品/版本 ID、未压缩安装体积档 |
| `install_result` | 已持久化的 ready/failed/deleted，或安装前检查失败 | `install_outcome`、总耗时、各阶段汇总、重试数、体积/耗时档 |
| `play_start` / `play_result` | 开始启动／`player.ready` 成功或失败 | 作品/版本 ID、结果、启动耗时 |

`duration_ms` 为安装按钮到终态消息的时间，含前置检查；游玩结果中则为启动到 `player.ready` 的时间。`download_unpack_ms` 是各次 ZIP 请求开始到流式安装阶段结束的墙钟耗时，包含解包和写入背压，不能称为纯网络带宽。`network_wait_ms` 汇总响应头和 stream.read 的等待（含重连等待）；`write_ms` 汇总 pack 写入及索引写入。它们与并发操作/重试交错，不承诺相加等于总耗时。

`transferred_bytes` 是本次操作所有成功读取的 ZIP 字节，包含整包重试的重复读取；`retry_count` 合计整包重试与故障续传重连。汇总观察器只有在安装开始时采集已启用才运行；仅保留数值计数器，在 Worker 内不发送 Google 请求、不缓存 per-file trace。结果仍通过公共页面采集条件检查。

普通 ZIP 下载由浏览器下载管理器处理，只有点击可观察；外部下载同样不能确认完成。关闭/离开页面后没有终态的安装是“缺失结果”，不能自动归为网络故障。`install-finished` 表示 Worker 处理结束，成功依据是持久化 `ready`；现有业务游玩计数保持原语义。

## GA 自定义字段与网络报表

已注册 8 个事件维度：`page_group`、`edge_country`、`edge_region`、`network_asn`、`install_outcome`、`action_kind`、`size_bucket`、`duration_bucket`。维度显示名使用栏目、出口国家、出口区域、线路 ASN、安装结果、下载类型、体积档、耗时档等用途名称；属性、数据流和报表使用 `VIPRPG.org`。不将作品/版本 ID 注册成高基数分析维度。

已注册 6 个事件指标：`duration_ms`、`download_unpack_ms`、`network_wait_ms`、`write_ms`（时间/毫秒）；`transferred_bytes`（标准）、`retry_count`（标准）。连接器已刷新并识别 26 个新字段：8 个维度，以及每个指标的总量、Average、Count 版本；数据新鲜度设为每小时。自定义字段只用于注册后处理的数据。

网络分析页的两张图均过滤 `事件名称 = install_result`。圆环图按安装结果展示事件数占比，只覆盖已上报终态。热图表按 edge_country/edge_region/ASN、体积档、安装结果与原生“日期 + 时点 (YYYYMMDDhh)”分组；小时遵循属性 UTC+8 时区。success/error/cancel 分列，不混合计算成功耗时。表格显示事件数、平均总耗时/下载解包/网络等待/写入耗时，以及下载解包有效样本数，启用表头换行和横向滚动。均值使用连接器的原生 `Average …`，对应的 `Count …` 表示该指标有效样本数；没有发生网络传输的前置检查失败不会有下载解包耗时，不能拿所有事件数作它的均值分母。耗时档用于观察尾部情况，不把聚合均值或分档冒充精确 P95。同一份 GA 浏览器身份可多次安装，因此事件数与用户数含义不同。

## 大陆覆盖与限制

本候选通过第一方路径 `https://viprpg.org/metrics/` 加载标签，避免首次标签请求直接依赖 Google 域名。Google 官方说明为标签与部分测量请求走第一方基础设施，不能承诺所有 Google 依赖在大陆均可用；拦截器和网络故障也会造成样本偏差。GA 没有记录不代表没人访问；完全打不开网站的人也不会产生网页事件。`edge_region`/ASN 来自当前请求的 Cloudflare 元数据，表示出口线路位置，不是访客真实住址，未知值保留为 unknown。

Cloudflare 原生 Google tag gateway 免费，按整个 zone 生效。Google 标记 ID `G-2X5NL5DG0X`，度量路径 `/metrics`，**“设置标记”保持关闭**，由网站在正式公共页面后台固定加载。关闭自动设置不会给 staging/status 页面注入此标签；网关在其他主机上的端点可用不代表自动采集它们。采集代码不包含 DNS/入口切换或 Measurement Protocol 代理。

启用网关前需确认上述具体正式配置范围；启用后检查 `/metrics/healthy` 与 `/metrics/?validate_geo=healthy`，并验证实际脚本响应与测量路由。网关未启用、404 或 CSP/SDK 出错时，采集应停止且不能阻断业务操作。参考：[Cloudflare 官方说明](https://developers.cloudflare.com/google-tag-gateway/)、[Google 手动网关设置](https://developers.google.com/tag-platform/tag-manager/gateway/setup-guide?setup=manual)、[Google tag ID](https://support.google.com/tagmanager/answer/12326985)、[Google consent mode](https://developers.google.com/tag-platform/security/concepts/consent-mode)、[手动页面事件](https://developers.google.com/analytics/devguides/collection/ga4/views)、[禁止上传个人信息](https://support.google.com/analytics/answer/6366371)。

## 验证

候选执行 TypeScript、相关路径 ESLint、既有 UI 静态检查，没有新增测试。正式启用后按已批准范围验证静默标签加载、公共 SPA 导航、下载/安装事件与 GA 实时报告；真实大陆线路覆盖需要实际样本。Google/连接器的处理延迟不当作事件缺失证据。
