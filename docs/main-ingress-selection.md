# 主站大陆入口自动优选

目标为 `https://viprpg.org` 的页面、API 和公开下载。已部署版本取消下载按 ASN 转往旧域名的分流与跨域换源，全部通过主站，保留同源超时、取消及强 ETag/Range 续传；界面、进度、登录 origin、存档和 ZIP 协议不变。

2026-10-06 已按负责人授权发布同源产品并实施24小时入口试用：香港时间23:20:48将主站切为灰云 A `8.35.211.227`，试用到期为2026-10-07 23:20:48（香港时间）。正式Worker版本为 `ff38e592-869a-48f1-b7f3-634e303c2ccc`，原 `PRODUCTION_WRANGLER_CONFIG_JSONC` 的Custom Domain基线未改。12项DNS及指定入口HTTPS核验通过，覆盖首页、robots、健康接口、DB/R2与8 KiB ZIP Range，下载内容摘要一致；实际大陆三网表现及大包持续吞吐仍待观测。

主站同源产品核验后，两个额外下载域名的DNS、Routes及独立 `viprpg-download` Worker已删除并回读确认，没有删除业务数据。恢复材料已保存。六小时选点与15分钟到期巡检工作流已推送，两个repository开关已启用。三网六点的新IP分段下载均返回有效206，HTTP到HTTPS跳转正常；大包持续速度仍待一天观测。试用到期仅恢复主站managed Custom Domain接入，继续运行新的同源下载产品，不恢复这两个废旧入口。

两个旧入口已撤销，不保留历史 relay。`download.viprpg.org`、`download-asia.viprpg.org` 的已保存链接会在DNS缓存过期后失效；已打开或缓存旧安装器的页面可能仍尝试旧域名，下载中断后的重试也可能失败。需要刷新主站页面或重新生成主站下载链接。已经安装的游戏及用户存档不因入口撤销而删除。

## 启用边界

主站现已临时迁移为原 Worker的精确 `https://viprpg.org/*` Route及 TTL 60的owned灰云 IPv4 A。配置的 `trial` 记录唯一 `id`、`startsAt`、`expiresAt`，并在配置中记录原 Custom Domain身份 `originalDomainId`；不能靠是否存在灰云记录无限延长试用。六小时自动选点受 `MAIN_INGRESS_AUTO_ENABLED=true` 控制，到期巡检受 `MAIN_INGRESS_TRIAL_ENABLED=true` 控制；工作流文件存在不代表开关已启用。手动 report不写 DNS。

`PRODUCTION_WRANGLER_CONFIG_JSONC` 始终保留原 managed Custom Domain基线。本次不把该 secret永久改成Route。构建准备阶段仅在 `MAIN_INGRESS_CONFIG_JSON` 中的试用有效时覆盖生成配置的routes；到期不再覆盖，prepare自然选择原Custom Domain。使用试用Route构建及发布前分别检查至少10分钟余额，不足时停止该次试用发布。staging接入不变。

六小时选点程序只在试用有效期内更新owned A的content，到期不再PATCH；apply缺少trial时在任何网络请求前拒绝执行。它不迁移接入、不部署 Worker、不改证书或数据。独立的15分钟到期巡检负责恢复主站Custom Domain，职责和写入范围见后文。

灰云 A 指向 CF 入口是社区实践。官方 [Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/) 要求 proxied DNS，故实测可用不代表长期支持，也不保证固定机房、全省可用或 Chinaz全绿。单一地址不能给三网各自分配不同入口。

## 测量与切换

[main-ingress.yml](../.github/workflows/main-ingress.yml) 每六小时执行，对应香港时间 02:17、08:17、14:17、20:17。公开仓库标准 GitHub runner不依赖维护者电脑或 Codex对话。

1. 从 [WeTest免费 API](https://www.wetest.vip/page/api/get_cloudflare_ip.html) 取三网候选，最多三个新 IPv4，并始终比较当前地址。整源不可用时尝试已测备用候选；拒绝非官方类型、私网、陈旧或未来时间、异常响应。
2. 地址必须属于实时 [CF公布 IPv4段](https://www.cloudflare.com/ips-v4/)，或经 RIPE当前 AS13335/AS209242公告与非 invalid RPKI核验。unknown明确记录，不能解释为已验证 ROA或长期所有权保证。无法核实时停止。
3. 用 [Globalping官方 API](https://globalping.io/docs/api.globalping.io) 按大陆 AS4134、AS4837、AS9808家庭网络各请求两个 ready IPv4测点，再严格核验返回六点、每网两个不同城市。公开库存隐藏 IPv4能力，不能先按库存城市挑点。同一批六测点重复两轮，验证真实本站 Host/SNI、可信 TLS及完整 ASCII `/robots.txt` 内容，比较扣除 DNS用时的小型 HTTP响应。运行器自身速度不参与排名。
4. 两轮均改善至少20%且50ms，各运营商及单点没有明显退化，才进行健康优化；最短持有12小时。故障恢复需两轮同一节点可重复故障、合格候选及独立合格回退地址，并保护仍健康的节点；恢复可以绕过健康优化的持有期。
5. 候选和回退地址均做两轮4096字节公开 ZIP Range的206、强 ETag、长度、区间与完成状态检查。ZIP响应不能明显退化。写前再检查两个地址、额度和维护窗口；缺测、异常或没有收益都保留 DNS。
6. 仅在24小时试用仍有效时PATCH已登记 A record的 `content`。核对 account/zone、trial身份及时间、Worker/Route ID、唯一 owned灰 A、TTL、无额外 AAAA/CNAME或冲突 Route、无 managed Custom Domain，以及有效证书。与正式发布和到期恢复共用 `production-maintenance`互斥组，不自动取消正在执行的维护。
7. 保存原状态、PATCH acknowledgement和readback，等待TTL后用大陆测点验证正常 DNS下的本站 HTTPS。失败时仅回退仍完全匹配本次写入的记录，避免覆盖人工更改。PATCH回应不确定时保留证据供人工检查，不盲目写第二次。

只使用匿名免费测量，不传 Globalping token以免额度耗尽后消费 credits。每次本地上限120个 probe tests，写前保留回退额度；当前匿名免费额度为250个/小时，共享 runner IP可能被其他任务消耗，余量不足则停止。

Globalping把 body解码为 UTF-8，并在10000字符终止读取。因此仅对 ASCIIcanary做精确内容验证；ZIP只能验证小分段元数据与完成状态，不能冒充二进制摘要或大包持续下载速度。六点抽样不代表全国；覆盖不足时不降级为单运营商。

## 配置

填写 [main-ingress.example.json](../scripts/main-ingress.example.json)，真实配置/资源 ID留在忽略目录及 production Environment secret。在Custom Domain基线下执行report可省略recordId/routeId；试用期间apply必须登记当前唯一 A和精确 Route，以及trial的id/startsAt/expiresAt和原originalDomainId。archivePath选择已发布归档版本；样本撤回或协议改变时停止写入，重新核实后更换样本。

本次试用的production配置来源：

- `PRODUCTION_WRANGLER_CONFIG_JSONC`：保持原Custom Domain的正式资源基线，试用到期后仍能生成正常接入配置。
- `PRODUCTION_INGRESS_CONFIG_JSON`：试用资源与时间配置，工作流映射为 `MAIN_INGRESS_CONFIG_JSON`，用于有限期routes覆盖、六小时选点及到期恢复。
- `PRODUCTION_INGRESS_API_TOKEN`：本次复用已验证入口读写权限的运维凭据，单独保存于production Environment；原正式发布凭据不改。工作流映射为 `INGRESS_CF_READ_TOKEN` 和需要写入时的 `INGRESS_CF_DNS_TOKEN`。

选点工作流的两个INGRESS环境变量映射同一个已验证运维凭据，到期巡检则显式映射为 `CLOUDFLARE_API_TOKEN`；不能解释为已经创建专用只读或DNS Edit token，也不能声称该凭据没有Worker或其他正式权限。程序通过严限定的account/zone/资源身份及HTTP方法、路径allowlist约束自身操作；未来再拆分最小权限token。配置不能输出凭据或把它写入公开artifact。

本次批次已取得明确试用与入口撤销授权；完成验收后才设置repository variable `MAIN_INGRESS_AUTO_ENABLED=true`。本地report显式提供 `INGRESS_CF_READ_TOKEN` 与 `node scripts/select-main-ingress.mjs --config output/main-ingress/config.json`；脚本不自行回落部署token。apply另需显式的 `INGRESS_CF_DNS_TOKEN`、启用变量和已批准范围下的 `--apply --confirm viprpg.org`；开关不能代替人的确认。

报告与原始测量保存在忽略目录 `output/main-ingress-selection/`，GitHub artifact保留七天。持有期使用 DNS modified_on，不新增 DB/KV或自动提交循环。

## 24小时迁移与到期恢复

本次迁移已备份Custom Domain/关联DNS、Routes、证书、Worker版本与绑定、production配置及HTTP/IPv6状态，并完成同源产品和入口核验。已解除主站Custom Domain、在同Worker建立精确HTTPS Route及owned灰 A，发布同源下载产品并撤销两个额外下载入口。原 `PRODUCTION_WRANGLER_CONFIG_JSONC` 未改，由active trial临时覆盖生成配置；有限期试用配置决定到期恢复，自动任务是否启用仍须核对对应开关。

[main-ingress-trial.yml](../.github/workflows/main-ingress-trial.yml) 每15分钟在云端巡检到期状态，不依赖本机或Codex会话。到期恢复核实trial与目标资源归属后，先删除试用owned A，再通过Cloudflare公开的Custom Domain PUT API将原主站hostname绑定回同一个Worker；核实正常DNS及HTTPS健康后，才删除该次trial Route。身份、DNS或健康检查不一致时停止并保存证据，不删除不属于本次试用的记录。

若Custom Domain PUT返回明确的4xx JSON拒绝（不含408），且重新读取确认没有Custom Domain、没有其他主站地址、原Route仍在，则重建刚删除的A记录并检查HTTPS健康。补偿记录只使用刚读取的IP、TTL 60和灰云属性，comment包含本次trial UUID；下一轮巡检可识别其新记录ID并继续恢复，不需要修改secret。超时、连接中断、5xx或无法确认当前状态时不猜测写入结果，不盲目创建记录。补偿失败仍可能需要人工恢复，所有收据保存在工作流artifact。

共享`production-maintenance`的正式发布、选点、到期巡检、状态服务与Android正式任务使用`queue: max`，互斥执行并保留多个排队任务；`cancel-in-progress: false`本身不保护默认的单个pending槽位。

正常到期恢复不回滚产品代码，不重新部署旧版本，也不恢复两个下载域名或relay Worker。页面、API和下载继续使用新同源产品，只有主站入口回到CF正常managed DNS与IPv6。若另行决定回到包含旧分流的旧代码，则须先恢复对应下载DNS/Routes和relay资源，不能把这种完整旧版本回滚混同于试用到期。

不清理MX/TXT/CAA、D1/R2/DO、账号或存档。新入口只发布IPv4 A，原managed IPv6入口会改变，需要验证HTTP跳转及IPv6用户影响。保留现有apex证书并核实DCV续期；[解除Custom Domain不自动删除Advanced Certificate](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)，但不能对灰云入口未来证书呈现作官方保证。

试用期间生成的Environment routes为唯一 `{ "pattern": "https://viprpg.org/*", "zone_id": "<approved zone>" }`；IP只存在DNS，不能写回Wrangler。到期prepare使用未改变的Custom Domain基线，后续正常发布不会把试用Route永久写回。

停用自动选点前检查运行队列；关闭变量不会终止已在执行的维护，也不代表主站已经恢复。六小时selector到期不更新IP，15分钟巡检按本次已批准范围恢复入口；IP公告无法验证、测量故障、恢复资源冲突或PATCH outcome不确定时可能需要人工处理。

GitHub [schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) 可能延迟或丢任务，公开仓库六十天无活动会停用；15分钟巡检频率不承诺在expiresAt后一秒准确恢复，排队或检查失败可延后。试用到期时程序停止新的试用DNS写入，入口恢复须以云端DNS/HTTPS核验记录为准。[公开仓库标准runner免费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)，额外artifact存储及未来付费测量服务另计；无需购买优选IP。程序不使用Chinaz付费API或抓取ITDOG网页。
