# 认证与权限管理系统统一基线及重构计划

状态：唯一现行基线；重构已落地，完成发布验收前不得部署

本文档是项目认证、会话、角色、授权、对象级约束和安全审计的唯一现行基线。其他文档只记录所属业务领域为何需要某项能力，不再复制角色、permission key、session 或授权细节。

## 1. 重构原因

当前未提交实现同时存在以下并行语义：

- D1 permission key、D1 `action/resource` 列和 CASL action/subject 同时表达权限；
- 页面和 API 有的调用 CASL，有的直接搜索 permission key，有的按角色名推导；
- 站内信审批和管理 API 各自实现角色分配，层级、事件和通知语义不同；
- `user_sessions` 表已存在，运行时却仍使用不可撤销的 HMAC cookie；
- 上传页检查 `upload + ImportJob`，数据却授予 `import_job.create` 和 `storage_object.upload`；
- 公开媒体和原生下载 Worker 没有使用同一套 published 引用链。

重构必须直接切换到一个模型，不增加兼容字段、双写、legacy wrapper 或旧端点别名。

## 2. 不可破坏的基线

1. 权限目录由代码以强类型 `PermissionKey` 发布；运行时不能新建 permission key。
2. 多角色权限只取并集；不实现 deny、继承、通配 `manage` 或隐式权限推导。
3. 角色只决定 permission key 集合和角色分配层级；业务代码不按 `admin`/`uploader` 名称判断能力。
4. 页面和 route guard 负责身份与粗粒度能力；所有权、状态机和公开性由拥有对象的领域服务负责。
5. 受保护请求每次从 D1 读取 session、活跃用户、角色和权限。数据库故障必须显式失败，不得降级成“未登录”。
6. 安全失败默认拒绝；不认识的 permission key、角色 kind、session 或公开引用均不产生权限。

## 3. 目标模型

### 3.1 权限目录

`lib/authz/permissions.ts` 定义唯一 `PERMISSIONS` 目录、`PermissionKey`、分类和显示文案。命名使用 `<resource>.<operation>[_scope]`；`own` 和 `any` 必须显式区分。`hasPermission(user, key)` 只做精确 key 查找。

D1 不再维护 `permissions` 注册表。`role_permissions(role_id, permission_key)` 保存角色授权，所有写入和读取都通过 `isPermissionKey` 校验。未知 key 是数据完整性错误，不能静默忽略。

### 3.2 角色和用户

- 角色 kind 为 `built_in | bootstrap_admin | custom`。
- `user=100`、`uploader=400`、`admin=700`、`super_admin=1000` 是不可修改、不可停用的系统角色。
- 每个用户始终保留 `user`；其他角色是附加授权。
- 自定义角色 priority 必须在 `101..699`，key 创建后不可改，可修改名称、描述、priority、权限和 `active|disabled` 状态，不硬删除。
- 只有当前唯一 bootstrap admin 可修改角色定义。这是根信任边界，不能通过普通 permission key 转授。
- 拥有 `user.role.assign` 的操作者只能操作活跃且最高 priority 低于自己的用户，并且只能分配低于自己的角色。不能操作自己、移除 `user` 或通过网页授予 `super_admin`。

系统角色授权必须是显式清单，不允许 `NOT IN`、通配或“除某项外全部”。当前清单为：

| 角色 | 显式 permission key |
| --- | --- |
| `user` | 无；只具备登录后本人范围能力 |
| `uploader` | `work.lookup_non_deleted`、`import_job.create`、`import_job.cancel_own`、`import_job.preflight_own`、`import_job.commit_own`、`storage_object.upload`、`archive_version.delete_own` |
| `admin` | `uploader` 的完整显式清单，加 `work.read_private`、`work.update`、`creator.read_private`、`creator.update`、`character.read_private`、`character.update`、`tag.read_private`、`tag.update`、`relation.manage_any`、`translation_relation.manage_any`、`catalog.manage_any`、`archive_version.read_private`、`archive_version.update`、`archive_version.delete_any`、`archive_version.restore`、`archive_version.set_current`、`user.read`、`user.status.update`、`user.role.assign`、`inbox.role_request.resolve`、`system.dashboard.read`、`system.maintenance.run` |
| `super_admin` | `admin` 的完整显式清单，加 `storage.gc.sweep`、`audit.read`；角色策略写入仍依赖不可委派的 bootstrap 身份，不由 key 推导 |

`user_role_events` 每行只表达一次 `assigned|removed`，保存 actor、target、role id、role key/name snapshot、reason 和来源 inbox item。站内信通知引用该事件，不再复制 old/new 角色字段。

### 3.3 Session 和认证

- cookie 保存 32 字节随机 opaque token；D1 只保存 token SHA-256。
- session 绝对有效期 14 天，不滑动延期。每次读取检查 `expires_at`、`revoked_at` 和用户 status。
- 注册验证和登录创建 session；退出撤销当前 session；密码重置和账户禁用撤销该用户全部 session。
- 验证码消费使用带 `consumed_at IS NULL` 条件的单条更新，并检查实际更新行数。登录失败计数原子递增。
- PBKDF2 hash 保留版本和 iterations。新密码长度为 `12..256`，不施加字符组合规则。目标 Worker 上五次中位数不超过 200ms 的最高 iterations 成为基线；成功登录时透明升级低于基线的 hash。

当前基线为 `870000` 次；`npm run auth:calibrate-password` 在 2026-08-24 的五次中位数校准中测得 `187.9ms`。发布前必须在目标 Worker preview 再运行同一算法；若目标中位数超过 200ms，更新常量和本文记录后重新生成开发 seed。

`BOOTSTRAP_ADMIN_EMAIL` 只在系统中尚无 bootstrap admin 时授予首个根账户。根账户轮换只能通过受审计的运维命令完成：目标必须已验证且活跃，命令在 D1 事务中原子移动角色、撤销新旧根账户 session 并写入审计；任一前置条件失败必须整体回滚。

运维入口为 `node scripts/rotate-bootstrap-admin.mjs --email <email> --local|--staging|--production`；staging/production 必须再提供完全相同的 `--confirm <email>`。

### 3.4 请求边界

`AuthContext` 包含 session id、用户、角色、权限、最高 priority 和 `isBootstrapAdmin`。`requireUser`、`requirePermission` 和页面守卫共用同一 context loader。

所有使用 session cookie 的 `POST|PUT|PATCH|DELETE` 先验证 `Origin === APP_ORIGIN`。Origin 缺失、格式错误或不匹配时一律拒绝，不使用 Referer 降级。

## 4. 权限和端点矩阵

### 4.1 公共、认证和本人范围 API

| Method + route | 身份/权限 | 领域约束 |
| --- | --- | --- |
| `GET /api/health`、`GET /api/health/db`、`GET /api/health/r2` | 公开 | 只返回依赖可用性，不返回 secret、binding 或对象名 |
| `GET /api/media/blobs/{sha256}` | 公开 | active image 且被 published Work 的直接媒体字段或媒体关联引用 |
| `GET /api/archive-versions/{id}/web-play` | 公开 | Work、ArchiveVersion 全链 published |
| `POST /api/auth/login` | 公开 + 同源 | 密码校验成功后创建服务端 session |
| `POST /api/auth/register/start`、`POST /api/auth/register/verify` | 公开 + 同源 | 限流、验证码单次消费、验证后创建 session |
| `POST /api/auth/password-reset/start`、`POST /api/auth/password-reset/confirm` | 公开 + 同源 | 限流、验证码单次消费、重置后撤销全部 session |
| `POST /api/auth/logout` | 当前 session + 同源 | 撤销当前 session，再清 cookie |
| `POST /api/account/request-upload-access` | 仅活跃用户 | 只能为本人创建一个 pending uploader 申请 |
| `POST /api/inbox/{itemId}/read`、`POST /api/inbox/read-all` | 仅活跃用户 | 只能标记本人可见站内信 |
| `POST /api/inbox/{itemId}/resolve` | `inbox.role_request.resolve` | 批准还要求 `user.role.assign`；统一角色服务原子处理 |

### 4.2 上传和对象 API

| Method + route | permission key | 领域约束 |
| --- | --- | --- |
| `POST /api/imports` | `import_job.create` | `uploader_id` 只取 AuthContext |
| `POST /api/imports/{id}/cancel` | `import_job.cancel_own` | 同上，并校验任务状态 |
| `POST /api/imports/{id}/preflight` | `import_job.preflight_own` | 同上；失败只更新已授权任务 |
| `POST /api/imports/{id}/commit` | `import_job.commit_own` | 同上；服务端不信任客户端 uploader |
| `PUT /api/blobs/{sha256}` | `storage_object.upload` | 强制携带 `import_job_id` 且任务属于本人；校验内容 hash |
| `PUT /api/core-packs/{sha256}` | `storage_object.upload` | 强制携带 owned `import_job_id`；校验 ZIP、hash 和计数头 |
| `GET /api/works/lookup` | `work.lookup_non_deleted` | 只为上传去重返回 non-deleted Work |

### 4.3 管理 API

| Method + route | permission key / 根边界 | 领域约束 |
| --- | --- | --- |
| `GET /api/admin/summary`、`GET /api/admin/observability` | `system.dashboard.read` | 只读 |
| `GET /api/admin/consistency`、`GET /api/admin/gc/dry-run` | `system.maintenance.run` | 有界检查，不做最终删除 |
| `POST /api/admin/gc/sweep` | `storage.gc.sweep` | 强制确认、状态机与审计 |
| `POST /api/admin/works/{id}/update` | `work.update` | Work 状态与关联由作品服务校验 |
| `POST /api/admin/creators/{id}/update` | `creator.update` | 作者服务校验目标与合并约束 |
| `POST /api/admin/characters/{id}/update` | `character.update` | 角色资料服务校验目标与合并约束 |
| `POST /api/admin/tags/{id}/update` | `tag.update` | 标签服务校验目标与合并约束 |
| `POST /api/admin/archive-versions/{id}/update` | `archive_version.update` | 归档状态机校验 |
| `POST /api/admin/archive-versions/{id}/delete` | `archive_version.delete_own` 或 `archive_version.delete_any` | own 必须匹配 uploader；any 可操作任意低层对象 |
| `POST /api/admin/archive-versions/{id}/restore` | `archive_version.restore` | 只允许未 purged 的 deleted 版本 |
| `POST /api/admin/archive-versions/{id}/current` | `archive_version.set_current` | 只允许 published，并维护同组唯一 current |
| `POST /api/admin/users/{userId}/status` | `user.status.update` | 禁止自操作、同级/更高目标；禁用同时撤销 session 并审计 |
| `POST /api/admin/users/{userId}/roles` | `user.role.assign` | 统一服务检查双方 priority、重复、角色状态和 bootstrap 禁令 |
| `DELETE /api/admin/users/{userId}/roles/{roleId}` | `user.role.assign` | 同上；基础 `user` 不可移除 |
| `GET /api/admin/permissions` | bootstrap admin | 读取固定目录和角色策略 |
| `POST /api/admin/roles` | bootstrap admin | 只创建 `custom`，priority `101..699` |
| `PATCH /api/admin/roles/{roleId}` | bootstrap admin | 只更新/停用 custom，不硬删除 |
| `POST /api/admin/roles/{roleId}/permissions` | bootstrap admin | 只接受运行时目录中的 typed key，整组替换 |

### 4.4 页面

| 页面 | 身份/权限 |
| --- | --- |
| `/`、`/games*`、`/creators*`、`/characters`、`/tags`、`/catalogs*`、`/play/{id}`、认证表单页 | 公开；公共资料 SQL 只返回 published |
| `/me`、`/inbox` | 仅活跃用户；内容按本人或可处理 permission 过滤 |
| `/upload` | `import_job.create` |
| `/admin` | `system.dashboard.read` |
| `/admin/works`、`/admin/creators`、`/admin/characters`、`/admin/tags` | 对应 `*.read_private` |
| `/admin/works/{id}`、`/admin/creators/{id}`、`/admin/characters/{id}`、`/admin/tags/{id}` | 对应精确 `*.update` |
| `/admin/archive-versions`、`/admin/archive-versions/{id}` | `archive_version.read_private` / `archive_version.update` |
| `/admin/archive-versions/trash` | `archive_version.restore` |
| `/admin/maintenance` | `system.maintenance.run`；sweep 控件另查 `storage.gc.sweep` |
| `/admin/users` | `user.read`；控件另查 status/role key 和 priority |
| `/admin/audit` | `audit.read` |
| `/admin/permissions` | bootstrap admin 根边界 |

### 4.5 原生 Worker

| 入口 | 基线 |
| --- | --- |
| `GET|HEAD /api/archive-versions/{id}/download` | 公开；原生 D1 SQL 强制 Work、ArchiveVersion 全链 published |
| 其他 fetch | 交给 OpenNext App Router，适用以上矩阵 |
| scheduled archive GC | 无用户 session；只由 Cloudflare Cron 触发，固定上限并写 `scheduled_gc_sweep` 审计 |

### 4.6 App Router API 逐项清单

下面的清单与当前 `app/api/**/route.ts` 的导出方法一一对应。新增 API 必须先更新本表和上面的权限矩阵，再进入实现。

| Method | Route | 身份 / permission key | 领域约束 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | 公开 | 只返回服务存活状态 |
| `GET` | `/api/health/db` | 公开 | 只返回 D1 可用性；故障为 `503` |
| `GET` | `/api/health/r2` | 公开 | 只返回 R2 可用性；故障为 `503` |
| `GET` | `/api/media/blobs/{sha256}` | 公开 | active image，且存在 published Work 的直接媒体字段或 `work_media_assets` 引用 |
| `GET` | `/api/archive-versions/{archiveVersionId}/web-play` | 公开 | SQL 必须证明 Work、ArchiveVersion 全部 `published` |
| `GET` | `/api/works/lookup` | `work.lookup_non_deleted` | 仅返回非 deleted Work，用于上传关联 |
| `POST` | `/api/auth/login` | 公开 + 同源 | 密码长度/哈希校验、失败原子计数、成功创建 session |
| `POST` | `/api/auth/logout` | 当前 session + 同源 | 只撤销当前 session 并清 cookie |
| `POST` | `/api/auth/register/start` | 公开 + 同源 | 密码长度、验证码限流和发送流程 |
| `POST` | `/api/auth/register/verify` | 公开 + 同源 | 验证码单次消费、注册用户和 session 原子后续流程 |
| `POST` | `/api/auth/password-reset/start` | 公开 + 同源 | 不泄露账户存在性；限流和验证码发送 |
| `POST` | `/api/auth/password-reset/confirm` | 公开 + 同源 | 验证码单次消费、密码升级和全量 session 撤销 |
| `POST` | `/api/account/request-upload-access` | 仅活跃用户 + 同源 | 只能为本人创建或复用一个 pending uploader 申请 |
| `POST` | `/api/inbox/read-all` | 仅活跃用户 + 同源 | 只标记本人或当前 permission 可见的站内信 |
| `POST` | `/api/inbox/{itemId}/read` | 仅活跃用户 + 同源 | 领域服务再次证明站内信可见性 |
| `POST` | `/api/inbox/{itemId}/resolve` | `inbox.role_request.resolve` + 同源 | 统一角色服务再次检查 `user.role.assign`、priority、状态和重复操作 |
| `POST` | `/api/imports` | `import_job.create` + 同源 | `uploader_id` 只取 AuthContext |
| `POST` | `/api/imports/{importJobId}/cancel` | `import_job.cancel_own` + 同源 | owned job 和任务状态机 |
| `POST` | `/api/imports/{importJobId}/preflight` | `import_job.preflight_own` + 同源 | owned job；只更新已授权任务 |
| `POST` | `/api/imports/{importJobId}/commit` | `import_job.commit_own` + 同源 | owned job；服务端重取 uploader 和内容引用 |
| `PUT` | `/api/blobs/{sha256}` | `storage_object.upload` + 同源 | 必须有 owned `import_job_id`，重算 hash |
| `PUT` | `/api/core-packs/{sha256}` | `storage_object.upload` + 同源 | 必须有 owned `import_job_id`，校验 ZIP、hash 和计数头 |
| `GET` | `/api/admin/summary` | `system.dashboard.read` | 只读管理摘要 |
| `GET` | `/api/admin/observability` | `system.dashboard.read` | 只读运行观测 |
| `GET` | `/api/admin/consistency` | `system.maintenance.run` | 有界 D1/R2 一致性检查，不删除 |
| `GET` | `/api/admin/gc/dry-run` | `system.maintenance.run` | 只生成清理候选，不删除 |
| `POST` | `/api/admin/gc/sweep` | `storage.gc.sweep` + 同源 | 显式确认、固定上限、状态机和审计 |
| `GET` | `/api/admin/permissions` | bootstrap admin 根身份 | 读取代码权限目录和角色策略 |
| `POST` | `/api/admin/roles` | bootstrap admin 根身份 + 同源 | 只创建 custom，priority `101..699` |
| `PATCH` | `/api/admin/roles/{roleId}` | bootstrap admin 根身份 + 同源 | 只更新/停用 custom，key 不可改、不硬删除 |
| `POST` | `/api/admin/roles/{roleId}/permissions` | bootstrap admin 根身份 + 同源 | 整组替换，所有 key 必须来自 typed catalog |
| `POST` | `/api/admin/users/{userId}/roles` | `user.role.assign` + 同源 | 统一服务检查目标/角色 priority、状态、重复和 bootstrap 禁令 |
| `DELETE` | `/api/admin/users/{userId}/roles/{roleId}` | `user.role.assign` + 同源 | 同上；`user` 基础角色不可移除 |
| `POST` | `/api/admin/users/{userId}/status` | `user.status.update` + 同源 | 禁止自操作、同级/更高目标；禁用撤销全部 session |
| `POST` | `/api/admin/works/{workId}/update` | `work.update` + 同源 | Work 状态与关联由作品服务校验并审计 |
| `POST` | `/api/admin/archive-versions/{archiveVersionId}/update` | `archive_version.update` + 同源 | ArchiveVersion 状态机由归档服务校验并审计 |
| `POST` | `/api/admin/archive-versions/{archiveVersionId}/delete` | `archive_version.delete_own` 或 `archive_version.delete_any` + 同源 | own 匹配 uploader；any 由服务校验对象范围 |
| `POST` | `/api/admin/archive-versions/{archiveVersionId}/restore` | `archive_version.restore` + 同源 | 只能还原未 purged deleted 版本 |
| `POST` | `/api/admin/archive-versions/{archiveVersionId}/current` | `archive_version.set_current` + 同源 | 只能选择 published 并维护唯一 current |
| `POST` | `/api/admin/creators/{creatorId}/update` | `creator.update` + 同源 | 作者服务校验目标、合并约束并审计 |
| `POST` | `/api/admin/characters/{characterId}/update` | `character.update` + 同源 | 角色服务校验目标、合并约束并审计 |
| `POST` | `/api/admin/tags/{tagId}/update` | `tag.update` + 同源 | 标签服务校验目标、合并约束并审计 |

### 4.7 App Router 页面逐项清单

| Page | 身份 / permission key | 领域约束 |
| --- | --- | --- |
| `/` | 公开 | 公开列表只查询 published 资料 |
| `/about` | 公开 | 不显示内部凭据或权限规则 |
| `/games` | 公开 | 只展示 published Work |
| `/games/{id}` | 公开 | 只展示 published Work 及其公开版本链 |
| `/search` | 公开 | 搜索结果遵守公开资料 SQL |
| `/creators` | 公开 | 只展示公开关联的 creator |
| `/creators/{id}` | 公开 | 只展示公开 Work 关联 |
| `/characters` | 公开 | 只展示公开关联的角色，条目进入公开 Work 筛选 |
| `/tags` | 公开 | 只展示公开关联的标签，条目进入公开 Work 筛选 |
| `/catalogs` | 公开 | 只展示 published 目录和 Work 成员 |
| `/catalogs/{id}` | 公开 | 只展示 published 目录中的公开 Work |
| `/play/{archiveVersionId}` | 公开 | 页面数据只能来自完整 published 版本链 |
| `/login` | 公开 | 登录提交走同源认证 API |
| `/register` | 公开 | 注册提交走同源验证码 API |
| `/forgot-password` | 公开 | 仅发起密码重置流程 |
| `/reset-password` | 公开 | 重置提交走同源验证码 API |
| `/me` | 仅活跃用户 | 只读取本人账户和通知 |
| `/inbox` | 仅活跃用户 | 只显示本人或当前 permission 可见通知 |
| `/upload` | `import_job.create` | 无 key 时显示申请入口，不创建任务 |
| `/admin` | `system.dashboard.read` | 管理摘要按当前权限显示 |
| `/admin/works` | `work.read_private` | 管理列表仍由 Work 服务过滤 |
| `/admin/works/{workId}` | `work.update` | 编辑目标由 Work 服务校验 |
| `/admin/archive-versions` | `archive_version.read_private` | 无 `delete_any` 时只列本人归档 |
| `/admin/archive-versions/{archiveVersionId}` | `archive_version.update` | 编辑目标由 ArchiveVersion 服务校验 |
| `/admin/archive-versions/trash` | `archive_version.restore` | 只显示可还原 deleted 版本 |
| `/admin/creators` | `creator.read_private` | 管理列表由 creator 服务过滤 |
| `/admin/creators/{creatorId}` | `creator.update` | 编辑目标由 creator 服务校验 |
| `/admin/characters` | `character.read_private` | 管理列表由角色服务过滤 |
| `/admin/characters/{characterId}` | `character.update` | 编辑目标由角色服务校验 |
| `/admin/tags` | `tag.read_private` | 管理列表由标签服务过滤 |
| `/admin/tags/{tagId}` | `tag.update` | 编辑目标由标签服务校验 |
| `/admin/users` | `user.read` | 只列出低于操作者最高 priority 的用户 |
| `/admin/maintenance` | `system.maintenance.run` | final sweep 控件另查 `storage.gc.sweep` |
| `/admin/audit` | `audit.read` | 只读角色事件和安全审计 |
| `/admin/permissions` | bootstrap admin 根身份 | 唯一自定义角色与权限策略管理入口 |

## 5. 实施与拆除

1. 落盘本基线与失败用例。
2. 直接重写 `0001`、开发种子和角色事件模型；重置本地/测试 D1。
3. 切换 opaque session、撤销生命周期、验证码原子消费、密码基线和同源保护。
4. 引入 typed permission catalog 和唯一 guard，迁移页面、API、领域服务和 Worker。
5. 合并角色服务，完成自定义角色、用户分配 UI、通知和审计。
6. 修复公开资源引用链，再删除 CASL、旧 HMAC session、`permissions` 表、通配 `manage`、重复角色服务、旧事件字段和过期文档规则。
7. 整体作为一次不可拆分的安全基线发布。

拆除完成清单：

- 已删除 `@casl/ability`、ability builder、action/subject 类型和 `manage` 推导。
- 已删除 D1 `permissions` 注册表、`permission_id`、`action/resource/is_system` 重复事实。
- 已删除 HMAC 用户 payload session，cookie 只保留随机 token。
- 已删除单角色 old/new 事件字段、旧单角色 API 和独立 role status route。
- 已删除站内信与用户 API 中的重复角色写入，统一到 `lib/server/db/permissions.ts`。
- 已修复媒体、web-play 和原生下载的公开引用链。
- 已将旧架构文档中的认证/授权规则退役，只保留业务摘要并链接本文。

## 6. 验证门槛

- `check:security` 覆盖权限目录、系统角色、自定义角色并集、层级分配、own/any、禁用用户和未知 key fail closed。
- D1 检查覆盖 session 创建/到期/撤销、密码重置全撤销、验证码不可重复消费、角色事件和审计。
- API 矩阵验证匿名 401、缺权 403、越权对象不可见、上传者不能写他人任务、管理员不能操作同级或更高用户。
- 浏览器验证注册、登录、上传权限申请/审批、自定义角色管理、用户禁用和退出。
- Worker preview 验证下载、游玩和媒体只读取完整 published 引用链。
- 必须通过 `npm run check`、`npm run build`、本地 D1 reset/seed、`git diff --check`。
- residual scan 不得匹配 `@casl/ability`、`buildAbilityFor`、旧 HMAC session payload、重复角色写服务、old/new 角色事件字段、permission action/subject 表和旧角色 endpoint。

## 7. 明确不做

本次不引入 MFA、OAuth、用户设备管理 UI、角色继承、显式 deny、动态 permission key 或旧模型兼容层。

## 8. 新增或修改权限的唯一流程

1. 先说明受保护资源、操作、scope 与领域所有权；能由现有 key 精确表达时不得新增。
2. 在 `lib/authz/permissions.ts` 增加 typed key、分类和文案，并更新本文逐路由矩阵。
3. route/page 只加身份和 key guard；ownership、published 链、状态机或 priority 必须放在拥有该对象的领域服务。
4. 在 `SYSTEM_ROLE_PERMISSIONS` 显式加入需要该能力的系统角色；禁止按差集或未来目录自动扩权。自定义角色由 bootstrap admin 在固定目录中选择。
5. 为 `check:security` 增加目录、grant 和 fail-closed 用例；涉及 D1 状态时同时扩展 `check:security:d1`。
6. 运行完整 API/浏览器矩阵、Worker preview、`npm run check`、`npm run build` 与 residual scan 后，才能随完整安全基线发布。
7. 不在其他文档复制规则；领域文档只能说明业务为何依赖某种能力并链接本文。
