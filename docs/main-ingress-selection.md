# 主站社区 CNAME 优选

主站已经是 Worker，采用作者[配套文章](https://b.acofork.com/posts/cf-fastip/#worker项目优选-最简单)的 Worker 方案：使用原正式 Worker 的 `viprpg.org/*` Route，将主站 DNS CNAME 到社区优选域名。页面、API 和公开下载仍使用 `https://viprpg.org`。

仓库已移除自建候选发现、Globalping 测量、DNS 自动选点和到期恢复代码。这里不运行选点任务，不维护固定 IP，也不新增 Worker 反代、SaaS 或 R2 公共域名。

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

`cf.090227.xyz` 是文章列出的社区入口，维护者负责更新其候选地址。本仓库不再扫描或修改它的地址。2026-10-08 已读到该域名的有效 CNAME/A 解析；这不是全国三网或完整大文件速度验收。

2026-10-08 的 Cloudflare 只读核对显示，旧试用已恢复为主站 managed Custom Domain，原试用 Route 已删除，主站 HTTPS 正常。当前这次代码清理和模板变更尚未切换正式 DNS、GitHub 配置或部署，需按[正式手册](./production-deployment.md#环境与授权)确认后执行。

## Wrangler 持久配置

正式配置使用：

```json
"routes": [
  { "pattern": "viprpg.org/*", "zone_name": "viprpg.org" }
]
```

应同步更新 production Environment 的 `PRODUCTION_WRANGLER_CONFIG_JSONC`，只替换其 `routes`；原 Worker、DB、R2、DO、邮件、限流、变量及其他设置从已核实的原配置保留。CI 不再读取旧试用配置，也不按时间覆盖 routes。

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
