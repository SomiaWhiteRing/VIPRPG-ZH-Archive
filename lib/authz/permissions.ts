export const PERMISSION_GROUPS = {
  publishing: "作品发布",
  works: "作品维护",
  reference: "资料维护",
  community: "社区管理",
  access: "用户与授权",
  operations: "站点运维",
} as const;

export const PERMISSION_CATEGORIES = {
  external_publish: { group: "publishing", label: "外部下载" },
  archive_publish: { group: "publishing", label: "本站归档" },
  work: { group: "works", label: "作品资料" },
  archive: { group: "works", label: "版本管理" },
  relation: { group: "works", label: "关联整理" },
  creator: { group: "reference", label: "作者资料" },
  character: { group: "reference", label: "游戏角色" },
  tag: { group: "reference", label: "标签整理" },
  catalog: { group: "community", label: "作品目录" },
  comment: { group: "community", label: "评论审核" },
  forum: { group: "community", label: "讨论区" },
  emoji: { group: "community", label: "站点表情" },
  user: { group: "access", label: "账户管理" },
  role_access: { group: "access", label: "角色分配与审批" },
  system: { group: "operations", label: "运行概况" },
  maintenance: { group: "operations", label: "检查与清理" },
  audit: { group: "operations", label: "安全审计" },
} as const satisfies Record<
  string,
  { group: keyof typeof PERMISSION_GROUPS; label: string }
>;

export type PermissionCategory = keyof typeof PERMISSION_CATEGORIES;

export const PERMISSIONS = {
  "work.lookup_non_deleted": {
    category: "work",
    label: "查找未删除作品",
    scope: "有权访问的未删除作品",
    description:
      "在作品选择器中查找有权访问的未删除作品；查看非公开作品仍需相应权限或维护资格。",
  },
  "work.read_private": {
    category: "work",
    label: "查看非公开作品",
    scope: "全部作品，含非公开作品",
    description: "查看后台作品列表，包含隐藏及已删除的作品。",
  },
  "work.metadata.update_any": {
    category: "work",
    label: "编辑所有作品资料",
    scope: "全部作品资料",
    description:
      "编辑任意作品的名称、简介、标签、作者、角色和展示资料；不改变发布状态、维护者或文件。",
  },
  "work.status.update_any": {
    category: "work",
    label: "调整所有作品状态",
    scope: "全部作品状态",
    description: "发布、隐藏或删除任意作品。",
  },
  "work.maintainer.manage_any": {
    category: "work",
    label: "管理作品维护者",
    scope: "全部作品维护者名单",
    description: "添加或移除作品维护者。",
  },
  "work.merge_any": {
    category: "work",
    label: "合并作品",
    scope: "符合条件的重复作品",
    description: "将重复作品合并；还需普通关联和翻译关联的相应删除能力。",
  },
  "creator.read_private": {
    category: "creator",
    label: "查看非公开作者",
    scope: "全部作者，含非公开作者",
    description: "查看后台作者列表，包含尚未关联公开作品的作者。",
  },
  "creator.metadata.update_any": {
    category: "creator",
    label: "编辑所有作者资料",
    scope: "全部作者资料",
    description: "编辑作者名称、别名、说明和头像；不包含合并作者。",
  },
  "creator.merge_any": {
    category: "creator",
    label: "合并作者",
    scope: "符合条件的重复作者",
    description: "将重复作者及其关联合并。",
  },
  "character.read_private": {
    category: "character",
    label: "查看非公开游戏角色",
    scope: "全部游戏角色，含非公开角色",
    description: "查看后台游戏角色列表；此处指作品中的人物，不是账户角色。",
  },
  "character.metadata.update_any": {
    category: "character",
    label: "编辑所有游戏角色资料",
    scope: "全部游戏角色资料",
    description: "创建、编辑游戏角色，维护头像图集；不包含合并角色。",
  },
  "tag.read_private": {
    category: "tag",
    label: "查看非公开标签",
    scope: "全部标签，含非公开标签",
    description: "查看后台标签列表，包含未用于公开作品的标签。",
  },
  "tag.metadata.update_any": {
    category: "tag",
    label: "编辑所有标签资料",
    scope: "全部标签资料",
    description: "编辑标签名称、命名空间和说明；不包含合并标签。",
  },
  "work.update_own": {
    category: "work",
    label: "管理自己维护的作品",
    scope: "自己维护的作品",
    description:
      "编辑、隐藏或删除自己有维护资格的作品；维护资格由作品维护者名单决定。",
  },
  "work.external_create": {
    category: "external_publish",
    label: "创建外部下载作品",
    scope: "新建外部下载作品",
    description: "创建通过外部下载链接分发的作品，不授予本站归档上传权限。",
  },
  "relation.create": {
    category: "relation",
    label: "创建作品关联",
    scope: "有权访问的作品",
    description: "为有权访问的作品新增关联；不允许修改或删除已有关联。",
  },
  "relation.create_any": {
    category: "relation",
    label: "创建所有作品关联",
    scope: "全部作品",
    description: "创建任意作品之间的普通关联。",
  },
  "relation.update_any": {
    category: "relation",
    label: "修改所有作品关联",
    scope: "全部普通关联",
    description: "修改普通关联类型。",
  },
  "relation.delete_any": {
    category: "relation",
    label: "删除所有作品关联",
    scope: "全部普通关联",
    description: "删除普通作品关联。",
  },
  "translation_relation.create_any": {
    category: "relation",
    label: "创建所有翻译关联",
    scope: "全部作品",
    description: "创建任意原作与译作关系。",
  },
  "translation_relation.create": {
    category: "relation",
    label: "创建翻译关联",
    scope: "有权访问的作品",
    description: "为有权访问的作品建立原作与译作关系；不允许修改或删除已有翻译关联。",
  },
  "translation_relation.delete_any": {
    category: "relation",
    label: "删除所有翻译关联",
    scope: "全部翻译关联",
    description: "删除原作与译作关系。",
  },
  "catalog.create": {
    category: "catalog",
    label: "创建作品目录",
    scope: "新建本人目录",
    description: "创建属于自己的作品目录。",
  },
  "catalog.update_own": {
    category: "catalog",
    label: "编辑自己的目录资料",
    scope: "本人创建的目录",
    description: "修改本人目录的标题、简介和封面；收录作品由目录条目权限控制。",
  },
  "catalog.delete_own": {
    category: "catalog",
    label: "删除自己的目录",
    scope: "本人创建的目录",
    description: "删除本人创建的目录，不删除目录中收录的作品。",
  },
  "catalog.reorder_own": {
    category: "catalog",
    label: "管理自己的目录条目",
    scope: "本人目录中的条目",
    description:
      "添加、移除、排序收录的作品，并修改条目备注；只能收录已发布作品。",
  },
  "catalog.manage_any": {
    category: "catalog",
    label: "管理所有目录",
    scope: "全部目录及其条目",
    description: "创建目录，编辑或删除任意用户的目录及其条目。",
  },
  "comment.manage_any": {
    category: "comment",
    label: "审核所有评论",
    scope: "全部未删除评论",
    description: "隐藏评论或恢复被隐藏的评论；已删除评论不能恢复。",
  },
  "forum.content.moderate_any": {
    category: "forum", label: "审核讨论内容", scope: "全部讨论与举报",
    description: "查看审核上下文，隐藏或恢复被隐藏内容，锁定或解锁主题并处理举报。",
  },
  "forum.topic.feature_any": {
    category: "forum", label: "策展公开讨论", scope: "全部公开主题",
    description: "加精、取消加精及纠正主题 TAG；不授予举报处理或全站 TAG 管理能力。",
  },
  "forum.tag.manage": {
    category: "forum", label: "管理讨论 TAG", scope: "全部讨论 TAG",
    description: "改名、合并、停用、隐藏或恢复讨论 TAG。",
  },
  "custom_emoji.manage": {
    category: "emoji",
    label: "管理站点表情",
    scope: "全部站点表情",
    description:
      "上传表情、调整名称与分类，停用或恢复表情；表情短代码不可修改。",
  },
  "archive_version.read_private": {
    category: "archive",
    label: "查看非公开归档",
    scope: "全部归档，含非公开版本",
    description: "查看归档管理列表，包含隐藏及已删除的版本。",
  },
  "archive_version.update": {
    category: "archive",
    label: "编辑所有归档资料",
    scope: "未删除、未最终清理的归档",
    description:
      "修改归档来源及公开状态；已删除版本必须先恢复，最终清理后不可编辑。",
  },
  "archive_version.delete_own": {
    category: "archive",
    label: "删除自己维护的归档",
    scope: "自己维护作品的归档",
    description: "将自己维护的作品中的归档移入回收站；不限于本人上传的版本。",
  },
  "archive_version.delete_any": {
    category: "archive",
    label: "删除任意归档",
    scope: "任意作品的归档",
    description: "将任意作品的归档移入回收站，不立即清理存储文件。",
  },
  "archive_version.restore": {
    category: "archive",
    label: "恢复回收站归档",
    scope: "未最终清理的回收站归档",
    description: "恢复尚未最终清理的归档；已清理的归档不能恢复。",
  },
  "archive_version.set_current": {
    category: "archive",
    label: "切换当前归档",
    scope: "符合条件的已发布归档",
    description:
      "将符合条件的已发布归档设为当前版本，改变下载与游玩使用的版本。",
  },
  "import_job.create": {
    category: "archive_publish",
    label: "创建上传任务",
    scope: "本人的上传任务",
    description:
      "创建、查看及续接自己的上传任务；完成上传还需预检、文件上传和提交权限。",
  },
  "import_job.preflight_own": {
    category: "archive_publish",
    label: "预检自己的上传任务",
    scope: "本人的上传任务",
    description: "检查本人任务的文件清单与缺失文件，确认源文件上传完成。",
  },
  "storage_object.upload": {
    category: "archive_publish",
    label: "上传归档文件",
    scope: "本人任务中的归档文件",
    description:
      "向本人处于可上传状态的任务上传文件与核心包；不单独授予发布权限。",
  },
  "import_job.commit_own": {
    category: "archive_publish",
    label: "提交自己的上传任务",
    scope: "本人的上传任务",
    description: "确认资料并提交本人任务；更新已有作品还需对应作品的编辑权限。",
  },
  "import_job.cancel_own": {
    category: "archive_publish",
    label: "取消自己的上传任务",
    scope: "本人可取消的上传任务",
    description: "取消本人尚可取消的上传任务，不能操作他人的任务。",
  },
  "user.read": {
    category: "user",
    label: "查看可管理用户",
    scope: "较低层级用户",
    description: "查看权限层级低于自己的用户，不包含自己或同级及更高层级用户。",
  },
  "user.status.update": {
    category: "user",
    label: "启用或禁用用户",
    scope: "较低层级、未注销用户",
    description:
      "调整较低层级用户的账户状态；禁用会撤销其会话，已注销账户不可启用。",
  },
  "user.role.assign": {
    category: "role_access",
    label: "分配或移除账户角色",
    scope: "较低层级活跃用户和角色",
    description:
      "仅能为较低层级的活跃用户调整较低层级角色；不能操作自己、移除基础角色或授予根角色。",
  },
  "inbox.role_request.resolve": {
    category: "role_access",
    label: "审批上传权限申请",
    scope: "符合角色分配条件的申请",
    description:
      "通过或驳回角色申请；还需角色分配权限，并满足用户与角色的层级限制。",
  },
  "system.dashboard.read": {
    category: "system",
    label: "查看管理仪表盘",
    scope: "全站统计及上传任务记录",
    description:
      "查看站点概况、运行统计与上传任务记录；不自动包含其他后台权限。",
  },
  "system.maintenance.run": {
    category: "maintenance",
    label: "检查一致性与清理计划",
    scope: "全站数据与存储",
    description: "查看数据一致性检查及存储清理预览；实际清理需另行授权。",
  },
  "storage.gc.sweep": {
    category: "maintenance",
    label: "执行最终存储清理",
    scope: "符合清理条件的存储对象",
    description:
      "执行符合清理条件的存储回收；清理后的归档不能恢复，操作需要确认。",
  },
  "audit.read": {
    category: "audit",
    label: "查看安全审计日志",
    scope: "全站安全与操作记录",
    description: "查看登录、账户角色调整及后台维护操作记录。",
  },
} as const satisfies Record<
  string,
  {
    category: PermissionCategory;
    label: string;
    scope: string;
    description: string;
  }
>;

export type PermissionKey = keyof typeof PERMISSIONS;
export type PermissionDefinition = {
  key: PermissionKey;
  category: PermissionCategory;
  label: string;
  scope: string;
  description: string;
};

const PERMISSION_KEY_SET = new Set<string>(Object.keys(PERMISSIONS));

export const PERMISSION_LIST: readonly PermissionDefinition[] = Object.entries(
  PERMISSIONS,
).map(([key, definition]) => ({ key: key as PermissionKey, ...definition }));

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && PERMISSION_KEY_SET.has(value);
}

export function parsePermissionKeys(
  values: readonly unknown[],
): PermissionKey[] {
  const result = new Set<PermissionKey>();
  for (const value of values) {
    if (!isPermissionKey(value))
      throw new Error(`Unknown permission key: ${String(value)}`);
    result.add(value);
  }
  return [...result];
}

export function hasPermission(
  user: {
    status: "active" | "disabled" | "deleted";
    permissionKeys: readonly PermissionKey[];
  } | null,
  permission: PermissionKey,
): boolean {
  return user?.status === "active" && user.permissionKeys.includes(permission);
}

export function hasPermissionKey(
  permissionKeys: readonly PermissionKey[],
  permission: PermissionKey,
): boolean {
  return permissionKeys.includes(permission);
}

export const ARCHIVE_UPLOAD_PERMISSIONS = [
  "import_job.create",
  "import_job.preflight_own",
  "storage_object.upload",
  "import_job.commit_own",
] as const satisfies readonly PermissionKey[];

export function canPublishArchive(
  user: Parameters<typeof hasPermission>[0],
): boolean {
  return ARCHIVE_UPLOAD_PERMISSIONS.every((key) => hasPermission(user, key));
}

export function canPublishWork(
  user: Parameters<typeof hasPermission>[0],
): boolean {
  return canPublishArchive(user) || hasPermission(user, "work.external_create");
}

export function canAccessOwnWorks(
  user: Parameters<typeof hasPermission>[0],
): boolean {
  return canPublishWork(user) || hasPermission(user, "work.update_own");
}

export function hasUploaderAccess(
  user: Parameters<typeof hasPermission>[0],
): boolean {
  return SYSTEM_ROLE_PERMISSIONS.uploader.every((key) =>
    hasPermission(user, key),
  );
}

export function canMergeWorks(
  user: Parameters<typeof hasPermission>[0],
): boolean {
  return (
    [
      "work.merge_any",
      "relation.delete_any",
      "translation_relation.delete_any",
    ] as const
  ).every((key) => hasPermission(user, key));
}

export function permissionConfigurationWarnings(
  keys: readonly PermissionKey[],
): string[] {
  const warnings: string[] = [];
  if (ARCHIVE_UPLOAD_PERMISSIONS.some((key) => keys.includes(key))) {
    const missing = ARCHIVE_UPLOAD_PERMISSIONS.filter(
      (key) => !keys.includes(key),
    );
    if (missing.length)
      warnings.push(
        `完成本站归档发布还需：${missing.map((key) => PERMISSIONS[key].label).join("、")}。`,
      );
  }
  const dependencies: Partial<Record<PermissionKey, PermissionKey>> = {
    "work.metadata.update_any": "work.read_private",
    "work.status.update_any": "work.metadata.update_any",
    "work.maintainer.manage_any": "work.metadata.update_any",
    "work.merge_any": "work.metadata.update_any",
    "creator.merge_any": "creator.metadata.update_any",
    "creator.metadata.update_any": "creator.read_private",
    "character.metadata.update_any": "character.read_private",
    "tag.metadata.update_any": "tag.read_private",
    "archive_version.update": "archive_version.read_private",
    "archive_version.delete_any": "archive_version.read_private",
    "archive_version.set_current": "archive_version.read_private",
    "user.role.assign": "user.read",
    "user.status.update": "user.read",
    "inbox.role_request.resolve": "user.role.assign",
    "storage.gc.sweep": "system.maintenance.run",
  };
  if (keys.includes("work.merge_any")) {
    const missing = (["relation.delete_any", "translation_relation.delete_any"] as const).filter((key) => !keys.includes(key));
    if (missing.length) warnings.push(`合并作品还需：${missing.map((key) => PERMISSIONS[key].label).join("、")}。`);
  }
  for (const [key, dependency] of Object.entries(dependencies)) {
    if (keys.includes(key as PermissionKey) && !keys.includes(dependency)) {
      warnings.push(
        `使用“${PERMISSIONS[key as PermissionKey].label}”的完整管理入口还需“${PERMISSIONS[dependency].label}”。`,
      );
    }
  }
  return warnings;
}

export type RelationEditorCapabilities = {
  canCreateRelation: boolean;
  canCreateTranslation: boolean;
  canUpdate: boolean;
  canDeleteRelation: boolean;
  canDeleteTranslation: boolean;
  canManageRelationsAny: boolean;
  canManageTranslationsAny: boolean;
};

export function getRelationEditorCapabilities(
  user: {
    status: "active" | "disabled" | "deleted";
    permissionKeys: readonly PermissionKey[];
  } | null,
): RelationEditorCapabilities {
  const relationAny =
    hasPermission(user, "relation.create_any") ||
    hasPermission(user, "relation.update_any") ||
    hasPermission(user, "relation.delete_any");
  const translationAny =
    hasPermission(user, "translation_relation.create_any") ||
    hasPermission(user, "translation_relation.delete_any");
  return {
    canCreateRelation: hasPermission(user, "relation.create") || hasPermission(user, "relation.create_any"),
    canCreateTranslation: hasPermission(user, "translation_relation.create") || hasPermission(user, "translation_relation.create_any"),
    canUpdate: hasPermission(user, "relation.update_any"),
    canDeleteRelation: hasPermission(user, "relation.delete_any"),
    canDeleteTranslation: hasPermission(
      user,
      "translation_relation.delete_any",
    ),
    canManageRelationsAny: relationAny,
    canManageTranslationsAny: translationAny,
  };
}

export const SYSTEM_ROLE_PERMISSIONS = {
  user: [
    "work.lookup_non_deleted",
    "relation.create",
    "translation_relation.create",
    "catalog.create",
    "catalog.update_own",
    "catalog.delete_own",
    "catalog.reorder_own",
  ] as const,
  uploader: [
    "work.lookup_non_deleted",
    "work.update_own",
    "work.external_create",
    "import_job.create",
    "import_job.cancel_own",
    "import_job.preflight_own",
    "import_job.commit_own",
    "storage_object.upload",
    "archive_version.delete_own",
    "relation.create",
    "translation_relation.create",
    "catalog.create",
    "catalog.update_own",
    "catalog.delete_own",
    "catalog.reorder_own",
  ] as const,
  admin: [
    "work.lookup_non_deleted",
    "work.update_own",
    "work.external_create",
    "import_job.create",
    "import_job.cancel_own",
    "import_job.preflight_own",
    "import_job.commit_own",
    "storage_object.upload",
    "archive_version.delete_own",
    "relation.create",
    "translation_relation.create",
    "catalog.create",
    "catalog.update_own",
    "catalog.delete_own",
    "catalog.reorder_own",
    "work.read_private",
    "work.metadata.update_any", "work.status.update_any", "work.maintainer.manage_any", "work.merge_any",
    "creator.read_private",
    "creator.metadata.update_any", "creator.merge_any",
    "character.read_private",
    "character.metadata.update_any",
    "tag.read_private",
    "tag.metadata.update_any",
    "relation.create_any", "relation.update_any", "relation.delete_any",
    "translation_relation.create_any", "translation_relation.delete_any",
    "catalog.manage_any",
    "comment.manage_any",
    "forum.content.moderate_any", "forum.topic.feature_any", "forum.tag.manage",
    "custom_emoji.manage",
    "archive_version.read_private",
    "archive_version.update",
    "archive_version.delete_any",
    "archive_version.restore",
    "archive_version.set_current",
    "user.read",
    "user.status.update",
    "user.role.assign",
    "inbox.role_request.resolve",
    "system.dashboard.read",
    "system.maintenance.run",
  ] as const,
  super_admin: [
    "work.lookup_non_deleted",
    "work.update_own",
    "work.external_create",
    "import_job.create",
    "import_job.cancel_own",
    "import_job.preflight_own",
    "import_job.commit_own",
    "storage_object.upload",
    "archive_version.delete_own",
    "relation.create",
    "translation_relation.create",
    "catalog.create",
    "catalog.update_own",
    "catalog.delete_own",
    "catalog.reorder_own",
    "work.read_private",
    "work.metadata.update_any", "work.status.update_any", "work.maintainer.manage_any", "work.merge_any",
    "creator.read_private",
    "creator.metadata.update_any", "creator.merge_any",
    "character.read_private",
    "character.metadata.update_any",
    "tag.read_private",
    "tag.metadata.update_any",
    "relation.create_any", "relation.update_any", "relation.delete_any",
    "translation_relation.create_any", "translation_relation.delete_any",
    "catalog.manage_any",
    "comment.manage_any",
    "forum.content.moderate_any", "forum.topic.feature_any", "forum.tag.manage",
    "custom_emoji.manage",
    "archive_version.read_private",
    "archive_version.update",
    "archive_version.delete_any",
    "archive_version.restore",
    "archive_version.set_current",
    "user.read",
    "user.status.update",
    "user.role.assign",
    "inbox.role_request.resolve",
    "system.dashboard.read",
    "system.maintenance.run",
    "storage.gc.sweep",
    "audit.read",
  ] as const,
} as const satisfies Record<string, readonly PermissionKey[]>;
