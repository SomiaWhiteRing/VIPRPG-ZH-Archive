export const PERMISSIONS = {
  "work.lookup_non_deleted": { category: "work", label: "查找未删除作品" },
  "work.read_private": { category: "work", label: "查看非公开作品" },
  "work.update": { category: "work", label: "编辑作品" },
  "creator.read_private": { category: "creator", label: "查看非公开作者" },
  "creator.update": { category: "creator", label: "编辑作者" },
  "character.read_private": { category: "character", label: "查看非公开角色" },
  "character.update": { category: "character", label: "编辑角色" },
  "tag.read_private": { category: "tag", label: "查看非公开标签" },
  "tag.update": { category: "tag", label: "编辑标签" },
  "work.update_own": { category: "work", label: "编辑自己上传的游戏" },
  "relation.create": { category: "relation", label: "创建作品关联" },
  "relation.update_own": { category: "relation", label: "编辑自己创建的作品关联" },
  "relation.delete_own": { category: "relation", label: "删除自己创建的作品关联" },
  "relation.manage_any": { category: "relation", label: "管理任意作品关联" },
  "translation_relation.create": { category: "relation", label: "创建翻译关联" },
  "translation_relation.update_own": { category: "relation", label: "排序自己创建的翻译关联" },
  "translation_relation.delete_own": { category: "relation", label: "删除自己创建的翻译关联" },
  "translation_relation.manage_any": { category: "relation", label: "管理任意翻译关联" },
  "catalog.create": { category: "catalog", label: "创建目录" },
  "catalog.update_own": { category: "catalog", label: "编辑自己的目录" },
  "catalog.delete_own": { category: "catalog", label: "删除自己的目录" },
  "catalog.reorder_own": { category: "catalog", label: "排序自己的目录" },
  "catalog.manage_any": { category: "catalog", label: "管理任意目录" },
  "work_comment.manage_any": { category: "comment", label: "管理任意评论" },
  "custom_emoji.manage": { category: "comment", label: "管理站点自定义表情" },
  "archive_version.read_private": { category: "archive", label: "查看非公开归档" },
  "archive_version.update": { category: "archive", label: "编辑归档" },
  "archive_version.delete_own": { category: "archive", label: "删除自己上传的归档" },
  "archive_version.delete_any": { category: "archive", label: "删除任意归档" },
  "archive_version.restore": { category: "archive", label: "还原归档" },
  "archive_version.set_current": { category: "archive", label: "切换当前归档" },
  "import_job.create": { category: "import", label: "创建导入任务" },
  "import_job.cancel_own": { category: "import", label: "取消自己的导入任务" },
  "import_job.preflight_own": { category: "import", label: "预检自己的导入任务" },
  "import_job.commit_own": { category: "import", label: "提交自己的导入任务" },
  "storage_object.upload": { category: "storage", label: "上传存储对象" },
  "user.read": { category: "user", label: "查看可管理用户" },
  "user.status.update": { category: "user", label: "更新用户状态" },
  "user.role.assign": { category: "user", label: "分配用户角色" },
  "inbox.role_request.resolve": { category: "inbox", label: "处理角色申请" },
  "system.dashboard.read": { category: "system", label: "查看管理仪表盘" },
  "system.maintenance.run": { category: "system", label: "运行维护检查" },
  "storage.gc.sweep": { category: "storage", label: "执行最终存储清理" },
  "audit.read": { category: "audit", label: "查看审计日志" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export type PermissionDefinition = { key: PermissionKey; category: string; label: string };

const PERMISSION_KEY_SET = new Set<string>(Object.keys(PERMISSIONS));

export const PERMISSION_LIST: readonly PermissionDefinition[] = Object.entries(PERMISSIONS)
  .map(([key, definition]) => ({ key: key as PermissionKey, ...definition }))
  .sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key));

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && PERMISSION_KEY_SET.has(value);
}

export function parsePermissionKeys(values: readonly unknown[]): PermissionKey[] {
  const result = new Set<PermissionKey>();
  for (const value of values) {
    if (!isPermissionKey(value)) throw new Error(`Unknown permission key: ${String(value)}`);
    result.add(value);
  }
  return [...result];
}

export function hasPermission(
  user: { status: "active" | "disabled"; permissionKeys: readonly PermissionKey[] } | null,
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

export type RelationEditorCapabilities = {
  canCreateRelation: boolean;
  canCreateTranslation: boolean;
  canUpdate: boolean;
  canUpdateTranslation: boolean;
  canDeleteRelation: boolean;
  canDeleteTranslation: boolean;
  canManageRelationsAny: boolean;
  canManageTranslationsAny: boolean;
};

export function getRelationEditorCapabilities(
  user: {
    status: "active" | "disabled";
    permissionKeys: readonly PermissionKey[];
  } | null,
): RelationEditorCapabilities {
  const relationAny = hasPermission(user, "relation.manage_any");
  const translationAny = hasPermission(user, "translation_relation.manage_any");
  return {
    canCreateRelation: hasPermission(user, "relation.create") || relationAny,
    canCreateTranslation:
      hasPermission(user, "translation_relation.create") || translationAny,
    canUpdate: hasPermission(user, "relation.update_own") || relationAny,
    canUpdateTranslation:
      hasPermission(user, "translation_relation.update_own") || translationAny,
    canDeleteRelation:
      hasPermission(user, "relation.delete_own") || relationAny,
    canDeleteTranslation:
      hasPermission(user, "translation_relation.delete_own") || translationAny,
    canManageRelationsAny: relationAny,
    canManageTranslationsAny: translationAny,
  };
}

export const SYSTEM_ROLE_PERMISSIONS = {
  user: [
    "work.lookup_non_deleted", "relation.create", "relation.update_own", "relation.delete_own",
    "translation_relation.create", "translation_relation.update_own", "translation_relation.delete_own",
    "catalog.create", "catalog.update_own", "catalog.delete_own", "catalog.reorder_own",
  ] as const,
  uploader: [
    "work.lookup_non_deleted", "work.update_own", "import_job.create",
    "import_job.cancel_own", "import_job.preflight_own", "import_job.commit_own",
    "storage_object.upload", "archive_version.delete_own", "relation.create", "relation.update_own", "relation.delete_own",
    "translation_relation.create", "translation_relation.update_own", "translation_relation.delete_own",
    "catalog.create", "catalog.update_own", "catalog.delete_own", "catalog.reorder_own",
  ] as const,
  admin: [
    "work.lookup_non_deleted", "work.update_own", "import_job.create",
    "import_job.cancel_own", "import_job.preflight_own", "import_job.commit_own",
    "storage_object.upload", "archive_version.delete_own", "relation.create", "relation.update_own", "relation.delete_own",
    "translation_relation.create", "translation_relation.update_own", "translation_relation.delete_own",
    "catalog.create", "catalog.update_own", "catalog.delete_own", "catalog.reorder_own",
    "work.read_private", "work.update", "creator.read_private", "creator.update",
    "character.read_private", "character.update", "tag.read_private", "tag.update",
    "relation.manage_any", "translation_relation.manage_any", "catalog.manage_any",
    "work_comment.manage_any", "custom_emoji.manage",
    "archive_version.read_private", "archive_version.update", "archive_version.delete_any",
    "archive_version.restore", "archive_version.set_current", "user.read",
    "user.status.update", "user.role.assign", "inbox.role_request.resolve",
    "system.dashboard.read", "system.maintenance.run",
  ] as const,
  super_admin: [
    "work.lookup_non_deleted", "work.update_own", "import_job.create",
    "import_job.cancel_own", "import_job.preflight_own", "import_job.commit_own",
    "storage_object.upload", "archive_version.delete_own", "relation.create", "relation.update_own", "relation.delete_own",
    "translation_relation.create", "translation_relation.update_own", "translation_relation.delete_own",
    "catalog.create", "catalog.update_own", "catalog.delete_own", "catalog.reorder_own",
    "work.read_private", "work.update", "creator.read_private", "creator.update",
    "character.read_private", "character.update", "tag.read_private", "tag.update",
    "relation.manage_any", "translation_relation.manage_any", "catalog.manage_any",
    "work_comment.manage_any", "custom_emoji.manage",
    "archive_version.read_private", "archive_version.update", "archive_version.delete_any",
    "archive_version.restore", "archive_version.set_current", "user.read",
    "user.status.update", "user.role.assign", "inbox.role_request.resolve",
    "system.dashboard.read", "system.maintenance.run",
    "storage.gc.sweep", "audit.read",
  ] as const,
} as const satisfies Record<string, readonly PermissionKey[]>;
