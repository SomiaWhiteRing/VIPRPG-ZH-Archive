# 资源、软件托管与更新接口

`/resources` 从数据库展示公开的软件与站外网站，沿用两列卡片、实际项目图标、RM2K 标题和右侧操作区。本站独立管理版本名、说明、文件、更新顺序及推荐位置，不读取 GitHub Release 来决定这些内容。

## 管理入口

`/admin/resources` 及每个管理接口仅允许当前活跃的根管理员。普通管理员的作品上传／管理权限不授予资源管理权。页面使用 `requireBootstrapAdminPage`，API 使用 `requireBootstrapAdmin` 的同源与会话检查，写入批次再次检查活跃根身份。

1. 创建软件或站外网站，填写固定名称。固定名称及类型创建后不修改。
2. 上传图标并保存名称、介绍、排序和显示状态。网站再填写完整 HTTP／HTTPS 访问地址即可公开。
3. 软件创建本站版本草稿，填写本站版本名与更新说明。
4. 登记平台、包类型、文件及可选构建标识，再上传安装包。文件校验完成后才能发布。
5. 发布时选择是否推荐给包所对应的平台，以及是否公开资源。Windows 与 Android 推荐互相独立。

版本名是管理员维护的文字，如「2026.9 修订版」。`releaseSequence` 是本站发布时在同一 D1 批次中分配的递增整数；客户端只用此序号比较本站更新顺序。GitHub tag、run number、原程序版本号、包名和构建 ID 均不参与排序。

已发布版本可修正显示名称和说明，不能替换安装包或改动序号。换文件须新建版本。撤回会暂停指向它的推荐并停止新下载，保留固定说明页与发布身份；首期不物理删除已发布历史。仅暂停推荐不会撤回历史下载。切换推荐到旧版不会提高旧版的序号，也不会让 Windy 自动降级。

发布、撤回、推荐切换和草稿清理在后台有确认步骤。多标签页修改通过资源整体 revision 防止覆盖；冲突后「重新读取」获取当前状态，并明确丢弃尚未保存的表单内容。

## 模型与存储

| 表 | 责任 |
| --- | --- |
| `resources` | 软件／网站的名称、固定名称、图标引用、介绍、地址、排序、显隐、编辑 revision、本站发布序号计数器 |
| `tool_releases` | 软件的本站版本名、说明、发布序号、状态、首次发布时间；首期仅 stable 渠道 |
| `tool_artifacts` | 原始文件、平台、格式、长度、SHA-256、构建标识及上传状态 |
| `tool_channels` | 每个软件／渠道／平台的推荐文件与 selection revision，空文件指针表示暂停 |

结构统一维护在 `migrations/0001_init_archive_schema.sql`。图标复用 `blobs`，公开媒体查询、SQL 防清理触发器、手动 GC 和定时 GC 均保护资源图标的有效引用，包括隐藏／草稿资源。图标为 PNG、最多 512 KiB，宽高各为 1–512px；保留比例及透明背景，后台草稿通过根管理员接口预览。

软件原始包存入私有 R2 的 `tools/artifacts/<artifactId>/<sha256>`。不走游戏 import job、文件白名单、解包重组或 core pack。工具对象由资源后台独立检查，通用归档扫描不再将此命名空间报告为异常游戏对象。

支持 Windows x64 的 ZIP／EXE 和 Android universal APK。Windy 固定为 `windows-x64`／ZIP，以匹配现有客户端。平台与格式分别保存；同一版本、同一平台只允许一个未清理的安装包。

## 上传与故障恢复

单文件必须大于 0 且不超过 **95,000,000 字节**。浏览器在独立 Worker 中计算 SHA-256，然后登记不可变的文件身份；首期浏览器哈希读取整个文件，但不占用 UI 主线程计算。XHR 提供发送进度与取消，原始字节通过有长度限制的 `FixedLengthStream` 交给 R2；Worker 不将完整安装包读入 ArrayBuffer。

R2 `put` 同时使用 SHA-256 校验和条件写入，完成后检查 R2 实际长度与 checksum，再标记 ready。不能用自定义元数据中的摘要代替存储校验结果。

上传状态为 pending、uploading、uncertain、ready、cleanup、cleaned。中断后先重新读取，再确认上传结果：已完整落盘的文件恢复 ready；没有对象且活动上传已超时的记录回到 pending，可重选同一文件上传。当前上传的保护窗口为十五分钟，期间不允许竞争上传或清理。重传文件必须匹配登记的长度和摘要。

首期不支持断点上传。上传完成但回写失败时保留确认入口；清理先取得数据库状态再删除对象，迟到的上传发现清理状态后也会删除其对象。已发布文件不得进入清理。未引用的图标交由已有 blob GC 管理。

公开发布先核验 R2，再将版本状态、本站序号、平台推荐、可见性和审计一起提交到 D1。revision／权限不匹配会触发约束错误，使整个批次回滚，不能仅依靠条件 UPDATE 影响零行来声称事务失败。

## 公开下载与页面

| 地址 | 行为 |
| --- | --- |
| `/resources` | 公开条目，软件下载按钮来自平台推荐，网站条目直接访问站外 |
| `/resources/:slug` | 软件介绍、历史版本、文件大小与校验和 |
| `/resources/:slug/releases/:releaseId` | 固定版本说明；已撤回版本保留说明并停止下载 |
| `GET/HEAD /api/tool-artifacts/:id/download` | 原始文件下载 |
| `GET/HEAD /api/tools/:slug/updates/:channel/:target` | 当前推荐更新及可选已安装构建映射 |

每次下载先验证资源公开、版本已发布及文件 ready。支持 HEAD、单段 Range、If-Range、206／416、稳定 ETag 和安全的 Content-Disposition；缓存为 `no-store, no-transform`，不通过长期公共缓存绕过撤回。已经发出的字节无法远程收回。

软件首次公开需有图标和推荐包；暂停全部推荐后卡片显示暂未提供下载，并保留历史说明入口。不自动回退到 GitHub。`easyrpg-kai` 锚点保留，供已有 Android 游戏导入入口在未安装播放器时回退。

## Windy 协议

当前客户端请求 `/api/tools/windy-translator/updates/stable/windows-x64`，可附加 `applicationBuildId`。接口匹配现有 [Windy 协议](https://github.com/SomiaWhiteRing/WindyTranslator/blob/main/docs/website-updates.md)，使用 `schemaVersion: 1`。

`available` 响应包括本站 version、releaseId、releaseSequence、selectionRevision、publishedAt、notes、同源 notesUrl、文件固定地址／长度／摘要／格式。版本和说明由本站填写，文件地址从本站 origin 配置生成。已配置但暂停返回 `paused`；未配置返回 404，存储缺失或校验异常返回错误，不能冒充“已是最新版”。JSON 不缓存。

管理员可从 Windy ZIP 内 `_internal/build-info.json` 或对应构建清单读取 applicationBuildId，作为附件来源元数据登记；网站不抓取 GitHub 清单。它只识别安装包，不控制本站版本。当工具、渠道、平台下的构建标识只对应一个已发布过的版本，返回其 `installedRelease`。撤回仍保留这项历史身份；未知或多义映射返回 null。缺失构建映射时客户端仍可手动下载，但不能正确自动提示本机是否已有新版。

客户端要求说明和文件地址均为同源 HTTPS。HTTP 本地开发可查看页面和接口，真实 Windy 联调须使用符合要求的 HTTPS 站点。当前客户端仅检查、下载、验证并引导手动安装；自动替换、签名、更新助手和回滚未实现。本功能不改变网站 Web 播放器 runtime，也不提供 Kai APK 自动覆盖安装。

## 管理 API、审计与维护

管理端点位于 `app/.server/resources/api.ts`，由主 Hono API 挂载。管理页不向公共页面泄漏 object key；根管理员可读取上传详情与存储报告。

| 地址 | 方法与用途 |
| --- | --- |
| `/api/admin/resources` | GET 列表、POST 创建 |
| `/api/admin/resources/:id` | GET 编辑数据、POST 保存资料／版本、发布、推荐或撤回 |
| `/api/admin/resources/:id/icon` | PUT 图标、GET／HEAD 私有预览 |
| `/api/admin/resources/:id/artifacts` | POST 登记附件 |
| `/api/admin/resource-artifacts/:id` | PUT 原始包、POST 确认／清理、GET 检查文件 |
| `/api/admin/resources/storage` | GET 分页核查 R2 对象，再核查 ready 数据库引用；包含缺失文件与无记录对象报告 |

管理 JSON 带 resource revision，二进制 PUT 带 `X-Resource-Revision`。全部领域变更沿用 `auth_audit_logs`，事件以前缀 `resource_` 记录。检查不会自动删除未知对象；草稿残留在所属资源中确认或清理。

固定开发种子包含公开 VIPRPG@Wiki、Windy 与 Kai 草稿及三个图标，不包含正式软件包，也不伪造可用附件。种子 schema、迁移账本、摘要、表统计、对象清单与引用检查同步维护。生产空库使用统一初始化 SQL；已有数据库更新或重建属于独立部署操作，不可仅部署代码而忽略 schema。

当前验收使用既有类型、lint、UI 静态规则、种子校验、生产构建及非 UI 契约入口；未新增测试代码，未进行浏览器或真实客户端安装验收。既有契约通过不能视为新增上传、所有并发恢复或真实安装均已验收。
