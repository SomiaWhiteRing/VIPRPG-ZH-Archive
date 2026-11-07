# 主站社区 CNAME 优选

主站已经是 Worker，采用作者[配套文章](https://b.acofork.com/posts/cf-fastip/#worker项目优选-最简单)的 Worker 方案：使用原正式 Worker 的 `viprpg.org/*` Route，将主站 DNS CNAME 到社区优选域名。页面、API 和公开下载仍使用 `https://viprpg.org`。

## 配置与当前状态

| 配置项 | 简单方案 |
| --- | --- |
| 正式 Worker | 当前 `viprpg-zh-archive`，使用原正式资源绑定 |
| Worker Route | `viprpg.org/*`，区域 `viprpg.org` |
| DNS 名称 | `@`，即 `viprpg.org` |
| DNS 类型与目标 | CNAME `cf.090227.xyz` |
| 代理状态 | DNS only，灰云 |
| TTL | Auto；根域名 CNAME 由 Cloudflare flattening 处理 |
| staging | 继续使用原 `staging.viprpg.org` Custom Domain |

`cf.090227.xyz` 是文章列出的社区入口，其维护者负责更新候选地址。2026-10-08 已读到该域名的有效 CNAME/A 解析；这不是全国三网或完整大文件速度验收。

2026-10-08 已按负责人授权完成入口切换：原 Worker 的 `viprpg.org/*` Route 配合灰云 CNAME `cf.090227.xyz`，正式配置 secret 和本地配置同步为持久 Route。HTTPS 传播约 20 秒后恢复，九项正式 smoke 均返回 200；公开 ZIP 的 8 KiB Range 返回 206，ETag 和字节摘要与切换前一致。后续正式操作仍按[正式手册](./production-deployment.md#环境与授权)确认。

## Wrangler 持久配置

正式配置使用：

```json
"routes": [
  { "pattern": "viprpg.org/*", "zone_name": "viprpg.org" }
]
```

应同步更新 production Environment 的 `PRODUCTION_WRANGLER_CONFIG_JSONC`，只替换其 `routes`；原 Worker、DB、R2、DO、邮件、限流、变量及其他设置从已核实的原配置保留。CI 使用该配置中保存的 routes。

仅修改本地文件或模板不会更新 GitHub secret、Cloudflare Route 或 DNS。正式配置校验也接受原 Custom Domain，供实际回退；staging 仅接受其原 Custom Domain。

## 一次性切换

负责人确认目标与操作范围后，在 `production-maintenance` 无其他正式发布或维护操作时执行：

1. 保存当前主站 Custom Domain、DNS、Route、Worker 版本及正式配置。先停用并移除旧选点／试用恢复工作流，核实没有仍运行的旧任务。
2. 提交并推送这次代码清理；移除两个旧入口开关、两项专用试用 secret。只删除专用 secret 副本，不撤销可能被其他消费者使用的原 token。
3. 将原 Worker 绑定到 `viprpg.org/*` Route。保留当前网站代码和资源，不创建替代 Worker。
4. 解除主站 managed Custom Domain，移除它管理的主站占位记录，再创建 `@` CNAME `cf.090227.xyz`、灰云。保留 TXT、MX 等无关记录；不添加一条绕开该 CNAME 的独立 AAAA。
5. 同步正式配置 secret 的 routes，运行候选检查通过后的正式部署，核对其路由确实仍为 `viprpg.org/*`。
6. 核对根域名 A/AAAA、可信 TLS、首页、robots、健康接口和已发布 ZIP 的小段 Range。大文件吞吐和不同运营商表现应另行观察，不能用本地连接速度或小段 Range 证明。

从移除 managed DNS 到创建 CNAME 期间可能有短暂解析窗口，应在同一个维护批次连续完成；异常时按下面步骤恢复。

## 影响与回退

登录 origin、API、下载地址、安装器续传、ZIP 字节协议和用户存档保持原业务模型。R2 是正式 Worker 的私有绑定，不因换入口变成公共 bucket，也不需要 Cloud Connector。持续有数据进展的慢下载继续运行；超时、取消、强 ETag/Range 和故障重连处理保留。

社区 CNAME 把入口维护交给第三方，地址和线路质量可能变化。灰云入口是文章演示的社区实践；当前官方 [Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/) 文档仍要求 proxied DNS，不能把一次实测可用解释为长期官方支持。该方案减少自建维护成本，速度收益仍需实际观察。

回退使用同一个正式 Worker：先删除本次主站 CNAME，再恢复 `viprpg.org` managed Custom Domain；DNS 和 HTTPS 核验正常后删除这条简单 Route，并将正式配置 secret 的 routes 恢复成主站 Custom Domain。无需回滚业务代码或恢复已退休的下载域名。

既有 `npm run deploy:production -- --plan` 仅预览本地候选，`npm run smoke:production` 负责只读 HTTP 核对。所有正式操作遵守项目授权边界。

## 运行包入口的预生产验证

2026-10-25 的只读查询确认 `flatten_all_cnames=false`。使用电信、联通、移动网段作为 ECS 查询时，`cf.090227.xyz` 返回相应运营商的 CNAME 链，而根域名 `viprpg.org` 始终返回同一组普通地址；根域名 flattening 没有保留这次观测中的运营商分流。此结果解释了解析差异，不能单凭 DNS 记录推断实际吞吐。

按本次预生产测试授权，临时创建 `runtime-staging.viprpg.org` 的灰云 CNAME 到 `cf.090227.xyz`，以及 `runtime-staging.viprpg.org/play/runtime/easyrpg/*` 到已核实的现有预生产 Worker 的 Route。没有新建反代 Worker、公开 R2 或维护固定 IP。对应 ECS 查询保留了运营商 CNAME 链，HTTPS 与原运行包响应已核对。测试记录和可撤销的记录／路由 ID 位于本机 `output/startup-hydration-repair/`。

同一份 6,311,434 字节的 Brotli 音色库经 101 个探测节点进行对照，探测上限为 10 秒；电信完整传输由 22/30 提升至 30/30，但联通由 20/30 降为 14/30、移动由 24/29 降为 1/29。因此采用客户端按传输进度选择入口，不能全量替换为社区入口，也不能把超时／部分字节的 HTTP 200 当作完整下载。正式域名、Route 及持久配置的启用须有对应批准。

运行包备用入口目标由 [easyrpg-delivery.json](../lib/archive/easyrpg-delivery.json) 同时提供给网页和部署校验器：正式为 `runtime.viprpg.org`，预生产为 `runtime-staging.viprpg.org`。灰云 CNAME 指向 `cf.090227.xyz`，只将 `/play/runtime/easyrpg/*` Route 绑定到各自原有 Worker。两环境的 Environment 配置 secret 应保留已批准的额外 Route；部署校验只接受对应环境的这个精确路径，不接受另一个环境、其他域名或覆盖全部业务路径的宽泛 Route。原单入口配置继续可用于撤销备用入口的回退。

## 境外 CDN 对照候选

2026-11-07 复查了电信、联通、移动的 ECS 查询。主域名仍返回相同的两个 IPv4 地址，两个运行包子域均保留社区 CNAME 的运营商分支。正式及预生产各自的主入口和备用入口对当前 Brotli 音色库的 HEAD 请求均返回 200，ETag、编码和跨源响应头一致。两个预生产入口请求原始音色库的前 8 KiB 时均返回 200 和完整的 7,557,598 字节，ETag 一致。

2026-11-08 接入 `runtime-edgeone-staging.viprpg.org`，使用 [EdgeOne 全球不含中国大陆](https://intl.cloud.tencent.com/document/product/1145/63620)的 CNAME 模式。Cloudflare 灰云 CNAME 指向 `runtime-edgeone-staging.viprpg.org.eo.dnse4.com`；EdgeOne 使用免费 HTTPS 证书，HTTPS 回源至 `staging.viprpg.org:443`，回源 Host 使用源站域名。独立域名策略 `Runtime assets only` 拦截 `/play/runtime/easyrpg/*` 之外的路径。两个运行包文件通过 HTTPS 完整下载后与预生产主入口逐字节一致，保留 Brotli、ETag、CORS 和 `Timing-Allow-Origin`；根路径与 `/api/health` 均被 EdgeOne 拦截。

同一组 87 个大陆探针通过 HTTPS 下载同一份 6,311,434 字节的 Brotli 音色库，每个探针最多等待 10 秒。电信完整下载数为主入口 26/30、社区入口 16/30、EdgeOne 22/30；联通为 3/29、5/29、16/29；移动为 23/28、0/28、16/28。EdgeOne 在本轮最适合作为联通的候选备用线路，电信和移动保留预生产主入口优先。探测原始记录和中位速度位于本机 `output/edgeone-staging-probe/`。对照入口保持独立于客户端选路。

1. 接入客户端选路前，覆盖晚高峰复测，按运营商比较首字节、完整下载率和传输速度，区分 EdgeOne 缓存命中和回源请求。
2. 2026-11-08 在预生产 EdgeOne 规则 `2181426784` 增加公开样本 `/api/archive-versions/1/download` 的精确路径。三轮均使用同一组 87 个大陆探针，下载 1,859,365 字节的 ZIP。按主入口、首轮 `MISS`、复测 `HIT` 的顺序，电信完成数为 30/30、30/30、30/30，联通为 15/29、27/28、27/28，移动为 28/28、3/6、16/25。移动首轮 21 个 `HIT` 缺少实际接收字节数。热缓存下验证整包、匹配 `If-Range` 时返回 `206` 且字节一致、过期 ETag 触发整包重下、越界返回 `416`。原始数据位于本机 `output/edgeone-staging-probe/`。单独撤销 ZIP 试用时从规则移除此路径。撤销整个候选入口时删除候选 CNAME、所有权验证 TXT 和对应 CDN 配置。

同日将已公开的《GO TO HELL》复制到预生产归档版本 4，下载 ZIP 为 33,073,868 字节。当前出口使用 60 秒上限，两次 EdgeOne 整包均为 `MISS`，用时 48.53 和 48.03 秒，字节与预生产主入口一致。主动中断于 12 MiB 后，以原 ETag 续传剩余 20,490,956 字节，EdgeOne 返回 `206 HIT`，拼接结果与主入口一致。核对 [EdgeOne 免费版说明](https://edgeone.ai/document/70405) 后移除了大包路径，样本保留在预生产主入口。这轮未执行三网批量拨测。

## 匿名页面缓存验收

候选发布到预生产后，分别连续请求 `/`、`/explore`、`/games`，在同一边缘节点观察第二次请求的 `Server-Timing: public-page-cache;desc=HIT`。再确认带会话 cookie、iframe 请求头及查询参数的请求各自使用原处理路径，并核对预生产 noindex。边缘副本最多缓存 30 秒，发送给浏览器的响应保留 `private, no-store`。比较匿名首页 HTML 的模块预加载清单，确认时间线模块退出普通首页的静态依赖。
