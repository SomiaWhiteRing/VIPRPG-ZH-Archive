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
- 停用角色保留成员关系，但不贡献生效权限或管理优先级；管理页面仍须显示这些成员关系，并允许有权管理的操作者移除。
- 自定义角色资料和权限保存均带上读取时的完整配置快照；写入时原子比对，过期配置返回冲突并保留客户端草稿，不覆盖他人的修改。权限变更审计保存变更前后的具体授权清单。
- 业务入口按完成操作所需的权限组合显示；角色配置可以提示缺失的配套能力，但不自动补授权限，多角色依然只取并集。
- `ROLE_TEMPLATES.wiki_editor` 是可创建为自定义角色的维基人模板；仅根管理员可创建，创建角色与初始授权一起提交。模板不自动分配给用户，也不覆盖已存在的同名标识角色。
- 维基人可维护作品资料、署名、作者、游戏角色、标签及普通/翻译关联；移除错误关联不等于删除作品或资料实体。普通关联修改和删除分别校验；翻译关联目前通过删除错误关系后重建来纠正。
- 作品关联按当前条目的 `work_uploaders` 判断上传者资格；基础角色的 `relation.create` / `translation_relation.create` 仅允许为本人上传的条目添加关联，上传者也可修改或删除该条目的直接关联，不按关联创建人判断。非上传者须取得对应操作的 `*_any` 权限。前台入口、后台编辑器及写入接口使用同一判定；对向关联随当前操作自动建立、修改或删除，不另要求对向条目的上传者资格。同一原版下其他译版的间接关联仅展示，需进入对应条目编辑。
- 关联属于公开展示：搜索、创建、修改类型和关联列表统一限定 `public_works`，隐藏、已删除及不满足公开分发条件的作品不因上传者或后台权限而放行。目录共用的作品搜索同样仅返回公开作品。作品随后隐藏时保留原有关联记录，但不展示该目标；删除操作仍按编辑权限校验，允许清理旧记录。
- `work.metadata.update_any` 不赋予发布状态或归档文件管理能力；无状态权限的资料保存不写 `status` 和 `published_at`。更新已有作品的归档必须同时具备上传能力、`work.update_own` 和该作品的维护者资格，管理员也遵守此规则。
- 作者详情卡片下方提供前台编辑入口，`creator.metadata.update_public` 允许正常账号维护已关联公开作品的作者，默认授予内置角色；`creator.metadata.update_any` 也可使用该入口。前台仅编辑名称、别名、网站、简介和头像，不授予后台访问、非公开作者读取或合并能力。别名使用共用多 tag 输入器，不设数量上限。网站以 `creators.links_json` 保存有序的 `{label,url}` 数组，支持 itch、Twitter(X)、blog、个人网站及自定义名称，每条网址只允许 HTTP(S)。资料直接生效，保存时原子比对原始资料，冲突返回 409；头像独立保存并比对原头像。修改人与修改前后内容随资料一起写入审计日志，名称及别名冲突时整批回滚。

### 根边界与角色分配

- 只有当前 bootstrap admin 可以创建或修改自定义角色及其 permission 集合；该能力不能通过普通 permission key 转授。
- 资源资料、图标、软件包上传、发布、推荐、撤回和清理同样仅限当前 bootstrap admin，写入批次重新核对活跃根身份并记录审计；普通上传或管理权限不授予此能力，详见[资源契约](./resources.md)。
- 拥有 `user.role.assign` 的操作者只能管理活跃且最高 priority 低于自己的用户，只能分配低于自己的角色。
- 不能操作自己、移除基础 `user`，也不能通过网页授予或移动 bootstrap admin。
- 根账户轮换只通过 `scripts/rotate-bootstrap-admin.mjs` 完成；命令必须原子移动角色、撤销新旧根账户 session 并写入审计。
- `user_role_events` 每行只记录一次 `assigned | removed`，并保存 actor、target、role snapshot、原因和可选的来源 inbox item。
- 角色分配、移除、申请审批和账户状态更新在写入批次内重新核对操作者权限、双方当前层级及目标状态；审计、角色事件、申请状态和通知与操作一起提交。审批申请同时需要 `inbox.role_request.resolve` 和 `user.role.assign`。

角色读取和写入集中在 `app/.server/db/permissions.ts`；页面、提醒和用户 API 不应各自实现角色状态转换。

根账户轮换使用以下命令，远程环境的 `--confirm` 必须与目标邮箱相同：

```powershell
node scripts/rotate-bootstrap-admin.mjs --email admin@example.com --local
node scripts/rotate-bootstrap-admin.mjs --email admin@example.com --staging --confirm admin@example.com
node scripts/rotate-bootstrap-admin.mjs --email admin@example.com --production --confirm admin@example.com
```

## 3. Session 与认证

- session cookie 只保存随机 opaque token；D1 的 `user_sessions` 只保存 token SHA-256。
- session 使用固定绝对有效期，不滑动延期。当前数值由 `app/.server/auth/session.ts` 的 `SESSION_TTL_SECONDS` 决定。
- 每次读取 session 都检查到期、撤销和用户状态。
- 登录与注册验证成功后创建 session；退出撤销当前 session；密码重置和账户禁用撤销该用户全部 session。
- 注册与密码重置验证码只能原子消费一次；登录失败计数必须原子更新。
- 注册时填写显示名、邮箱、密码与确认密码；显示名沿用个人资料的 1 至 80 字符规则，随验证码挑战保存，验证成功后写入账户。密码显隐由共用输入组件提供。注册、找回密码和修改邮箱的邮件链接在 URL fragment 中携带验证码，页面预填后移除 fragment；打开链接不自动提交或消费验证码。
- 密码使用原生 `node:crypto` scrypt，格式和透明升级规则以 `app/.server/auth/password.ts` 为准，参数由 `password-policy.json` 发布。当前采用 [OWASP 建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)的 `N=32768, r=8, p=3`（32 MiB），原生分配上限 48 MiB，满足 [Workers 的 `N*r*p <= 2^20` 限制](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h)。参数调整需同步开发 seed，运行 `npm run auth:calibrate-password` 测量当前策略，并在部署后的 Workers 验证；本地耗时不能证明远端支持。Workers 原生 PBKDF2 上限为 100,000 次，不能按本机校准结果选择更高迭代数。
- 第一个完成邮箱验证并创建的账号（用户表中 ID 最小的账号）自动获得 `super_admin`。系统已有超级管理员时不重复授予；后续注册账号仅获得基础角色，不依赖预设邮箱。

### 账户注销

本人输入当前密码并二次确认后可注销。保留用户 ID 和公共贡献，状态变为 deleted，名称改为“账户已注销”，头像恢复默认、简介清空、所有个人主页可见性关闭。撤销全部会话与附加角色，仅保留不可移除的基础角色；非活跃账号不获得任何权限。登录显示“账号不存在”；后台不能重新启用，注册与找回密码不能复活原身份。作品、评论、目录及其关联保留，评论仍可在原目标下阅读。根账户须先通过既有运维流程轮换后注销。

## 4. 请求边界

### 身份加载

`AuthContext` 包含 session、用户、角色、permission key、最高 priority 和 bootstrap 身份。Hono handler 与 React Router loader 都通过 `app/.server/auth/current-user.ts` 的 `getAuthContext(runtime)` 获取身份，并在同一请求的 `AppRuntime` 中复用读取结果。每个受保护 loader 独立鉴权，不能依赖父布局代为保护。

### 同源保护

- 使用 session cookie 的 `POST | PUT | PATCH | DELETE` 必须先通过 `app/.server/auth/origin.ts` 的 `assertSameOrigin`。
- Origin 缺失、格式错误或不等于 `AppRuntime.origin` 时拒绝；不使用 Referer 降级。
- `npm run dev` 通过 Vite 开发标志将 `AppRuntime.origin` 设为当前请求 URL 的 origin，自动跟随实际主机名和端口；生产构建及预览使用配置的 `APP_ORIGIN`。可信 origin 不从 Origin 或转发请求头推导，邮件回调链接复用同一地址。
- 身份失败返回 401，身份有效但缺少能力返回 403；对象不可见时由领域服务按资源语义返回 403 或 404。

### 对象级授权

| 领域 | route/page guard | 领域服务必须再次确认 |
| --- | --- | --- |
| 上传 | import 与 storage permission | import job 属于当前上传者且状态允许操作 |
| 作品资料 | read/update permission | own/any、目标状态及关联一致性 |
| 作品关系与目录 | create/update/delete permission | 当前作品上传者或对应管理权限、目录 owner、公开性、反向关系和成员约束 |
| 评论与点赞 | `comment.manage_any`（管理员）或评论作者 own-scope | published Work、公开作者或角色、活跃用户、主楼/回复关系和评论状态 |
| 默认表情 | `emoji.defaults.manage` | 从已审核脸图库选格、调整默认顺序和保存审计；个人库仅当前账号可写 |
| 归档版本 | read/update/delete/restore/current permission | uploader、published/current、deleted/purged 状态机 |
| 用户与角色 | user/role permission 或 bootstrap 身份 | 双方 priority、角色 kind/status、自操作禁令 |
| 用户公开主页 | 本人设置的栏目可见性 | 活跃账户；栏目内容继续满足各自的 published 规则 |
| 媒体、下载与游玩 | 公开入口 | Work、ArchiveVersion 和引用链完整 published |
| GC 与审计 | maintenance/sweep/audit permission | 显式确认、数量上限、状态转换和审计 |

原生下载在 React Router 页面处理之前独立分发，同样必须执行完整 published 引用链检查。

## 5. 安全验证

通用测试分层以根目录 `AGENTS.md` 为准；本节只记录权限领域的验收面。

- `npm run check`：类型、lint、权限目录、系统角色 grant、未知 key fail closed 和静态 UI 边界。
- `npm test`：在独立临时 D1 中验证匿名访问、同源写入和管理员权限等稳定 HTTP 边界，不经过上传或浏览器流程。
- `npm run test:flow`：仅在预生产或明确要求时验证权限刷新、真实上传与恢复、归档生命周期、原生下载/GC 和浏览器安装。
- `npm run verify:preprod`：预生产完整验收；包含静态检查、关键流程和生产构建。
- `npm run smoke:staging`：部署后只验证 staging 的健康入口。
- 评论、点赞、游玩和收藏写请求沿用同源校验；公开评论还必须确认目标 Work、作者或角色、主楼和评论用户均处于可公开状态。

有状态 D1、API、Worker 和浏览器检查只通过上述测试入口串行运行。测试自行迁移和 seed 临时状态，不依赖也不重置开发环境的 `.wrangler/state`。

## 6. 非目标

当前不引入 MFA、OAuth、用户设备管理 UI、角色继承、显式 deny、动态 permission key 或旧模型兼容层。

## 7. 修改权限模型

1. 说明受保护资源、操作、scope 和领域所有权；现有 key 能准确表达时不新增。
2. 在 `PERMISSIONS` 增加 typed key，并在 `SYSTEM_ROLE_PERMISSIONS` 显式授予需要该能力的系统角色。
3. route/page 只添加身份和 permission guard；ownership、published 链、状态机或 priority 进入对应领域服务。
4. 只有新增持久权限不变量时才扩展 `npm run check` 或 `npm test`；不为每个端点新增测试，也不把文案、页面结构或操作顺序写入断言。
5. 敏捷阶段只运行与改动相关的最小检查；进入预生产后运行 `npm run verify:preprod`。
6. 只有稳定边界发生变化时更新本文；具体 key、角色 grant 和路由清单始终从代码读取。
