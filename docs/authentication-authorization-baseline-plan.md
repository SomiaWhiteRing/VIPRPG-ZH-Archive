# 认证与权限基线

状态：唯一现行安全契约

本文定义认证、session、角色、授权、对象级约束和安全审计的稳定边界。权限 key 与系统角色授权的当前清单由 `lib/authz/permissions.ts` 中的 `PERMISSIONS` 和 `SYSTEM_ROLE_PERMISSIONS` 发布；D1 结构由 `migrations/0001_init_archive_schema.sql` 发布。其他领域文档只说明为何需要某项能力，不复制清单。

## 1. 基本原则

1. 权限目录由代码以强类型 `PermissionKey` 发布，运行时不能创建新 permission key。
2. 多角色权限只取并集；不实现 deny、继承、通配 `manage` 或按角色名隐式推导能力。
3. 页面和 route guard 负责身份与粗粒度 permission；所有权、公开性、状态机和层级约束由拥有对象的领域服务负责。
4. 受保护请求每次从 D1 读取 session、活跃用户、角色和权限，不信任 cookie 中的用户资料或权限。
5. 数据库、配置或权限解析失败时拒绝请求，不降级为匿名成功或默认授权。
6. 废弃的内部认证或权限模型直接删除，不保留双写、旧端点别名或兼容字段。

## 2. 权限与角色

### 权限目录

- `PERMISSIONS` 是 permission key、分类和显示名称的唯一目录。
- `role_permissions.permission_key` 只保存目录中的 key；`parsePermissionKeys` 遇到未知值必须失败。
- `hasPermission` 只做活跃账户的精确 key 查找。
- 新能力优先复用能准确表达资源、操作和 scope 的现有 key；`own` 与 `any` 必须显式区分。

### 角色

- 角色 kind 为 `built_in | bootstrap_admin | custom`。
- 系统角色 priority 固定为 `user=100`、`uploader=400`、`admin=700`、`super_admin=1000`。
- 每个用户始终保留基础 `user` 角色；其他角色是附加授权。
- 自定义角色 priority 只能位于 `101..699`，key 创建后不可修改；角色可以停用但不硬删除。
- 系统角色授权使用 `SYSTEM_ROLE_PERMISSIONS` 的显式清单，不按权限目录差集或未来新增 key 自动扩权。

### 根边界与角色分配

- 只有当前 bootstrap admin 可以创建或修改自定义角色及其 permission 集合；该能力不能通过普通 permission key 转授。
- 拥有 `user.role.assign` 的操作者只能管理活跃且最高 priority 低于自己的用户，只能分配低于自己的角色。
- 不能操作自己、移除基础 `user`，也不能通过网页授予或移动 bootstrap admin。
- 根账户轮换只通过 `scripts/rotate-bootstrap-admin.mjs` 完成；命令必须原子移动角色、撤销新旧根账户 session 并写入审计。
- `user_role_events` 每行只记录一次 `assigned | removed`，并保存 actor、target、role snapshot、原因和可选的来源 inbox item。

角色读取和写入集中在 `lib/server/db/permissions.ts`；页面、提醒和用户 API 不应各自实现角色状态转换。

## 3. Session 与认证

- session cookie 只保存随机 opaque token；D1 的 `user_sessions` 只保存 token SHA-256。
- session 使用固定绝对有效期，不滑动延期。当前数值由 `lib/server/auth/session.ts` 的 `SESSION_TTL_SECONDS` 决定。
- 每次读取 session 都检查到期、撤销和用户状态。
- 登录与注册验证成功后创建 session；退出撤销当前 session；密码重置和账户禁用撤销该用户全部 session。
- 注册与密码重置验证码只能原子消费一次；登录失败计数必须原子更新。
- 密码格式、PBKDF2 参数和透明升级规则以 `lib/server/auth/password.ts` 为准。参数调整先运行 `npm run auth:calibrate-password`，再更新代码和开发 seed。
- `BOOTSTRAP_ADMIN_EMAIL` 只在系统尚无 bootstrap admin 时用于首次授予，不是持续同步配置。

## 4. 请求边界

### 身份加载

`AuthContext` 包含 session、用户、角色、permission key、最高 priority 和 bootstrap 身份。请求与 Server Component 分别通过 `lib/server/auth/current-user.ts` 中的 loader 获取同一语义的 context。

### 同源保护

- 使用 session cookie 的 `POST | PUT | PATCH | DELETE` 必须先通过 `lib/server/auth/origin.ts` 的 `assertSameOrigin`。
- Origin 缺失、格式错误或不等于 `APP_ORIGIN` 时拒绝；不使用 Referer 降级。
- 身份失败返回 401，身份有效但缺少能力返回 403；对象不可见时由领域服务按资源语义返回 403 或 404。

### 对象级授权

| 领域 | route/page guard | 领域服务必须再次确认 |
| --- | --- | --- |
| 上传 | import 与 storage permission | import job 属于当前上传者且状态允许操作 |
| 作品资料 | read/update permission | own/any、目标状态及关联一致性 |
| 作品关系与目录 | create/update/delete permission | 创建者、owner、反向关系和成员约束 |
| 作品评论与点赞 | `work_comment.manage_any`（管理员）或作者 own-scope | published Work、活跃用户、主楼/回复关系和评论状态 |
| 自定义表情 | `custom_emoji.manage` | 管理员上传、图片 blob 状态、shortcode 不可改名、只能退休或恢复 |
| 归档版本 | read/update/delete/restore/current permission | uploader、published/current、deleted/purged 状态机 |
| 用户与角色 | user/role permission 或 bootstrap 身份 | 双方 priority、角色 kind/status、自操作禁令 |
| 媒体、下载与游玩 | 公开入口 | Work、ArchiveVersion 和引用链完整 published |
| GC 与审计 | maintenance/sweep/audit permission | 显式确认、数量上限、状态转换和审计 |

原生下载 Worker 也必须执行完整 published 引用链检查；不能因为绕过 App Router 而弱化公开性规则。

## 5. 安全验证

- `npm run check`：类型、lint、权限目录、系统角色 grant、未知 key fail closed 和静态 UI 边界。
- `npm test`：在独立临时 D1/R2 中串行验证匿名 401、同源 403、权限刷新、ownership、真实上传与恢复、归档生命周期、原生下载/GC 和浏览器安装。
- `npm run build`：生产构建。
- `npm run smoke:staging`：部署后只验证 staging 的健康入口。
- 评论、点赞、游玩和收藏写请求沿用同源校验；公开评论还必须确认 Work、主楼和作者均处于可公开状态。

有状态 D1、API 和 Worker 检查只通过 `npm test` 串行运行。测试自行迁移和 seed 临时状态，不依赖也不重置开发环境的 `.wrangler/state`。

## 6. 非目标

当前不引入 MFA、OAuth、用户设备管理 UI、角色继承、显式 deny、动态 permission key 或旧模型兼容层。

## 7. 修改权限模型

1. 说明受保护资源、操作、scope 和领域所有权；现有 key 能准确表达时不新增。
2. 在 `PERMISSIONS` 增加 typed key，并在 `SYSTEM_ROLE_PERMISSIONS` 显式授予需要该能力的系统角色。
3. route/page 只添加身份和 permission guard；ownership、published 链、状态机或 priority 进入对应领域服务。
4. 纯权限规则扩展 `npm run check` 中的静态断言；只有跨层关键流程改变时才调整单条 `npm test` 综合故事，不为每个端点新增测试。
5. 运行 `npm run check`、`npm test` 和 `npm run build`。
6. 只有稳定边界发生变化时更新本文；具体 key、角色 grant 和路由清单始终从代码读取。
