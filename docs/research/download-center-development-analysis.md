# 资源栏目与软件托管：设计依据

日期：2026-09-18。首期资源管理、本站安装包托管、版本发布和 Windy 更新 API 已实现。当前模型、接口、操作和验收边界见[资源与软件托管](../resources.md)；本文只保留设计取舍、测量与来源依据，不作为另一套功能契约。

## 栏目与管理范围

栏目最终命名为「资源」，同时展示软件与有用的站外网站。软件和网站共享图标、名称、介绍、排序及可见性，仅软件具有版本和安装包。因此将最初工具专用主表的建议收敛为统一 `resources`，与版本、附件、平台推荐共四张业务表。

管理采用现有根身份，不新增可转授的业务权限。公开页面延续已经确认的紧凑卡片；详细安装说明、版本记录和文件校验信息放在软件详情，避免重新堆回列表。

用户明确要求：**本站显示版本、更新顺序和更新说明由本站控制，不跟随 GitHub。** `applicationBuildId` 仅帮助识别真实构建，不是版本号或排序依据。上传来源可以是本地构建或管理员取得的上游包，站点不建立 Release 同步器、webhook 或 CI 发布令牌。

## 单请求流式上传的依据

Cloudflare Workers isolate 的内存上限为 128 MB；Free／Pro 经 Cloudflare 进入 Worker 的请求体上限为 100 MB。R2 自身支持更大的对象，不会消除入口限制。不能沿用游戏 blob 的整包 `arrayBuffer()` 上传方式。

配套项目曾经超过该入口上限，后续已在另一个任务完成包体压缩。以下是当时测量与发行快照，不表示永远最新：

| 产物 | 压缩前字节数 | 压缩后／后续已记录字节数 |
| --- | ---: | ---: |
| Windy Windows ZIP | 144,158,333 | 压缩后 80,378,895；增加检查更新入口后的发行包为 80,414,882 |
| Kai Android APK | 126,835,404 | 压缩后 56,739,901 |
| Kai Windows Player.exe | 22,464,512 | 当次分析无需额外压缩 |

详细测量和 CI 证据见[包体压缩分析](./tool-package-size-analysis.md)。现有包体适合将网站单文件上限定为 **95,000,000 字节**，预留入口余量；客户端构建 CI 的 100 MB 上限不代表 95–100 MB 产物也能上传本站。

因此首期采用单请求、长度受控的流式 PUT，由 R2 检验 SHA-256，配合状态确认和原始文件下载；不增加 multipart 会话表、合并队列或全局软件包去重。未来实际出现超限包后再设计这些能力。

## 与游戏归档分开的原因

游戏归档会筛选文件、去重并重组 ZIP；EXE、APK 和完整工具 ZIP 需要保持原始字节，尤其不能重打包已签名 APK。软件使用 `tools/artifacts/` 命名空间及独立发布生命周期，复用现有 D1／R2 环境。

原归档扫描只认识 canonical 游戏对象，新增工具对象原本会被报告为未知对象；游戏 GC 本身按数据库引用及固定 key 清理，不能将原状描述为「必然误删工具包」。现已将工具对象交给资源后台独立核查，并保护复用 blob 的资源图标引用。

下载地址不可变和撤回需要共同设计。首期每次下载先查公开链，再读取 R2，使用 no-store；不使用长期公开缓存绕过撤回，也不把 HEAD、Range 或重试次数当作安装人数。

## 客户端已经存在的约束

Windy 首版更新客户端在配套仓库已经实现检查、下载进度、取消、长度／摘要校验及手动安装指引。网站按其 `/api/tools/windy-translator/updates/stable/windows-x64` 和 schemaVersion 1 接入，不能自行改成包含包格式的 target。

客户端要求说明与文件都使用同源 HTTPS，且仅接受小于 100 MB 的 ZIP。首次手动解压的包没有本站安装事实，客户端通过随包 build-info 的 applicationBuildId 请求唯一映射。未知或多义构建不能被标记为已安装最新版。

自动安装另行实施：Windy exe 同级含 `Works/`、`dict/`、配置、日志，`tools/` 同时容纳内置与用户添加的工具；Windows 中运行着的 EXE／DLL 也无法简单覆盖。后续更新助手需要明确管理文件清单、保留用户数据、签名验证、退出协调和失败恢复，不能把本期文件下载冒充自动替换。

Kai 首期提供 Windows／Android 原始包。未来承诺 Android 覆盖升级前，需要明确包名、versionCode 和签名身份；本站版本名不能替代 Android 系统的安装版本比较。Android 游戏导入是另一项已经接入的功能，见[相关契约](../easyrpg-android-import.md)。网站 Web runtime 继续独立发布，后台软件推荐不切换在线播放器。

## 成本量级

按照上述压缩产物估算，一组 Windy ZIP、Kai APK 和 Windows EXE 约 0.160 GB；保留 50 组约 8 GB。按当时核实的 Standard R2 单价 $0.015／GB-month，仅对象存储约 $0.12／月，未扣免费额度，也不包括游戏存储、操作请求、Workers 和 D1。免费额度由账户共同使用。

R2 标准存储免互联网出口流量费，但客户端更新检查、文件请求、Range 重试和 PUT 仍消耗相应请求配额。首期优先保证发布可靠性和正确下载，不提前引入复杂去重或自动删除历史。

## 来源

仓库与客户端依据：

- [资源现行契约](../resources.md)、[产品方向](../product-direction.md)、[认证与权限](../authentication-authorization.md)、[归档存储](../archive-storage.md)
- [统一初始化 SQL](../../migrations/0001_init_archive_schema.sql)、[资源领域服务](../../app/.server/resources/)、[固定开发种子](../local-demo-data.md)
- [Windy 更新协议](https://github.com/SomiaWhiteRing/WindyTranslator/blob/main/docs/website-updates.md)
- 本机相邻 `RPGRewriter-Ownuse` 的 WindyTranslator.spec、core/updates.py、ui/update_dialog.py、打包工作流与工具目录说明
- 本机相邻 `Player` 的 README、Android Gradle、签名配置、Nightly 工作流和打包脚本
- [Windy 2026.9.1](https://github.com/SomiaWhiteRing/WindyTranslator/releases/tag/v2026.9.1) 与[增加更新入口的构建](https://github.com/SomiaWhiteRing/WindyTranslator/actions/runs/35271175784)

公开资料曾于 2026-09-18 通过直接 HTTP 核实；限制和计费仍以供应商最新文档为准：

- [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- [R2 限制](https://developers.cloudflare.com/r2/platform/limits/)
- [R2 Workers API、Range 与校验和](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [R2 计费](https://developers.cloudflare.com/r2/pricing/)
