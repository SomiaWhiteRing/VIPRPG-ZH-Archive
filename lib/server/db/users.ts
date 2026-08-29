import { getBootstrapAdminEmail } from "@/lib/server/auth/config";
import { hashPassword, passwordHashNeedsUpgrade, verifyPassword } from "@/lib/server/auth/password";
import { hasPermission, type PermissionKey } from "@/lib/authz/permissions";
import { getD1 } from "@/lib/server/db/d1";
import { canManageUser, listPermissionKeysForUser, listRolesForUser } from "@/lib/server/db/permissions";
import { HttpError } from "@/lib/server/http/json";

export type UserStatus = "active" | "disabled";

export type ArchiveUser = {
  id: number;
  email: string;
  externalAuthId: string;
  displayName: string;
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
};

type UserRow = {
  id: number;
  external_auth_id: string;
  email: string | null;
  display_name: string;
  status: UserStatus;
  email_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
};

type UserAuthRow = UserRow & {
  password_hash: string | null;
  failed_login_count: number;
  locked_until: string | null;
};

const USER_SELECT = `SELECT
  id,
  external_auth_id,
  email,
  display_name,
  status,
  email_verified_at,
  last_login_at,
  created_at
FROM users`;

const USER_AUTH_SELECT = `SELECT
  id,
  external_auth_id,
  email,
  display_name,
  status,
  email_verified_at,
  last_login_at,
  created_at,
  password_hash,
  failed_login_count,
  locked_until
FROM users`;

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
  const row = await getD1()
    .prepare(`${USER_SELECT} WHERE id = ?`)
    .bind(id)
    .first<UserRow>();

  return row ? hydrateUser(row) : null;
}

export async function findUserByEmail(rawEmail: string): Promise<ArchiveUser | null> {
  const row = await findUserRowByEmail(normalizeEmail(rawEmail));

  return row ? hydrateUser(row) : null;
}

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

export async function listUsersForAdmin(actor?: ArchiveUser): Promise<ArchiveUser[]> {
  const rows = await getD1()
    .prepare(
      `${USER_SELECT}
      ORDER BY created_at DESC, id DESC`,
    )
    .all<UserRow>();

  const users = await Promise.all((rows.results ?? []).map((row) => hydrateUser(row)));

  if (!actor) {
    return users;
  }

  return users.filter((user) => user.id !== actor.id && canManageUser(actor, user));
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
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const users = (await listUsersForAdmin(input.actor))
    .filter((user) => input.status && input.status !== "all" ? user.status === input.status : true)
    .filter((user) => query ? user.displayName.toLocaleLowerCase().includes(query) || user.email.toLocaleLowerCase().includes(query) || String(user.id) === query : true)
    .sort((left, right) => input.sort === "name" ? left.displayName.localeCompare(right.displayName, "zh-CN") || right.id - left.id : right.createdAt.localeCompare(left.createdAt) || right.id - left.id);
  return { items: users.slice((page - 1) * pageSize, page * pageSize), total: users.length, page, pageSize };
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

async function hydrateUser(row: UserRow): Promise<ArchiveUser> {
  const [roles, permissionKeys] = await Promise.all([
    listRolesForUser(row.id),
    listPermissionKeysForUser(row.id),
  ]);
  return {
    id: row.id,
    email: row.email ?? externalAuthIdToEmail(row.external_auth_id),
    externalAuthId: row.external_auth_id,
    displayName: row.display_name,
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
  };
}

function externalAuthIdToEmail(externalAuthId: string): string {
  return externalAuthId.startsWith("email:")
    ? externalAuthId.slice("email:".length)
    : externalAuthId;
}
