import type { PermissionKey } from "@/lib/authz/permissions";

export type RoleId = number;
export type RoleKey = string;
export type RoleKind = "built_in" | "bootstrap_admin" | "custom";
export type RoleStatus = "active" | "disabled";

export const CUSTOM_ROLE_PRIORITY_MIN = 101;
export const CUSTOM_ROLE_PRIORITY_MAX = 699;

export const ROLE_TEMPLATES = {
  wiki_editor: {
    key: "wiki_editor",
    name: "维基人",
    description:
      "综合维护作品、作者和游戏角色资料，整理标签、作品关联、角色分类、来源与素材。修改直接生效并记录操作；不包含实体合并、作品上下架、归档文件或账户管理。",
    priority: 300,
    permissionKeys: [
      "work.lookup_non_deleted",
      "work.read_private",
      "work.metadata.update_any",
      "creator.metadata.update_public",
      "creator.read_private",
      "creator.metadata.update_any",
      "character.admin.read",
      "character.create",
      "character.metadata.update_any",
      "character.portrait.manage_any",
      "character.portrait.upload",
      "character_category.create",
      "character_category.update",
      "character_category.delete",
      "character_membership.create",
      "character_membership.update",
      "character_membership.delete",
      "character_index.reorder",
      "character.sources.update_any",
      "tag.read_private",
      "tag.metadata.update_any",
      "relation.create_any",
      "relation.update_any",
      "relation.delete_any",
      "translation_relation.create_any",
      "translation_relation.delete_any",
    ] as const satisfies readonly PermissionKey[],
  },
} as const;

export function roleEditSnapshot(role: {
  name: string;
  description: string;
  priority: number;
  status: RoleStatus;
  applicationEnabled: boolean;
  availableToAll: boolean;
  permissionKeys: readonly string[];
}): string {
  return JSON.stringify([
    role.name,
    role.description,
    role.priority,
    role.status,
    Number(role.applicationEnabled),
    Number(role.availableToAll),
    [...role.permissionKeys].sort(),
  ]);
}

export function roleSupportsApplications(role: { key: string; kind: RoleKind }): boolean {
  return role.key === "admin" || roleSupportsGlobalAccess(role);
}

export function roleSupportsGlobalAccess(role: { key: string; kind: RoleKind }): boolean {
  return role.key === "uploader" || role.kind === "custom";
}

export function isAdministrator(user: { status: string; roleKeys: readonly string[] }): boolean {
  return user.status === "active" &&
    (user.roleKeys.includes("admin") || user.roleKeys.includes("super_admin"));
}

export function hasRoleAccess(
  user: { roleIds: readonly number[]; permissionKeys: readonly PermissionKey[]; isBootstrapAdmin: boolean },
  role: { id: number; key: string; permissionKeys: readonly PermissionKey[] },
): boolean {
  if (role.key === "admin") return user.isBootstrapAdmin || user.roleIds.includes(role.id);
  return user.roleIds.includes(role.id) ||
    (role.permissionKeys.length > 0 && role.permissionKeys.every((key) => user.permissionKeys.includes(key)));
}

export function isCustomRolePriority(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= CUSTOM_ROLE_PRIORITY_MIN &&
    value <= CUSTOM_ROLE_PRIORITY_MAX
  );
}
