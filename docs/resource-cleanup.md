# 上传素材引用清理

上传默认开启“清理未引用素材”，选项位于游戏文件拖拽区，使用 `InfoTooltip` 说明范围、例外、归档影响和恢复方式。用户可在选择游戏文件前关闭。浏览器以 `viprpg.upload.resource-cleanup.v1` 保存布尔选择；未设置时开启，刷新和重开页面后复用选择，同源标签页同步。存储被禁用时仍可在当前页面切换，不阻断上传。已开始和恢复的任务使用自己的清理结果，不受后续偏好变化影响。

## 范围

- 候选是标准素材目录中的图片、音频和视频，包括 RTP、自定义、修改版及改名副本；不再要求 RTP 指纹命中。
- 保留程序、数据库、地图、字体、Logo、配置、说明、翻译文本和未知目录；原有文件类型白名单独立执行。
- 扫描数据库全部记录、全部地图及事件、公共/战斗事件和移动路线，所有字符串引用都保护同名候选；不按剧情可达性继续删减。
- 多编码结果取并集。动态加载保护相关目录；插件、未知指令/字段、未扫描完整或超过预算时保留全部候选。
- 显示文章（含续行）及技能/物品名称中的标准 ExFont 前缀 `$A`～`$Z`、`$a`～`$z` 不视为扩展命令；这些字符串仍参与素材引用匹配。音效名、注释等其他字段，以及 `@`、`$[x,y]` 等可疑前缀继续保守保护。
- 静态分析不能证明任意自定义 EXE、补丁或旧存档的隐式资源需求；需要完整素材时关闭选项。

只从本次上传归档中排除素材，不修改本地原文件。下载和在线游玩仍使用同一份归档；需要恢复排除文件时重新选择原游戏并关闭清理。

## 数据与复核

`lib/archive/lcf-reference-scan.ts` 是共用只读 LCF 扫描器；`resource-cleanup.ts` 固定生产候选规则及报告版本 `resources-static-v2`。上传文件策略为 `rpgm2000-2003-resources-v6`，不接受旧策略的新提交。

客户端哈希后扫描已缓存的核心文件，排除未引用候选并重建 blob 集合；仍被其他保留路径使用的同内容 blob 不删除。任务增加“检查素材引用”阶段，统计、排除明细和保护原因随 `archiveVersion.resourceCleanup` 存入 manifest 和草稿；关闭时为 null。

服务端校验报告版本、允许的素材路径、摘要格式、重复项、统计及路径冲突，在现有核心包逐文件校验期间复核实际引用。仍被引用、核心未完整扫描或需要保护的排除项会被拒绝；commit 绑定 source-ready 验证后的完整 manifest 摘要。服务端不能证明客户端未上传的原始文件内容，报告不是原包完整性证明。

RTP 清单和 `rtp-cleanup.ts` 仅用于离线历史对比，不再引入生产上传或服务端校验。文件清单无需包含 RTP 图片/音频，也不需要在生产包中携带 RTP 指纹库。修改分析规则或 LCF schema 时同步提升清理版本和文件策略版本。

## 验证与历史对照

既有 `scripts/rtp-cleanup-check.ts` 同时检查 RTP 对照规则和当前全素材规则，包括引用保护、自定义素材、动态/未知结构回退和无效报告。`system-self-check.ts flow` 使用当前生产规则，`--keep-resources` 关闭清理；流程会检查默认开启、标签点击不触发文件选择、InfoTooltip、关闭/开启后的刷新持久化，再执行上传恢复、提交、下载和安装。

```powershell
npx tsx scripts/rtp-cleanup-check.ts
npm run build
npx tsx scripts/system-self-check.ts flow --game output/resource-cleanup/zen/original.zip --archive-only --report output/resource-cleanup/production/flow-enabled.json
npx tsx scripts/system-self-check.ts flow --game output/resource-cleanup/zen/original.zip --archive-only --keep-resources --report output/resource-cleanup/production/flow-disabled.json
```

2026-09-23 的三组空间实验见 [resource-cleanup-experiment.md](resource-cleanup-experiment.md)；此前 RTP-only 实现和实测记录见 [rtp-cleanup.md](rtp-cleanup.md)。这些是历史成本证据，不代表当前默认策略。

2026-09-24 接入核验使用《[醤油]膳》的同一原始白名单 ZIP，两轮在隔离 D1/R2 中串行执行。开启时排除 971 个文件，保留 469 个，排除路径/大小/摘要与此前全素材实验完全相同；关闭时保留全部 1,440 个文件，`resourceCleanup` 为 null。两轮均通过偏好刷新持久化、Tooltip 展示、控件点击不触发文件选择，以及实际上传、草稿恢复、提交、下载逐文件校验、安装/刷新和启动。此处的启动检查不代表全剧情或旧存档验证。

报告、说明弹层截图及运行日志位于 `output/resource-cleanup/production/flow-enabled.*` 和 `flow-disabled.*`。下载 ZIP 分别为 37,230,063 B 与 68,265,786 B，浏览器游戏数据包分别为 13,865,393 B 与 44,784,392 B；原游戏和输入 ZIP 未修改。边界检查、定向 lint、TypeScript、UI 组件规范检查和生产构建通过。
