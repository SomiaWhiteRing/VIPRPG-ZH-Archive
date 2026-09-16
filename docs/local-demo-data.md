# 本地展示数据

当前种子是 2026-09-16 本地数据库与 R2 的固定快照。它包含已审核的角色分类、真实来源素材，以及日常开发使用的虚构作品、账号和互动场景。

## 固定快照

`data/local-seed/database.sqlite.gz` 保存完整 SQLite 数据库，包含 schema、迁移记录、全文搜索索引、主键序列及全部当前记录。快照已对齐统一初始化 `migrations/0001_init_archive_schema.sql`，包含当前索引，迁移账本仅保留这一条；原有业务记录、审核结果和素材引用保持原值。`manifest.json` 保存数据库校验和、逐表数量，以及全部 R2 对象的键、SHA-256、大小和 HTTP／自定义元数据。仓库已有的角色图片直接复用原文件；其他对象存于 `data/local-seed/objects/`。

首次初始化空环境：

```powershell
npm run db:local:seed
```

恢复前停止本地服务器。脚本先校验快照和全部对象，再写入本地 R2，通过 SQLite backup 恢复 D1，并应用仓库中尚未登记的 migration。已有业务数据时拒绝覆盖；只有明确要重建开发库时，才在自行备份后运行 `npm run db:local:reset`，再恢复种子。空库仅需 schema 时运行 `npm run db:local:migrate`。上线前直接修改统一初始化时，已有旧库不会被该命令升级；需要明确决定并备份后重建，固定种子也必须同步对齐 schema 与迁移账本。

以后需要将新的人工审核结果作为种子时，暂停编辑和上传，再运行：

```powershell
npm run db:local:seed:capture
npm run db:local:seed:verify
```

capture 只读当前本地数据库和 R2，通过 SQLite 在线备份纳入 WAL 中已提交的内容，覆盖种子文件，保留全部当前记录（包括本地账号、审核状态和会话表）。它不会更新正在使用的数据库。只在本地开发环境使用这份种子。

脚本使用 `wrangler.jsonc` 的本地 binding，关闭远程 binding，默认状态目录为 `.wrangler/state`。可通过 `--persist-to <目录>` 选择隔离的 Wrangler 状态目录，例如 `node scripts/dev-seed.mjs --persist-to output/seed-restore`。capture 读取当前 Miniflare 的本地存储结构，恢复通过 R2 API 和 SQLite backup 完成。每次操作的快照与校验报告保存在被 Git 忽略的 `output/local-seed/<时间>/`。

词典、分类 bootstrap 和素材导入清单供显式整理工具使用，日常 seed 直接恢复快照。提交种子时，应一并提交 manifest 引用的新增素材文件。

## 账号

固定快照中的活跃账号密码均为 `dev123456789`，只用于本地开发；停用和注销账号用于展示状态边界。

| 邮箱 | 展示用途 |
| --- | --- |
| `super@dev.local` | 根账户、角色权限管理 |
| `admin@dev.local` | 作品与论坛管理、审批申请、处理举报 |
| `uploader@dev.local` | 作品共同维护、收藏和游玩记录 |
| `user@dev.local` | 普通用户、本人主题、评论、点赞、收藏和未读提醒 |
| `wiki@dev.local` | 维基人模板权限、共同维护作品、已读授权通知 |
| `curator@dev.local` | 仅增加讨论策展权限的自定义身份 |
| `private@dev.local` | 有收藏、历史和目录，但关闭公开主页展示 |
| `applicant@dev.local` | 待处理维基人申请、已驳回策展申请 |
| `disabled@dev.local` | 已停用账户，不能登录，供后台状态筛选使用 |

另有用户 10006：已注销、邮箱和密码为空，保留历史评论。后台同时有一个已停用的自定义角色。

## 展示入口

主站和论坛开发使用 `npm run dev`（默认 `http://localhost:3000`）；验证生产 Worker 构建产物时使用 `npm run preview`（默认 `http://localhost:4173`）。以下均为相对路径。

| 功能 | 入口与场景 |
| --- | --- |
| 自定义更多信息、多图、外部下载、完整制作人员 | `/games/10001`：寄往雪原的信，含两条多段信息和 7 类职务 |
| 年、月、日发布日期 | `/games/10001` 为 2024；`/games/10002` 为 2024-12；`/games/10003` 为 2026-09-01 |
| 原作、译作、前后作关联 | 10001 原作、10002 中文译本、10003 后日谈；关联双向显示 |
| 未知发布日期、隐藏与删除状态 | 后台作品 10004 为隐藏且日期未知，10005 为已删除 |
| 作者别名与署名复用 | `/creators/10001`：雪灯工作室、雪灯、Snow Lantern 为同一作者，跨作品展示不同署名；译作另有翻译人员 |
| 角色展示名、身份、剧透与作品头像 | 作品 10001–10003 使用词典中的阿泽库拉，覆盖主角、配角、客串、提及、其他；同一作品中有两个身份，一个身份使用单独头像 |
| 共同维护 | 作品 10001–10003 同时关联上传者与维基人，可分别登录后查看本人维护列表 |
| 目录、备注和排序 | `/catalogs/10001`：原作、译作、后日谈；后台另有已删除目录 |
| 公开与隐私主页 | `/users/10001` 为公开资料；`/users/10003` 关闭简介、收藏、历史、目录、评论和讨论公开展示；恢复时保留快照中的隐私设置 |
| 作品与作者评论 | `/games/10001`、`/creators/10001`：评论、回复、点赞、隐藏和已删除记录、已注销作者历史内容 |
| 自定义表情 | `:dev_wave:` 可选；`dev_quiet` 不出现在选择器；`dev_retired` 已停用。图片复用基础 seed 的占位头像 |
| 申请、通知和授权记录 | `/inbox`、`/admin/users`、`/admin/permissions`：按上述账号登录查看 |
| 论坛列表与分页 | `/discussions`：38 个主题，12 个 TAG，包含精品、已锁定和已隐藏主题 |
| 长标题、多 TAG、多页楼层及楼中楼 | `/discussions/10100`：5 个 TAG、32 个楼层，两组各 27 条楼中楼，另有点赞和表情 |
| 锁定、本人编辑、隐藏审核 | `/discussions/10102` 锁定；10103 属于普通用户；10104 隐藏，管理员可查看 |
| TAG 状态 | `/admin/discussion-tags`：启用、停用、隐藏 TAG；10105 主题关联了状态不同的 TAG |
| 全文搜索 | `/search?scope=discussions&q=窗口模式`：命中楼中楼 |
| 举报处理 | `/admin/discussions`：待处理、已处理、已驳回各 1 条，覆盖楼层、楼中楼和主题 |

上述演示公开作品使用 MV 引擎和单一外部下载字段，能够进入公开列表和详情页。下载地址在 `example.com` 下，仅为占位；这些场景不含可运行游戏。快照内 5 份归档使用空 core pack，仅供资料展示，不能据此验收真实下载、游戏启动、ZIP 上传或浏览器安装。

## 数据来源

当前初始化来源为 [固定种子清单](../data/local-seed/manifest.json)，以实际数据库为准，保留后续人工编辑结果。论坛最初的演示内容来自 [data/dev/forum.json](../data/dev/forum.json)，该文件仅保留为来源记录，不再参与 seed。角色素材来源及分类决定见各素材清单和采集文档。

一次性迁移范围与当次验收陈述保存在[2026 年 9 月本地开发记录](./archive/2026-09-forum-local-development.md)，不作为初始化或更新步骤。
