import { cache } from "react";
import { getBootstrapAdminEmail } from "@/lib/server/auth/config";
import { hashPassword, passwordHashNeedsUpgrade, verifyPassword } from "@/lib/server/auth/password";
import { hasPermission, parsePermissionKeys, type PermissionKey } from "@/lib/authz/permissions";
import type { RoleKind } from "@/lib/authz/roles";
import { getD1 } from "@/lib/server/db/d1";
import { canManageUser } from "@/lib/server/db/permissions";
import { HttpError } from "@/lib/server/http/json";
import type { ProfileVisibility } from "@/lib/user-profile";

export type UserStatus = "active" | "disabled";

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

export type PublicUserProfile = Pick<
  ArchiveUser,
  "id" | "displayName" | "avatarBlobSha256" | "profileVisibility" | "createdAt"
> & { bio: string | null };

type UserRow = {
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

type UserAuthRow = UserRow & {
  password_hash: string | null;
  failed_login_count: number;
  locked_until: string | null;
};

type UserAccessRow = UserRow & {
  role_id: number | null;
  role_key: string | null;
  role_name: string | null;
  role_priority: number | null;
  role_kind: string | null;
  permission_key: string | null;
};

type SessionUserAccessRow = UserAccessRow & { session_id: number };

type ProfileVisibilityRow = Pick<
  UserRow,
  | "profile_show_bio"
  | "profile_show_favorites"
  | "profile_show_history"
  | "profile_show_catalogs"
  | "profile_show_comments"
>;

type PublicUserRow = Pick<
  UserRow,
  "id" | "display_name" | "avatar_blob_sha256" | "bio" | "created_at"
> & ProfileVisibilityRow;

const USER_SELECT = `SELECT
  id,
  external_auth_id,
  email,
  display_name,
  avatar_blob_sha256,
  bio,
  profile_show_bio,
  profile_show_favorites,
  profile_show_history,
  profile_show_catalogs,
  profile_show_comments,
  status,
  email_verified_at,
  last_login_at,
  created_at,
  updated_at
FROM users`;

const USER_AUTH_SELECT = `SELECT
  id,
  external_auth_id,
  email,
  display_name,
  avatar_blob_sha256,
  bio,
  profile_show_bio,
  profile_show_favorites,
  profile_show_history,
  profile_show_catalogs,
  profile_show_comments,
  status,
  email_verified_at,
  last_login_at,
  created_at,
  updated_at,
  password_hash,
  failed_login_count,
  locked_until
FROM users`;

const USER_ACCESS_COLUMNS = `
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

const USER_ACCESS_JOINS = `
  LEFT JOIN user_roles ur ON ur.user_id=u.id
  LEFT JOIN roles r ON r.id=ur.role_id AND r.status='active'
  LEFT JOIN role_permissions rp ON rp.role_id=r.id`;

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("邮箱格式不正确");
  }

  return email;
}

export function canUpload(user: ArchiveUser): boolean {
  return hasPermission(user, "import_job.create");
}

export async function findUserById(id: number): Promise<ArchiveUser | null> {
  const rows = await getD1()
    .prepare(
      `SELECT ${USER_ACCESS_COLUMNS}
       FROM users u
       ${USER_ACCESS_JOINS}
       WHERE u.id=?
       ORDER BY r.priority DESC,r.id,rp.permission_key`,
    )
    .bind(id)
    .all<UserAccessRow>();
  return mapUserAccessRows(rows.results ?? [])[0] ?? null;
}

export async function findUserByEmail(rawEmail: string): Promise<ArchiveUser | null> {
  const email = normalizeEmail(rawEmail);
  const rows = await getD1()
    .prepare(
      `SELECT ${USER_ACCESS_COLUMNS}
       FROM users u
       ${USER_ACCESS_JOINS}
       WHERE u.email=? OR u.external_auth_id=? OR u.external_auth_id=?
       ORDER BY r.priority DESC,r.id,rp.permission_key`,
    )
    .bind(email, emailToExternalAuthId(email), email)
    .all<UserAccessRow>();
  return mapUserAccessRows(rows.results ?? [])[0] ?? null;
}

export async function findActiveUserBySessionHash(sessionHash: string): Promise<{
  sessionId: number;
  user: ArchiveUser;
} | null> {
  const rows = await getD1()
    .prepare(
      `SELECT s.id AS session_id,${USER_ACCESS_COLUMNS}
       FROM user_sessions s
       JOIN users u ON u.id=s.user_id
       ${USER_ACCESS_JOINS}
       WHERE s.session_hash=?
         AND s.revoked_at IS NULL
         AND datetime(s.expires_at)>CURRENT_TIMESTAMP
         AND u.status='active'
       ORDER BY r.priority DESC,r.id,rp.permission_key`,
    )
    .bind(sessionHash)
    .all<SessionUserAccessRow>();
  const sessionId = rows.results?.[0]?.session_id;
  const user = mapUserAccessRows(rows.results ?? [])[0];
  return sessionId === undefined || !user ? null : { sessionId, user };
}

export const findPublicUserById = cache(async (id: number): Promise<PublicUserProfile | null> => {
  const row = await getD1()
    .prepare(
      `SELECT id,display_name,avatar_blob_sha256,bio,
              profile_show_bio,profile_show_favorites,profile_show_history,
              profile_show_catalogs,profile_show_comments,created_at
       FROM users
       WHERE id=? AND status='active'
       LIMIT 1`,
    )
    .bind(id)
    .first<PublicUserRow>();
  if (!row) return null;
  const profileVisibility = mapProfileVisibility(row);
  return {
    id: row.id,
    displayName: row.display_name,
    avatarBlobSha256: row.avatar_blob_sha256,
    bio: profileVisibility.bio ? row.bio : null,
    profileVisibility,
    createdAt: row.created_at,
  };
});

export async function createOrActivateVerifiedUser(input: {
  email: string;
  passwordHash: string;
}): Promise<ArchiveUser> {
  const email = normalizeEmail(input.email);
  const externalAuthId = emailToExternalAuthId(email);
  const existing = await findUserRowByEmail(email);

  if (existing?.status === "disabled") {
    throw new Error("账户已被禁用");
  }

  if (existing) {
    await getD1()
      .prepare(
        `UPDATE users
        SET email = ?,
          display_name = COALESCE(NULLIF(display_name, ''), ?),
          password_hash = ?,
          password_updated_at = CURRENT_TIMESTAMP,
          email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
          last_login_at = CURRENT_TIMESTAMP,
          failed_login_count = 0,
          locked_until = NULL,
          status = 'active'
        WHERE id = ?`,
      )
      .bind(
        email,
        email,
        input.passwordHash,
        existing.id,
      )
      .run();

    await ensureInitialBootstrapRole(existing.id, email);
    return requiredUserById(existing.id);
  }

  await getD1()
    .prepare(
      `INSERT INTO users (
        external_auth_id,
        email,
        display_name,
        status,
        password_hash,
        password_updated_at,
        email_verified_at,
        last_login_at
      ) VALUES (?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(
      externalAuthId,
      email,
      email,
      input.passwordHash,
    )
    .run();

  const created = await findUserRowByEmail(email);
  if (created) {
    await ensureInitialBootstrapRole(created.id, email);
  }

  return requiredUserByEmail(email);
}

export async function authenticateUser(input: {
  email: string;
  password: string;
}): Promise<ArchiveUser> {
  const email = normalizeEmail(input.email);
  const row = await findUserAuthRowByEmail(email);

  if (!row || row.status === "disabled") {
    await verifyPassword(input.password, null);
    throw new Error("邮箱或密码不正确");
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new Error("登录失败次数过多，请稍后再试");
  }

  const passwordLengthValid = input.password.length >= 12 && input.password.length <= 256;
  const verified = await verifyPassword(
    passwordLengthValid ? input.password : "invalid-password-placeholder",
    row.password_hash,
  );

  if (!passwordLengthValid || !verified) {
    await recordFailedLogin(row.id);
    throw new Error("邮箱或密码不正确");
  }

  const upgradedHash = passwordHashNeedsUpgrade(row.password_hash)
    ? await hashPassword(input.password)
    : row.password_hash;

  await getD1()
    .prepare(
      `UPDATE users
      SET password_hash = ?,
        password_updated_at = CASE WHEN password_hash <> ? THEN CURRENT_TIMESTAMP ELSE password_updated_at END,
        last_login_at = CURRENT_TIMESTAMP,
        failed_login_count = 0,
        locked_until = NULL
      WHERE id = ?`,
    )
    .bind(
      upgradedHash,
      upgradedHash,
      row.id,
    )
    .run();

  return requiredUserById(row.id);
}

export async function setUserPasswordByEmail(input: {
  email: string;
  passwordHash: string;
}): Promise<void> {
  const email = normalizeEmail(input.email);
  const existing = await findUserRowByEmail(email);

  if (!existing || existing.status === "disabled") {
    throw new Error("账户不存在或不可用");
  }

  const database = getD1();
  await database.batch([
    database.prepare(
      `UPDATE users
      SET password_hash = ?,
        password_updated_at = CURRENT_TIMESTAMP,
        email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
        failed_login_count = 0,
        locked_until = NULL
      WHERE id = ?`,
    )
    .bind(input.passwordHash, existing.id),
    database.prepare(`
      UPDATE user_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE user_id = ? AND revoked_at IS NULL
    `).bind(existing.id),
    database.prepare(`
      INSERT INTO auth_audit_logs (user_id, email, event_type)
      VALUES (?, ?, 'password_reset_completed')
    `).bind(existing.id, email),
  ]);
}

export async function updateOwnProfile(input: {
  user: ArchiveUser;
  displayName: string;
  bio: string;
}): Promise<void> {
  const displayName = input.displayName.trim();
  const bio = input.bio.trim();
  if (!displayName || [...displayName].length > 80)
    throw new HttpError(400, "显示名长度必须为 1 至 80 个字符");
  if ([...bio].length > 500) throw new HttpError(400, "简介不能超过 500 个字符");
  await getD1().batch([
    getD1().prepare(`UPDATE users SET display_name=?,bio=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(displayName, bio, input.user.id),
    getD1().prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type) VALUES(?,?,'profile_updated')`)
      .bind(input.user.id, input.user.email),
  ]);
}

export async function updateOwnProfileVisibility(input: {
  user: ArchiveUser;
  visibility: ProfileVisibility;
}): Promise<void> {
  await getD1().batch([
    getD1()
      .prepare(
        `UPDATE users
         SET profile_show_bio=?,profile_show_favorites=?,profile_show_history=?,
             profile_show_catalogs=?,profile_show_comments=?,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
      )
      .bind(
        input.visibility.bio ? 1 : 0,
        input.visibility.favorites ? 1 : 0,
        input.visibility.history ? 1 : 0,
        input.visibility.catalogs ? 1 : 0,
        input.visibility.comments ? 1 : 0,
        input.user.id,
      ),
    getD1()
      .prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type) VALUES(?,?,'profile_visibility_updated')`)
      .bind(input.user.id, input.user.email),
  ]);
}

export async function updateOwnAvatar(user: ArchiveUser, sha256: string | null): Promise<void> {
  await getD1().batch([
    getD1().prepare(`UPDATE users SET avatar_blob_sha256=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(sha256, user.id),
    getD1().prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type) VALUES(?,?,'avatar_updated')`)
      .bind(user.id, user.email),
  ]);
}

export async function verifyOwnPassword(userId: number, password: string): Promise<void> {
  const row = await findUserAuthRowById(userId);
  const validLength = password.length >= 12 && password.length <= 256;
  const valid = await verifyPassword(validLength ? password : "invalid-password-placeholder", row?.password_hash ?? null);
  if (!row || row.status !== "active" || !validLength || !valid)
    throw new HttpError(400, "当前密码不正确");
}

export async function changeOwnPassword(input: {
  user: ArchiveUser;
  currentSessionId: number;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await verifyOwnPassword(input.user.id, input.currentPassword);
  if (input.newPassword.length < 12 || input.newPassword.length > 256)
    throw new HttpError(400, "新密码长度必须为 12 至 256 个字符");
  const passwordHash = await hashPassword(input.newPassword);
  await getD1().batch([
    getD1().prepare(`UPDATE users SET password_hash=?,password_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(passwordHash, input.user.id),
    getD1().prepare(`UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE user_id=? AND id<>? AND revoked_at IS NULL`)
      .bind(input.user.id, input.currentSessionId),
    getD1().prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type) VALUES(?,?,'password_changed')`)
      .bind(input.user.id, input.user.email),
  ]);
}

export async function changeOwnEmail(input: {
  user: ArchiveUser;
  currentSessionId: number;
  newEmail: string;
}): Promise<void> {
  const newEmail = normalizeEmail(input.newEmail);
  const existing = await findUserRowByEmail(newEmail);
  if (existing && existing.id !== input.user.id) throw new HttpError(409, "该邮箱已被使用");
  await getD1().batch([
    getD1().prepare(`UPDATE users SET email=?,external_auth_id=?,email_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(newEmail, emailToExternalAuthId(newEmail), input.user.id),
    getD1().prepare(`UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE user_id=? AND id<>? AND revoked_at IS NULL`)
      .bind(input.user.id, input.currentSessionId),
    getD1().prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json) VALUES(?,?,'email_changed',?)`)
      .bind(input.user.id, newEmail, JSON.stringify({ previousEmail: input.user.email })),
  ]);
}

export async function searchUsersForAdmin(input: {
  actor: ArchiveUser;
  query?: string;
  status?: string;
  sort?: "default" | "name";
  page?: number;
  pageSize?: number;
}): Promise<{ items: ArchiveUser[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const query = input.query?.trim() ?? "";
  const clauses = [
    "u.id<>?",
    `COALESCE((
       SELECT MAX(rm.priority)
       FROM user_roles urm JOIN roles rm ON rm.id=urm.role_id AND rm.status='active'
       WHERE urm.user_id=u.id
     ),0)<?`,
  ];
  const binds: Array<string | number> = [input.actor.id, input.actor.maxRolePriority];
  if (input.status && input.status !== "all") {
    clauses.push("u.status=?");
    binds.push(input.status);
  }
  if (query) {
    clauses.push(
      `(u.display_name LIKE ? COLLATE NOCASE
        OR u.email LIKE ? COLLATE NOCASE
        OR u.external_auth_id LIKE ? COLLATE NOCASE
        OR u.id=?)`,
    );
    const pattern = `%${query}%`;
    binds.push(pattern, pattern, pattern, /^\d+$/.test(query) ? Number(query) : -1);
  }
  const where = clauses.join(" AND ");
  const order = input.sort === "name"
    ? "u.display_name COLLATE NOCASE ASC,u.id DESC"
    : "datetime(u.created_at) DESC,u.id DESC";
  const database = getD1();
  const [countResult, usersResult] = await database.batch([
    database.prepare(`SELECT COUNT(*) AS count FROM users u WHERE ${where}`).bind(...binds),
    database
      .prepare(
        `WITH eligible AS (
           SELECT u.id
           FROM users u
           WHERE ${where}
           ORDER BY ${order}
           LIMIT ? OFFSET ?
         )
         SELECT ${USER_ACCESS_COLUMNS}
         FROM eligible e
         JOIN users u ON u.id=e.id
         ${USER_ACCESS_JOINS}
         ORDER BY ${order},r.priority DESC,r.id,rp.permission_key`,
      )
      .bind(...binds, pageSize, (page - 1) * pageSize),
  ]);
  const total = Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0);
  return {
    items: mapUserAccessRows((usersResult.results ?? []) as UserAccessRow[]),
    total,
    page,
    pageSize,
  };
}

export async function setUserStatusForAdmin(input: {
  actor: ArchiveUser;
  targetUserId: number;
  status: UserStatus;
}): Promise<ArchiveUser> {
  const target = await findUserById(input.targetUserId);

  if (!target) {
    throw new HttpError(404, "目标用户不存在");
  }

  if (!hasPermission(input.actor, "user.status.update") || !canManageUser(input.actor, target)) {
    throw new HttpError(403, "只能管理自己权限范围内的用户");
  }

  if (target.status === input.status) {
    return target;
  }

  const database = getD1();
  const statements = [
    database.prepare(
      `UPDATE users
      SET status = ?
      WHERE id = ?`,
    )
    .bind(input.status, target.id),
  ];
  if (input.status === "disabled") {
    statements.push(database.prepare(`
      UPDATE user_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE user_id = ? AND revoked_at IS NULL
    `).bind(target.id));
  }
  statements.push(database.prepare(`
    INSERT INTO auth_audit_logs (user_id, email, event_type, detail_json)
    VALUES (?, ?, 'admin_user_status_update', ?)
  `).bind(input.actor.id, input.actor.email, JSON.stringify({ targetUserId: target.id, status: input.status })));
  await database.batch(statements);

  const updated = await findUserById(target.id);

  if (!updated) {
    throw new Error("目标用户更新后不可读取");
  }

  return updated;
}

async function recordFailedLogin(userId: number): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE users
      SET failed_login_count = failed_login_count + 1,
        locked_until = CASE
          WHEN failed_login_count + 1 >= 5 THEN datetime('now', '+15 minutes')
          ELSE locked_until
        END
      WHERE id = ?`,
    )
    .bind(userId)
    .run();
}

async function findUserRowByEmail(email: string): Promise<UserRow | null> {
  return getD1()
    .prepare(
      `${USER_SELECT}
      WHERE email = ? OR external_auth_id = ?
      ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END
      LIMIT 1`,
    )
    .bind(email, emailToExternalAuthId(email), email)
    .first<UserRow>();
}

async function findUserAuthRowByEmail(email: string): Promise<UserAuthRow | null> {
  return getD1()
    .prepare(
      `${USER_AUTH_SELECT}
      WHERE email = ? OR external_auth_id = ?
      ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END
      LIMIT 1`,
    )
    .bind(email, emailToExternalAuthId(email), email)
    .first<UserAuthRow>();
}

async function findUserAuthRowById(id: number): Promise<UserAuthRow | null> {
  return getD1().prepare(`${USER_AUTH_SELECT} WHERE id=? LIMIT 1`).bind(id).first<UserAuthRow>();
}

async function ensureInitialBootstrapRole(userId: number, email: string): Promise<void> {
  const database = getD1();
  if (getBootstrapAdminEmail() !== email) return;
  const existingRoot = await database.prepare(`
    SELECT 1 AS present FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE r.kind = 'bootstrap_admin' LIMIT 1
  `).first<{ present: number }>();
  if (!existingRoot) {
    const eventKey = crypto.randomUUID();
    await database.batch([
      database.prepare(`INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE key = 'super_admin'`)
        .bind(userId),
      database.prepare(`
        INSERT INTO user_role_events (
          event_key, actor_user_id, target_user_id, action, role_id,
          role_key_snapshot, role_name_snapshot, reason
        ) SELECT ?, ?, ?, 'assigned', id, key, name, 'initial_bootstrap'
        FROM roles WHERE key = 'super_admin'
      `).bind(eventKey, userId, userId),
      database.prepare(`
        INSERT INTO auth_audit_logs (user_id, email, event_type, detail_json)
        VALUES (?, ?, 'bootstrap_admin_initialized', ?)
      `).bind(userId, email, JSON.stringify({ eventKey })),
    ]);
  }
}

async function requiredUserByEmail(email: string): Promise<ArchiveUser> {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new Error("User was not created");
  }

  return user;
}

async function requiredUserById(id: number): Promise<ArchiveUser> {
  const user = await findUserById(id);

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

function emailToExternalAuthId(email: string): string {
  return `email:${email}`;
}

function mapUserAccessRows(rows: UserAccessRow[]): ArchiveUser[] {
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

function mapArchiveUser(
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

function isRoleKind(value: string | null): value is RoleKind {
  return value === "built_in" || value === "bootstrap_admin" || value === "custom";
}

function mapProfileVisibility(row: ProfileVisibilityRow): ProfileVisibility {
  return {
    bio: row.profile_show_bio === 1,
    favorites: row.profile_show_favorites === 1,
    history: row.profile_show_history === 1,
    catalogs: row.profile_show_catalogs === 1,
    comments: row.profile_show_comments === 1,
  };
}

function externalAuthIdToEmail(externalAuthId: string): string {
  return externalAuthId.startsWith("email:")
    ? externalAuthId.slice("email:".length)
    : externalAuthId;
}
