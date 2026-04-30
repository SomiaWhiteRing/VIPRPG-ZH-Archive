export const USER_ROLES = [
  "user",
  "uploader",
  "admin",
  "super_admin",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_WEIGHT: Record<UserRole, number> = {
  user: 100,
  uploader: 400,
  admin: 700,
  super_admin: 1000,
};

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}

export function roleWeight(role: UserRole): number {
  return ROLE_WEIGHT[role];
}

export function canUploadRole(role: UserRole): boolean {
  return roleWeight(role) >= roleWeight("uploader");
}

export function canManageUsersRole(role: UserRole): boolean {
  return roleWeight(role) >= roleWeight("admin");
}

export function canManageRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return roleWeight(actorRole) > roleWeight(targetRole);
}

export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return roleWeight(actorRole) > roleWeight(targetRole);
}

export function lowerRoles(actorRole: UserRole): UserRole[] {
  return USER_ROLES.filter((role) => canAssignRole(actorRole, role));
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "super_admin":
      return "超级管理员";
    case "admin":
      return "管理员";
    case "uploader":
      return "上传者";
    case "user":
      return "普通用户";
  }
}

export function legacyRoleFor(role: UserRole): "admin" | "uploader" {
  return roleWeight(role) >= roleWeight("admin") ? "admin" : "uploader";
}

export function legacyUploadStatusFor(
  role: UserRole,
): "pending" | "approved" | "rejected" {
  return canUploadRole(role) ? "approved" : "pending";
}
