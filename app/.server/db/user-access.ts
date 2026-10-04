import type { PermissionKey } from "@/lib/authz/permissions";
import { parsePermissionKeys } from "@/lib/authz/permissions";
import type { RoleKind } from "@/lib/authz/roles";
import type { ArchiveUser, UserStatus } from "@/lib/dto/db/user-access";
import type { ProfileVisibility } from "@/lib/user-profile";
import { readAccountPreferences } from "@/lib/account-preferences";

export type UserRow = {
  id: number;
  external_auth_id: string;
  email: string | null;
  display_name: string;
  avatar_blob_sha256: string | null;
  bio: string;
  include_player_in_zip: number;
  notify_uploaded_work_comments: number;
  notify_friend_additions: number;
  show_game_card_interaction_data: number;
  hide_deleted_content: number;
  color_theme: string;
  timeline_as_homepage: number;
  account_shortcuts: string | null;
  profile_show_bio: number;
  profile_show_showcase: number;
  profile_show_timeline: number;
  profile_show_friends: number;
  profile_show_favorites: number;
  profile_show_history: number;
  profile_show_catalogs: number;
  profile_show_comments: number;
  profile_show_discussions: number;
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

export type ProfileVisibilityRow = Pick<
  UserRow,
  | "profile_show_bio"
  | "profile_show_showcase"
  | "profile_show_timeline"
  | "profile_show_friends"
  | "profile_show_favorites"
  | "profile_show_history"
  | "profile_show_catalogs"
  | "profile_show_comments"
  | "profile_show_discussions"
>;

export const USER_PROFILE_COLUMNS = `
  u.id,
  u.external_auth_id,
  u.email,
  u.display_name,
  u.avatar_blob_sha256,
  u.bio,
  u.include_player_in_zip,
  u.notify_uploaded_work_comments,
  u.notify_friend_additions,
  u.show_game_card_interaction_data,
  u.hide_deleted_content,
  u.color_theme,
  u.timeline_as_homepage,
  u.account_shortcuts,
  u.profile_show_bio,
  u.profile_show_showcase,
  u.profile_show_timeline,
  u.profile_show_friends,
  u.profile_show_favorites,
  u.profile_show_history,
  u.profile_show_catalogs,
  u.profile_show_comments,
  u.profile_show_discussions,
  u.status,
  u.email_verified_at,
  u.last_login_at,
  u.created_at,
  u.updated_at`;

export const USER_ACCESS_COLUMNS = `${USER_PROFILE_COLUMNS},
  r.id AS role_id,
  r.key AS role_key,
  r.name AS role_name,
  r.priority AS role_priority,
  r.kind AS role_kind,
  rp.permission_key`;

export const USER_ACCESS_JOINS = `
  LEFT JOIN roles r ON r.status='active' AND (
    (u.status='active' AND r.available_to_all=1)
    OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role_id=r.id)
  )
  LEFT JOIN role_permissions rp ON rp.role_id=r.id
    AND NOT EXISTS (SELECT 1 FROM user_permission_blocks blocked
      WHERE blocked.user_id=u.id AND blocked.permission_key=rp.permission_key)`;

export function mapUserAccessRows(rows: UserAccessRow[]): ArchiveUser[] {
  const users = new Map<
    number,
    {
      row: UserRow;
      roles: Map<
        number,
        {
          id: number;
          key: string;
          name: string;
          priority: number;
          kind: RoleKind;
        }
      >;
      permissionKeys: Set<string>;
    }
  >();
  for (const row of rows) {
    const entry = users.get(row.id) ?? {
      row,
      roles: new Map(),
      permissionKeys: new Set<string>(),
    };
    if (row.role_id !== null) {
      if (
        row.role_key === null ||
        row.role_name === null ||
        row.role_priority === null ||
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
    if (row.permission_key !== null)
      entry.permissionKeys.add(row.permission_key);
    users.set(row.id, entry);
  }
  return [...users.values()].map(({ row, roles, permissionKeys }) =>
    mapArchiveUser(
      row,
      [...roles.values()],
      parsePermissionKeys([...permissionKeys]),
    ),
  );
}

export function mapArchiveUser(
  row: UserRow,
  roles: Array<{
    id: number;
    key: string;
    name: string;
    priority: number;
    kind: RoleKind;
  }>,
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
    preferences: readAccountPreferences(row.include_player_in_zip, row.account_shortcuts, row.notify_uploaded_work_comments, row.show_game_card_interaction_data, row.hide_deleted_content, row.color_theme, row.timeline_as_homepage, row.notify_friend_additions),
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
  return (
    value === "built_in" || value === "bootstrap_admin" || value === "custom"
  );
}

export function mapProfileVisibility(
  row: ProfileVisibilityRow,
): ProfileVisibility {
  return {
    bio: row.profile_show_bio === 1,
    showcase: row.profile_show_showcase === 1,
    timeline: row.profile_show_timeline === 1,
    friends: row.profile_show_friends === 1,
    favorites: row.profile_show_favorites === 1,
    history: row.profile_show_history === 1,
    catalogs: row.profile_show_catalogs === 1,
    comments: row.profile_show_comments === 1,
    discussions: row.profile_show_discussions === 1,
  };
}

export function externalAuthIdToEmail(externalAuthId: string): string {
  return externalAuthId.startsWith("email:")
    ? externalAuthId.slice("email:".length)
    : externalAuthId;
}
