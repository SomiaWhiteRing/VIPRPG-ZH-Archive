import { parsePermissionKeys, type PermissionKey } from "@/lib/authz/permissions";
import type { RoleKind } from "@/lib/authz/roles";
import type { ProfileVisibility } from "@/lib/user-profile";

export type UserStatus = "active" | "disabled" | "deleted";

export type ArchiveUser = {
  id: number;
  email: string;
  externalAuthId: string;
  displayName: string;
  avatarBlobSha256: string | null;
  bio: string;
  profileVisibility: ProfileVisibility;
  roleIds: number[];
  roleKeys: string[];
  roleNames: string[];
  permissionKeys: PermissionKey[];
  maxRolePriority: number;
  isBootstrapAdmin: boolean;
  status: UserStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserRow = {
  id: number;
  external_auth_id: string;
  email: string | null;
  display_name: string;
  avatar_blob_sha256: string | null;
  bio: string;
  profile_show_bio: number;
  profile_show_favorites: number;
  profile_show_history: number;
  profile_show_catalogs: number;
  profile_show_comments: number;
  status: UserStatus;
  email_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserAccessRow = UserRow & {
  role_id: number | null;
  role_key: string | null;
  role_name: string | null;
  role_priority: number | null;
  role_kind: string | null;
  permission_key: string | null;
};

export type SessionUserAccessRow = UserAccessRow & { session_id: number };

export type ProfileVisibilityRow = Pick<
  UserRow,
  | "profile_show_bio"
  | "profile_show_favorites"
  | "profile_show_history"
  | "profile_show_catalogs"
  | "profile_show_comments"
>;

export const USER_ACCESS_COLUMNS = `
  u.id,
  u.external_auth_id,
  u.email,
  u.display_name,
  u.avatar_blob_sha256,
  u.bio,
  u.profile_show_bio,
  u.profile_show_favorites,
  u.profile_show_history,
  u.profile_show_catalogs,
  u.profile_show_comments,
  u.status,
  u.email_verified_at,
  u.last_login_at,
  u.created_at,
  u.updated_at,
  r.id AS role_id,
  r.key AS role_key,
  r.name AS role_name,
  r.priority AS role_priority,
  r.kind AS role_kind,
  rp.permission_key`;

export const USER_ACCESS_JOINS = `
  LEFT JOIN user_roles ur ON ur.user_id=u.id
  LEFT JOIN roles r ON r.id=ur.role_id AND r.status='active'
  LEFT JOIN role_permissions rp ON rp.role_id=r.id`;

export function mapUserAccessRows(rows: UserAccessRow[]): ArchiveUser[] {
  const users = new Map<number, {
    row: UserRow;
    roles: Map<number, { id: number; key: string; name: string; priority: number; kind: RoleKind }>;
    permissionKeys: Set<string>;
  }>();
  for (const row of rows) {
    const entry = users.get(row.id) ?? {
      row,
      roles: new Map(),
      permissionKeys: new Set<string>(),
    };
    if (row.role_id !== null) {
      if (
        row.role_key === null || row.role_name === null || row.role_priority === null ||
        !isRoleKind(row.role_kind)
      ) {
        throw new Error(`Invalid role row for user ${row.id}`);
      }
      entry.roles.set(row.role_id, {
        id: row.role_id,
        key: row.role_key,
        name: row.role_name,
        priority: row.role_priority,
        kind: row.role_kind,
      });
    }
    if (row.permission_key !== null) entry.permissionKeys.add(row.permission_key);
    users.set(row.id, entry);
  }
  return [...users.values()].map(({ row, roles, permissionKeys }) =>
    mapArchiveUser(row, [...roles.values()], parsePermissionKeys([...permissionKeys]))
  );
}

export function mapArchiveUser(
  row: UserRow,
  roles: Array<{ id: number; key: string; name: string; priority: number; kind: RoleKind }>,
  permissionKeys: PermissionKey[],
): ArchiveUser {
  return {
    id: row.id,
    email: row.email ?? externalAuthIdToEmail(row.external_auth_id),
    externalAuthId: row.external_auth_id,
    displayName: row.display_name,
    avatarBlobSha256: row.avatar_blob_sha256,
    bio: row.bio,
    profileVisibility: mapProfileVisibility(row),
    roleIds: roles.map((role) => role.id),
    roleKeys: roles.map((role) => role.key),
    roleNames: roles.map((role) => role.name),
    permissionKeys,
    maxRolePriority: Math.max(0, ...roles.map((role) => role.priority)),
    isBootstrapAdmin: roles.some((role) => role.kind === "bootstrap_admin"),
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isRoleKind(value: string | null): value is RoleKind {
  return value === "built_in" || value === "bootstrap_admin" || value === "custom";
}

export function mapProfileVisibility(row: ProfileVisibilityRow): ProfileVisibility {
  return {
    bio: row.profile_show_bio === 1,
    favorites: row.profile_show_favorites === 1,
    history: row.profile_show_history === 1,
    catalogs: row.profile_show_catalogs === 1,
    comments: row.profile_show_comments === 1,
  };
}

export function externalAuthIdToEmail(externalAuthId: string): string {
  return externalAuthId.startsWith("email:")
    ? externalAuthId.slice("email:".length)
    : externalAuthId;
}
