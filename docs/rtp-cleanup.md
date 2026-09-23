# RTP-only 清理历史记录（2026-09-23）

当前上传已改为默认全素材清理，见 [resource-cleanup.md](resource-cleanup.md)。本文保留此前实现与测量口径；下文的默认行为和命令描述对应历史版本。

全素材清理的独立实验及三组对照见 [resource-cleanup-experiment.md](resource-cleanup-experiment.md)，不改变这里的默认上传策略。

上传默认检查原版 RTP，用户可在选择文件前关闭。该步骤只排除已知 RTP 指纹匹配且通过引用检查的文件；非 RTP、改名副本、修改或重新编码的资源不参与清理。现有文件白名单仍独立执行。游戏数据、地图、运行程序、说明和 StringScripts 不因引用分析而删除。

## 清单来源

`lib/archive/rtp-catalog.json` 来自 WindyTranslator 的 `modules/RTPCollection/rtp-content.zip`。生成器校验每份 blob 的长度和 SHA-256，记录源 ZIP、源 manifest 的摘要、六个包的条目数和指纹。客户端不包含 RTP 图片或音频。

```powershell
python scripts/generate-rtp-catalog.py --collection ../RPGRewriter-Ownuse/modules/RTPCollection/rtp-content.zip --liblcf ../liblcf
```

候选需要目录/原始名称、长度、SHA-256 同时命中；清单收录源包使用的中文、日文、英文及繁体名称，并保守识别已有错码名称。不用像素相似度、感知哈希或文件名独立判定。未命中也不等于自定义文件，只表示本版不清理。

`lcf-scan-schema.json` 由 liblcf 的标准结构与指令定义生成，记录提交、输入文件摘要；许可随 `/licenses/liblcf/COPYING` 发布。采用小型 TypeScript 只读访问器，不加载完整播放器或增加 WASM 依赖。升级清单、schema 或分析语义时同步提升分析版本和文件策略版本。

## 保守引用规则

- 哈希后识别候选，没有候选则跳过解析。扫描 LDB、LMT、所有 LMU 和根 INI，复用核心文件缓存。
- 遍历数据库所有记录、地图所有页面、公共/战斗事件、自动移动路线及事件参数内嵌的移动路线。所有字符串都可保护同名候选，不推断事件可达性或数据库记录是否实际登场，也不按资源类别缩减字符串匹配。
- 使用 UTF-8、CP932、GB18030、Big5、韩文和西欧编码解码结果的并集保护资源。明确声明不支持的编码则保留全部候选。
- 动态图片或资源字符串扩展参数保护相应目录；未知指令、未知字段、可疑扩展命令、插件、解析不完整或超过分析预算则保留全部 RTP。无法解释的地图树也会保留。没有“跳过未知字段后仍认为分析完整”的行为。
- WindyTranslator 的 StringScripts 是导出/导入文本，不是 RPG_RT/EasyRPG 运行时执行的脚本；其存在本身不关闭分析。自定义扩展出现时另按保护规则处理。
- 不假设浏览器或下载用户安装了 RTP，不删仍被引用的随包资源。任意修改的 EXE 内部加载行为无法由静态扫描证明；已知补丁信号会停用清理，上传者也可关闭此项。

排除操作按路径执行，然后重建 blob 集合。即使删除路径的内容和其他保留文件相同，也不会移除仍被引用的 blob。核心包不改变。

## 上传、恢复与服务端

上传任务增加“检查 RTP 引用”阶段。结果含分析版本、清单来源摘要、候选数量、排除路径/大小/hash、保护目录和原因；随 manifest 与 IndexedDB 草稿保存。UI 展示数量、空间和可展开的明细。关闭后结果为 null。

source-ready 校验排除项是否真属于清单、路径是否仍在归档中、统计是否一致，并在现有核心 ZIP 逐文件校验时再次扫描其实际字节，不新增一次 R2 下载。被服务器判断为仍有引用或无法安全判断的排除请求会失败。commit 绑定已通过 source-ready 的完整 manifest 摘要，包括清理结果。服务端无法确认客户端未上传的原始字节，指纹报告不构成原始包的完整性证明。

本站不保存源 ZIP；清理后的下载、网页安装共用一个归档。恢复被排除文件需要重新选择原始游戏并关闭清理，不修改用户本地游戏，不为此生成第二套服务器归档。

## 核验

`npx tsx scripts/rtp-cleanup-check.ts` 覆盖精确指纹、非 RTP 保护、数据库与地图引用、嵌入移动路线、动态加载和未知格式保留，以及不合法报告。

对只读游戏目录生成空间与分析耗时报告：

```powershell
npx tsx scripts/rtp-cleanup-analysis.ts 'D:/通关存档/[醤油]膳' output/rtp-cleanup/zen
```

已有隔离流程增加 `--archive-only`，跳过与上传无关的编辑器流程及官方 TestGame 专用存档菜单动作，仍执行真实上传、刷新恢复、提交、取消、删除恢复、GC、原生下载逐文件校验、OPFS 安装/刷新和游戏启动。每次使用独立 D1/R2；必须串行运行。`--keep-rtp` 使用产品的关闭选项建立对照，`--report` 保存耗时、体积、清理记录、截图及运行日志。

```powershell
npm run build
npx tsx scripts/system-self-check.ts flow --game output/rtp-cleanup/zen/source.zip --archive-only --keep-rtp --report output/rtp-cleanup/zen/flow-original.json
npx tsx scripts/system-self-check.ts flow --game output/rtp-cleanup/zen/source.zip --archive-only --report output/rtp-cleanup/zen/flow-cleaned.json
```

这是本机回归和成本采样，不是全剧情通关、线上网络性能或线上 R2 计费测量。实际新增存储和上传节省取决于已有对象去重；下载与安装按路径保存，减少的文件体积更直接体现于这两项。

## 实测：[醤油]膳（2026-09-23）

只读输入为 `D:\通关存档\[醤油]膳`。原目录有 1,446 个文件、68,328,873 字节；现有白名单保留 1,440 个文件、68,087,094 字节。以下对照从同一白名单结果开始，原有 6 个排除项不计入 RTP 清理收益。流程用此结果生成的 `output/rtp-cleanup/zen/source.zip`，没有改动原游戏目录。

WindyTranslator 六份 RTP 包的 3,764 个文件条目、944 个不同内容全部通过长度和 SHA-256 检查，生成 2,989 组路径/长度/摘要指纹。本游戏命中 465 个候选，保留有引用的 10 个，排除其余 455 个；不需要触发未知格式或动态引用保护。所有未命中指纹的文件均保留，下载结果对每个保留文件做了字节一致性校验。

| 空间与请求 | 关闭清理 | 开启清理 | 减少 |
| --- | ---: | ---: | ---: |
| 归档文件数 | 1,440 | 985 | 455 |
| 文件内容合计 | 68,087,094 B | 54,806,407 B | 13,280,687 B（19.51%） |
| 实际下载 ZIP | 65.1033 MiB | 52.3881 MiB | 12.7152 MiB（19.53%） |
| 浏览器 OPFS 游戏包 | 42.7097 MiB | 30.0443 MiB | 12.6655 MiB（29.65%） |
| 去重后游戏对象及核心包 | 46,490,789 B | 46,488,714 B | 2,075 B |
| 首次上传对象 PUT 数 | 667 | 666 | 1 |
| source-ready 清单 JSON | 472,292 B | 381,455 B | 90,837 B |

OPFS 项只统计 `packs` 中的游戏数据，不包括索引、IndexedDB、播放器或存档；网页安装原先就跳过 EXE、DLL 等文件，因此比原生下载小。对象体积按空存储、内容去重计算，不包含封面、最终 manifest 和平台计费元数据。455 个排除路径中有 454 个仍有相同内容的保留路径，例如 `Backdrop/草原.png` 对应 `Backdrop/u8349u539f.png`；这些改名副本不符合候选条件。这解释了下载和本地安装显著变小，而服务器游戏对象只少 2,075 B。每份归档实际的服务器新增占用还会受跨游戏去重影响。

| 本机流程耗时（单次采样） | 关闭清理 | 开启清理 |
| --- | ---: | ---: |
| 选择文件至 source-ready | 50.515 s | 43.158 s |
| 其中客户端 RTP 检查 | 无 | 0.351 s |
| 其中服务端 source-ready 请求等待 | 0.210 s | 0.923 s |
| 原生 ZIP 生成与下载 | 7.938 s | 7.145 s |
| 网页安装至 ready | 8.567 s | 8.572 s |

两轮串行执行，分别创建独立 D1/R2 和 Chromium 上下文，没有复用对方的上传对象。操作系统缓存和运行负载没有隔离，因此不能把上传总耗时的下降归因于清理：上传内容几乎相同，哈希和上传阶段本身也有波动。安装时间本次基本持平。服务端项含请求与原有完整校验，不能作为新增扫描的 CPU 时间或线上计费预测。

独立进程中复用已读取字节分析一次耗时 122 ms，后续五次为 78–99 ms；浏览器 351 ms 还包含调度让步和进度更新。哈希复用上传原有步骤，不额外哈希所有资源。静态 RTP 清单加 LCF schema 共 350,696 B，分别 gzip 后共 81,068 B（79.17 KiB）；这只是新增元数据体积，不等于完整打包产物或每次上传的流量。

两轮均通过真实上传、刷新恢复、提交、取消、删除恢复、GC、原生下载逐文件校验、浏览器安装/刷新和游戏启动。另用独立 `lcf2xml`（编码 936）解析复制到输出目录的 37 个核心文件，检查 2,169 个 XML 文本节点，没有发现被排除资源的名称。边界检查、定向 ESLint、TypeScript 和生产构建通过。

标题与开场房间两对 PNG 的 SHA-256 分别完全一致，均进入 `Map0002.lmu`。两轮同样出现 `Font/Font`、`Font/Font2`、`Logo/LOGO1` 查找信息、片头 AVI 播放失败及 `CharSet/hokozen` 尺寸警告；这些是基准已存在的运行问题，本次没有修复，也没有将其认定为清理引入的问题。此核验不代表全剧情或所有存档可用。

本地证据保存在 `output/rtp-cleanup/zen/`：`analysis.json`、`flow-original.json`、`flow-cleaned.json`、两组标题/开场截图和 `.runtime.log`、`xml-verification.json`。两份流程报告的告警数组在完成后按保存的原始日志重新提取，以补全原脚本未匹配到的 `Cannot find`、`Couldn't` 和 `out of bounds` 文案；原始日志、耗时和结果未改变。
