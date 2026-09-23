# 全素材引用清理实验：[醤油]膳

这是 2026-09-23 的实验记录。2026-09-24 全素材模式已接入上传，当前策略与命令见 [resource-cleanup.md](resource-cleanup.md)；下文“生产仍只清理 RTP”和 `--keep-rtp` 是实验当时的状态。

2026-09-23，以 `D:\通关存档\[醤油]膳` 为只读输入，比较不做引用清理、只清理 RTP、清理所有标准素材。实验生成单独 ZIP，上传产品仍默认只清理 RTP；没有部署全素材模式，也没有改动原游戏。

## 实验边界

全素材模式将候选扩大到 RPG Maker 2000/2003 标准素材目录中的图片、音频和视频，包括非 RTP、修改版和改名副本。这里的“所有”是所有这些素材，不是删除一切未在 LDB 中出现的文件：地图、数据库、运行程序、字体、Logo、说明、配置和翻译文本都有隐式用途，保留；不识别的目录也保留。

两个清理模式复用同一只读 LCF 扫描器。扫描全部地图、数据库记录、公共/战斗事件及移动路线；所有字符串引用均保护同名资源，不分析剧情可达性。多编码取并集；动态引用、扩展和未知格式的保守保护规则相同。全素材入口仅位于实验脚本，生产 `RtpReferenceScan` 仍固定使用 RTP 精确指纹。

## 空间结果

原目录 1,446 个文件；三组均先使用现有白名单，得到共同基准 1,440 个文件。既有白名单排除的 6 项不计入引用清理收益。MiB = 1,048,576 字节。

| 指标 | 不清理引用 | 仅清理 RTP | 全素材实验 |
| --- | ---: | ---: | ---: |
| 保留文件 | 1,440 | 985 | 469 |
| 排除文件 | 0 | 455 | 971 |
| 文件内容合计 | 68,087,094 B | 54,806,407 B | 37,168,095 B |
| STORE 下载 ZIP | 65.1033 MiB | 52.3881 MiB | 35.5054 MiB |
| 浏览器游戏数据包 | 42.7097 MiB | 30.0443 MiB | 13.2231 MiB |
| 去重后游戏对象及核心包 | 44.3371 MiB | 44.3351 MiB | 34.8130 MiB |
| 不同内容的 blob 数 | 666 | 665 | 308 |
| 核心包 | 89,742 B | 89,742 B | 89,742 B |

相比只清理 RTP，全素材模式再排除 516 个文件：ZIP 再省 16.8828 MiB（32.23%），浏览器游戏包再省 16.8212 MiB（55.99%），去重后服务器游戏对象再省 9.5221 MiB（21.48%）。相比不清理，ZIP 共省 45.46%，浏览器游戏包共省 69.04%。

额外 516 个文件中，有 358 个和游戏内已识别的原版 RTP 内容相同，但路径未命中 RTP 清单；另外 158 个不属于这一组。这不是新增资源内容识别，而是引用检查允许实验排除这些改名副本和其他素材。额外排除最多的类别为 Sound 205、Music 100、Monster 63、CharSet 48、Battle 26、Backdrop 22、FaceSet 19。

例如片头存在旧名称与 `u81b3u30aau30fcu30d7u30cbu30f3u30b0.avi` 两份，事件引用后者，实验删除旧名副本，仍保留事件使用的 AVI。原游戏中的 `Player.exe` 约 21.42 MiB、`RPG_RT.exe` 约 0.71 MiB 均保留；网页安装本身跳过程序和说明文本，因此下载包仍有 35.51 MiB，而浏览器游戏包仅 13.22 MiB。

服务器体积按空存储的唯一游戏对象和核心包计算，不包括封面、manifest、索引或平台计费元数据；跨游戏去重会改变新增存储收益。OPFS 只统计 `packs`，不包含索引、IndexedDB、运行时缓存和存档。

## 分析开销和流程口径

同一进程复用读取、哈希后的文件，交替运行两种分析各六次：RTP 中位数 112.56 ms，全素材 154.64 ms，相差约 42 ms。两者都已遍历同一批核心数据，扩展候选集合没有增加一次地图扫描或资源哈希。首次调用分别为 206.36 ms 和 159.88 ms，但全素材在 RTP 之后执行，不当作独立冷启动对比。

浏览器流程对三份预先生成的 ZIP 使用相同 `--keep-rtp` 选项，关闭上传时再次清理，分别创建独立 D1/R2 与 Chromium 上下文，串行上传、下载和安装。这是在比较裁剪结果带来的后续成本，上传耗时不包括先前的离线分析及生成 ZIP，也不能等同于已接入上传页面的全素材功能。脚本同时记录原有哈希和上传阶段，单次时间受本机缓存与负载影响。

## 功能核验

三组均通过真实浏览器上传、任务刷新恢复、提交、取消、归档删除恢复、GC、原生下载逐文件字节校验、浏览器安装/刷新和启动，均进入 `Map0002.lmu` 开场房间。下载 ZIP 大小、安装数据包大小和文件数与离线分析完全一致。边界检查、定向 ESLint、TypeScript 检查和生产构建通过；生产 RTP 模式的 455 项排除报告与此前结果完全一致。

全素材组与不清理组的标题、开场截图分别字节一致。RTP 组的标题截图差异位于菜单闪烁光标区域，开场截图也与另外两组字节一致。三组原始日志具有相同的五条信息/告警：`Font/Font`、`Font/Font2`、`Logo/LOGO1` 查找信息、片头 AVI 浏览器播放失败、`CharSet/hokozen` 图像尺寸警告，没有出现本次裁剪新增的资源缺失。这些原有问题没有在本实验中修复。

## 重现和产物

```powershell
npx tsx scripts/resource-cleanup-experiment.ts 'D:/通关存档/[醤油]膳' output/resource-cleanup/zen
npx tsx scripts/rtp-cleanup-check.ts
npm run build
npx tsx scripts/system-self-check.ts flow --game output/resource-cleanup/zen/all.zip --archive-only --keep-rtp --report output/resource-cleanup/zen/flow-all.json
npx tsx scripts/system-self-check.ts flow --game output/resource-cleanup/zen/original.zip --archive-only --keep-rtp --report output/resource-cleanup/zen/flow-original.json
npx tsx scripts/system-self-check.ts flow --game output/resource-cleanup/zen/rtp.zip --archive-only --keep-rtp --report output/resource-cleanup/zen/flow-rtp.json
```

实验脚本输出 `original.zip`、`rtp.zip`、`all.zip` 和 `comparison.json`。报告记录源文件指纹、每种模式的排除明细、大小、候选保护原因、分目录统计及分析采样；重新打开三份 ZIP，检查保留路径和 SHA-256，并重新读取全部原文件确认输入未变。输出目录必须位于游戏目录之外。

独立核验复用先前 `lcf2xml --encoding 936` 的 37 份 XML，其对应的原始核心副本重新哈希，与本次游戏一致。从 schema 标记的字符串字段及事件/移动指令提取 3,029 个字符串（包括整数参数中嵌入的移动路线），未发现被排除名称，记录于 `xml-verification.json`。不把 XML 数字字段当成文件名，避免 `1.wav` 等文件与任意数值 1 产生假匹配。

该实验不证明全剧情、所有存档或任意自定义 EXE 的隐式加载都安全。它用于衡量保守静态分析扩大到全部标准素材时的实际收益；完整归档和只清理 RTP 的产物均保留供对照。
