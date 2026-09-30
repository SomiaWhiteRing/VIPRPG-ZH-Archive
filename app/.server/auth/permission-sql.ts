import type { PermissionKey } from "@/lib/authz/permissions";

// userId is a trusted SQL expression. Bind request values instead of interpolating them.
export function userPermissionSql(
  userId: string,
  permissions: PermissionKey | readonly PermissionKey[],
): string {
  const keys = typeof permissions === "string" ? [permissions] : permissions;
  return `EXISTS (SELECT 1 FROM users permission_user
    JOIN roles permission_role ON permission_role.status='active' AND (
      permission_role.available_to_all=1 OR EXISTS (SELECT 1 FROM user_roles membership
        WHERE membership.user_id=permission_user.id AND membership.role_id=permission_role.id))
    JOIN role_permissions granted_permission ON granted_permission.role_id=permission_role.id
    WHERE permission_user.id=${userId} AND permission_user.status='active'
      AND granted_permission.permission_key IN (${keys.map((key) => `'${key}'`).join(",")})
      AND NOT EXISTS (SELECT 1 FROM user_permission_blocks blocked_permission
        WHERE blocked_permission.user_id=permission_user.id
          AND blocked_permission.permission_key=granted_permission.permission_key))`;
}
