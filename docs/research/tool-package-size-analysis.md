# Kai 与 WindyTranslator 包体压缩分析

日期：2026-09-18。状态：两个客户端均已完成包体与发版流程修改，已发布 Nightly 和 `2026.9.1` 正式版，原型测量保留用于解释优化依据。

首次压缩发版结果：Kai APK 为 56,739,901 字节，WindyTranslator ZIP 为 80,378,895 字节，均低于 100,000,000 字节。Kai 保留全部四种架构与音色库；Windy 保留六套离线 RTP，通过共享内容存储减少重复，并已同步修改“安装乱码 RTP”。后续版本工作流重建会产生少量大小差异，当前附件的精确值以各 Release 的清单为准。

| 软件 | 上一发行包 | 本次发行包 | 提交与发布 |
| --- | ---: | ---: | --- |
| Kai Android | 126,835,404 字节 | 56,739,901 字节 | [58a912e59](https://github.com/SomiaWhiteRing/Player/commit/58a912e59a3b1db3cf3a348269b36873cb9e996c)；[Nightly](https://github.com/SomiaWhiteRing/Player/releases/tag/nightly) |
| WindyTranslator Windows | 144,158,333 字节 | 80,378,895 字节 | [e648f6f](https://github.com/SomiaWhiteRing/WindyTranslator/commit/e648f6f18c1783e85fa0d39eacde9b47fe88f7b7)；[Nightly](https://github.com/SomiaWhiteRing/WindyTranslator/releases/tag/nightly) |

两条 GitHub 发版流程均成功，并在发布前检查了 100 MB 上限。温蒂现有相关检查通过；“安装乱码 RTP”通过现有工具宿主的命令行入口完成 465 个文件、13,696,720 字节的安装，重复执行也成功。未进行 UI 或 Android 实机验收。

## 后续发版流程改造

按用户追加要求，两个仓库都在根目录新增 `RELEASE.md`。第一行是 `# 2026.9.1`，表示 2026 年 9 月第 1 个版本；后续正文填写当前版本日志。每次发布分支提交或在该分支手动运行工作流，都会更新 Nightly，并覆盖或新建文件中指定的正式版本。

| 工具 | 发布分支 | 版本文件 | 正式标签 |
| --- | --- | --- | --- |
| Kai | `my-feature-stable` | [RELEASE.md](https://github.com/SomiaWhiteRing/Player/blob/my-feature-stable/RELEASE.md) | [2026.9.1](https://github.com/SomiaWhiteRing/Player/releases/tag/2026.9.1) |
| WindyTranslator | `main` | [RELEASE.md](https://github.com/SomiaWhiteRing/WindyTranslator/blob/main/RELEASE.md) | [v2026.9.1](https://github.com/SomiaWhiteRing/WindyTranslator/releases/tag/v2026.9.1) |

最终 [Kai 构建与发布](https://github.com/SomiaWhiteRing/Player/actions/runs/35266959156) 和 [Windy 构建与发布](https://github.com/SomiaWhiteRing/WindyTranslator/actions/runs/35266967299) 均成功，提交分别为 `b043463e9`、`0ec1ad7`。最终 Kai APK 为 56,739,909 字节、Windows exe 为 22,464,512 字节、Web ZIP 为 11,264,222 字节；Windy ZIP 为 80,378,472 字节。

已核对 Nightly 与正式标签均指向对应最终提交，两个正式版均显示为 GitHub Latest，发布清单与 GitHub 附件摘要一致，两渠道使用相同二进制。同版本更新沿用了原 Release ID。完整核对记录保存于忽略目录 `output/package-size-analysis/calendar-release-results.json`。

同版本覆盖标签、日志和附件；换版本号创建新 Release，保留此前版本。正式版本按数值比较并设置 GitHub Latest，Nightly 保持预发布。各平台固定构建同一个提交，发布前检查分支是否仍指向该提交，跳过过时构建；同一次构建同时用于 Nightly 和正式版。

每个 Release 附带 `release-manifest.json`，记录版本、提交、工作流运行、附件长度和 SHA-256；上传后核对 GitHub 返回的大小与摘要。新 Release 先创建草稿，附件齐全后再公开。同版本覆盖不会保留旧附件，追踪问题需同时记录提交 SHA，不能只记录版本号。

实际发布时出现过上传进程长时间不返回，因此增加单附件 5 分钟超时、最多 3 次尝试、文件级进度日志和发布任务 30 分钟总上限。GitHub 对已有 Release 的多附件覆盖不提供原子操作，中断后允许通过同版本重跑恢复。

年月版本只表示分发版本，不代替 Kai 的 EasyRPG 基础版本、Android versionCode 或签名身份。Kai APK 沿用现有 debug 签名。网站仍独立管理版本、说明与发布顺序，不从这些文件或 GitHub Release 自动同步。

## 测量结果

| 对象 | 当前测量 | 优化结果或估算 | 证据性质 |
| --- | ---: | ---: | --- |
| Kai 本机 APK | 114,957,021 字节 | DEFLATE level 9 后估算 50,215,451 字节 | 对 APK 中全部原生库实际压缩，未重新签名／安装 |
| Windy 六套 RTP ZIP | 81,647,867 字节 | 去重原型 17,068,963 字节 | 实际生成的资源容器，含资源映射 |
| Windy 整包 | 已核实 GitHub 发行大小 144,158,333 字节 | 约 80 MB 量级 | 结合现行 RTP 节省量估算，尚未完成整包重建 |
| Kai Windows exe | 已核实 GitHub 发行大小 22,464,512 字节 | 已低于 100 MB | 无需为本目标缩减功能 |

上表保留优化前的测量依据。本机 Kai 样本与当时的 GitHub 发行包不同，因此其 50.2 MB 估算不等于最终结果；实际发版后以本文开头列出的包大小为准。

测量与发布证据位于忽略目录 `output/package-size-analysis/`，包括 `kai-size-result.json`、`rtp-size-result.json` 和 `release-results.json`。`rtp-content-dedup-size-prototype.zip` 只是早期原型；正式资源库由 Windy 的 `scripts/pack_rtp.py` 构建，大小为 17,070,879 字节。

## Kai：压缩原生库，保留四种架构

本机 APK 中，原生库以 ZIP STORE 方式保存，占 100,144,696 字节：

| 架构 | 当前原生库字节数 | DEFLATE level 9 后 |
| --- | ---: | ---: |
| arm64-v8a | 26,515,168 | 8,802,414 |
| armeabi-v7a | 19,290,988 | 7,833,737 |
| x86 | 27,546,588 | 9,570,087 |
| x86_64 | 26,791,952 | 9,196,888 |

原生库合计可节省约 64.74 MB。推荐在 `Player/builds/android/app/build.gradle` 配置 Android Gradle Plugin 的 `packaging.jniLibs.useLegacyPackaging = true`，通过正常构建、对齐和签名流程生成 APK。

项目使用 AGP 8.13.2，官方 8.13 API 文档明确该选项会压缩 APK 中的 `.so`；未配置时，minSdk ≥ 23 默认使用未压缩、按页对齐的原生库。本项目 minSdk 为 23，现有包体与此行为一致。

这是下载体积与安装占用之间的取舍：安装器需要解压原生库，安装耗时与安装后占用可能增加。它不减少 CPU 架构，不改引擎功能，也不需要移除 7.56 MB 的随附音色库。

不要直接修改现成 APK 后当作可安装文件发布：ZIP 改动会破坏原签名。最终体积应以项目正常构建产物为准，并保持包名、版本码与签名身份连续。Android 实机安装、启动与不同设备上的兼容性尚未验证。

按架构分别打包可以作为进一步优化，但并非达到 100 MB 目标的必要条件；不必先增加用户选择包型的负担。

## Windy：六套资源保留，重复字节只存一次

现行 `modules/RTPCollection/` 的六个 ZIP 有 3,764 个文件条目，按文件内容 SHA-256 去重后只有 944 份独立内容，重复条目为 2,820 个。独立内容解压后合计 21,203,586 字节。

原型使用一个普通 DEFLATE ZIP，包含每份独立内容和六套资源各自的文件映射。实际大小为 17,068,963 字节，比原始六包少 64,578,904 字节。它使用 Python 标准库即可读取，无需引入 7z 解压依赖，也不要求联网获取资源。

不能简单删除“重复 RTP 包”：相同图像、声音或音乐可能以不同文件名服务于不同游戏。内容可以去重，六套资源的逻辑身份、文件名原始字节、安装顺序与编码处理必须保留。

实现建议：

1. 在资源构建步骤生成独立内容容器和每套 RTP 的索引，保留文件顺序与原始文件名信息。原型只用于证明节省量；正式格式还应明确目录、格式版本、大小与摘要规则。
2. `core/external/rtp.py` 继续负责选择某套 RTP、解析该套资源的路径编码和安装规则，读取内容改为通过索引定位共享文件。
3. 保持当前 GBK、Big5、CP932 等路径处理，以及仅补充缺失文件的安装行为。尤其不能把“原始文件字节相同”误当作“安装目标路径也相同”。
4. 同步调整 `tools/install_mojibake_rtp/`。它目前显式要求 `RTPCollection/2000fix.zip` 存在；只改主程序安装器会破坏这个工具。
5. 修改 PyInstaller 的资源收集，最终发行包只携带去重容器及必要索引，不把原始六个 ZIP 又一起收进去。
6. 所有优化只影响随程序分发的资源，用户字典、配置与 `Works/` 不参与去重或清理。

简单提高外层 ZIP 压缩等级无法获得同样收益：六个已经压缩的 ZIP 会遮蔽其内部重复内容。按需下载 RTP 可以进一步缩小首次下载，但会改变离线使用能力，达到当前目标不需要先采用它。

本机现有 `dist/WindyTranslator` 约 7.50 GB，包含 Torch、TensorFlow、CUDA 等大量内容，目录结构也与当前 README 中的 `_internal` 布局不同。因此它不适合作为当前发行包的基准，不能把清理这个旧目录当作已优化了公开发行包。后续正式打包应使用干净的构建环境，仅安装当前 requirements 所需依赖。

## 对下载中心方案的影响

两个正式发行包现已低于 95,000,000 字节。如果网站首期采用这一上传限制，可先采用单请求流式上传，暂缓 multipart 上传会话。此时应简化模型，不必先实现没有消费者的分片恢复流程。

“单请求上传”仍不应读取完整安装包到 Worker 内存：Workers isolate 的 128 MB 是并发请求共享的内存预算，不是一个 95 MB 请求可以独占的安全额度。仍需要流式写入、实际长度限制、完整性校验与发布前可用状态确认。

95 MB 是建议的产品余量，不是重新定义 Cloudflare 的限制。未来新增工具超出限制时，再增加分片上传。

## 验证范围

Kai 经正常 Android 构建与签名流程，检查了包大小、四种架构、随附音色库和原生库压缩方式。Windy 经干净 CI 环境构建完整发行 ZIP，通过大小检查；资源库保留原始文件名字节和顺序，安装时验证资源长度及 SHA-256。

本次没有新增测试代码、进行 UI 或浏览器操作。执行了既有非 UI 检查、源码编译检查和工具宿主命令行安装。Android 实机与 GUI 验收仍按用户授权边界单独进行，不以构建成功代替。

参考：

- [Android Gradle 8.13 JniLibsPackaging](https://developer.android.com/reference/tools/gradle-api/8.13/com/android/build/api/dsl/JniLibsPackaging)
- [WindyTranslator 发行页](https://github.com/SomiaWhiteRing/WindyTranslator/releases/tag/nightly)
- [Kai 发行页](https://github.com/SomiaWhiteRing/Player/releases/tag/nightly)
- [下载中心开发分析](./download-center-development-analysis.md)
