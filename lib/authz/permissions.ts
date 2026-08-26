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
  "series.read_private": { category: "series", label: "查看非公开系列" },
  "series.create": { category: "series", label: "创建系列" },
  "series.update": { category: "series", label: "编辑系列" },
  "release.update": { category: "release", label: "编辑发布版本" },
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

export const SYSTEM_ROLE_PERMISSIONS = {
  user: [] as const,
  uploader: [
    "work.lookup_non_deleted", "import_job.create",
    "import_job.cancel_own", "import_job.preflight_own", "import_job.commit_own",
    "storage_object.upload", "archive_version.delete_own",
  ] as const,
  admin: [
    "work.lookup_non_deleted", "import_job.create",
    "import_job.cancel_own", "import_job.preflight_own", "import_job.commit_own",
    "storage_object.upload", "archive_version.delete_own",
    "work.read_private", "work.update", "creator.read_private", "creator.update",
    "character.read_private", "character.update", "tag.read_private", "tag.update",
    "series.read_private", "series.create", "series.update", "release.update",
    "archive_version.read_private", "archive_version.update", "archive_version.delete_any",
    "archive_version.restore", "archive_version.set_current", "user.read",
    "user.status.update", "user.role.assign", "inbox.role_request.resolve",
    "system.dashboard.read", "system.maintenance.run",
  ] as const,
  super_admin: [
    "work.lookup_non_deleted", "import_job.create",
    "import_job.cancel_own", "import_job.preflight_own", "import_job.commit_own",
    "storage_object.upload", "archive_version.delete_own",
    "work.read_private", "work.update", "creator.read_private", "creator.update",
    "character.read_private", "character.update", "tag.read_private", "tag.update",
    "series.read_private", "series.create", "series.update", "release.update",
    "archive_version.read_private", "archive_version.update", "archive_version.delete_any",
    "archive_version.restore", "archive_version.set_current", "user.read",
    "user.status.update", "user.role.assign", "inbox.role_request.resolve",
    "system.dashboard.read", "system.maintenance.run",
    "storage.gc.sweep", "audit.read",
  ] as const,
} as const satisfies Record<string, readonly PermissionKey[]>;
