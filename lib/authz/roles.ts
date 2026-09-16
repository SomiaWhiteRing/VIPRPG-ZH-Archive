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
      "维护作品、作者、角色、标签及作品关联资料；允许移除错误关联，不授予作品发布、实体删除、归档文件、维护者或账户管理能力。",
    priority: 300,
    permissionKeys: [
      "work.lookup_non_deleted",
      "work.read_private",
      "work.metadata.update_any",
      "creator.read_private",
      "creator.metadata.update_any",
      "character.admin.read",
      "character.create",
      "character.metadata.update_any",
      "character.portrait.manage_any",
      "character.portrait.upload",
      "character_category.create",
      "character_category.update",
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
  permissionKeys: readonly string[];
}): string {
  return JSON.stringify([
    role.name,
    role.description,
    role.priority,
    role.status,
    [...role.permissionKeys].sort(),
  ]);
}

export function isCustomRolePriority(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= CUSTOM_ROLE_PRIORITY_MIN &&
    value <= CUSTOM_ROLE_PRIORITY_MAX
  );
}
