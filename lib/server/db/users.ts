import { getBootstrapAdminEmail } from "@/lib/server/auth/config";
import { verifyPassword } from "@/lib/server/auth/password";
import {
  canManageRole,
  canUploadRole,
  type UserRole,
} from "@/lib/server/auth/roles";
import { getD1 } from "@/lib/server/db/d1";

export type UserStatus = "active" | "disabled";

export type ArchiveUser = {
  id: number;
  email: string;
  externalAuthId: string;
  displayName: string;
  role: UserRole;
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
  role_key: UserRole;
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
  role_key,
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
  role_key,
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
  return user.status === "active" && canUploadRole(user.role);
}

export function canManageUser(actor: ArchiveUser, target: ArchiveUser): boolean {
  return (
    actor.status === "active" &&
    actor.id !== target.id &&
    canManageRole(actor.role, target.role)
  );
}

export async function findUserById(id: number): Promise<ArchiveUser | null> {
  const row = await getD1()
    .prepare(`${USER_SELECT} WHERE id = ?`)
    .bind(id)
    .first<UserRow>();

  return row ? mapUserRow(await ensureBootstrapSuperAdmin(row)) : null;
}

export async function findUserByEmail(rawEmail: string): Promise<ArchiveUser | null> {
  const row = await findUserRowByEmail(normalizeEmail(rawEmail));

  return row ? mapUserRow(await ensureBootstrapSuperAdmin(row)) : null;
}

export async function createOrActivateVerifiedUser(input: {
  email: string;
  passwordHash: string;
}): Promise<ArchiveUser> {
  const email = normalizeEmail(input.email);
  const externalAuthId = emailToExternalAuthId(email);
  const existing = await findUserRowByEmail(email);
  const isBootstrapAdmin = getBootstrapAdminEmail() === email;

  if (existing?.status === "disabled") {
    throw new Error("账户已被禁用");
  }

  if (existing) {
    await getD1()
      .prepare(
        `UPDATE users
        SET email = ?,
          display_name = COALESCE(NULLIF(display_name, ''), ?),
          role_key = CASE WHEN ? THEN 'super_admin' ELSE role_key END,
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
        isBootstrapAdmin ? 1 : 0,
        input.passwordHash,
        existing.id,
      )
      .run();

    return requiredUserById(existing.id);
  }

  await getD1()
    .prepare(
      `INSERT INTO users (
        external_auth_id,
        email,
        display_name,
        role_key,
        status,
        password_hash,
        password_updated_at,
        email_verified_at,
        last_login_at
      ) VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(
      externalAuthId,
      email,
      email,
      isBootstrapAdmin ? "super_admin" : "user",
      input.passwordHash,
    )
    .run();

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

  const verified = await verifyPassword(input.password, row.password_hash);

  if (!verified) {
    await recordFailedLogin(row.id, row.failed_login_count);
    throw new Error("邮箱或密码不正确");
  }

  await getD1()
    .prepare(
      `UPDATE users
      SET last_login_at = CURRENT_TIMESTAMP,
        failed_login_count = 0,
        locked_until = NULL,
        role_key = CASE WHEN ? THEN 'super_admin' ELSE role_key END
      WHERE id = ?`,
    )
    .bind(
      getBootstrapAdminEmail() === email ? 1 : 0,
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

  await getD1()
    .prepare(
      `UPDATE users
      SET password_hash = ?,
        password_updated_at = CURRENT_TIMESTAMP,
        email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
        failed_login_count = 0,
        locked_until = NULL
      WHERE id = ?`,
    )
    .bind(input.passwordHash, existing.id)
    .run();
}

export async function listUsersForAdmin(actor?: ArchiveUser): Promise<ArchiveUser[]> {
  const rows = await getD1()
    .prepare(
      `${USER_SELECT}
      ORDER BY
        CASE role_key
          WHEN 'super_admin' THEN 0
          WHEN 'admin' THEN 1
          WHEN 'uploader' THEN 2
          WHEN 'user' THEN 3
          ELSE 4
        END,
        created_at DESC
      LIMIT 500`,
    )
    .all<UserRow>();

  const users = (rows.results ?? []).map(mapUserRow);

  if (!actor) {
    return users;
  }

  return users.filter((user) => user.id !== actor.id && canManageUser(actor, user));
}

export async function setUserStatusForAdmin(input: {
  actor: ArchiveUser;
  targetUserId: number;
  status: UserStatus;
}): Promise<ArchiveUser> {
  const target = await findUserById(input.targetUserId);

  if (!target) {
    throw new Error("目标用户不存在");
  }

  if (!canManageUser(input.actor, target)) {
    throw new Error("只能管理低于自己层级的用户");
  }

  if (target.status === input.status) {
    return target;
  }

  await getD1()
    .prepare(
      `UPDATE users
      SET status = ?
      WHERE id = ?`,
    )
    .bind(input.status, target.id)
    .run();

  const updated = await findUserById(target.id);

  if (!updated) {
    throw new Error("目标用户更新后不可读取");
  }

  return updated;
}

async function recordFailedLogin(
  userId: number,
  currentFailedLoginCount: number,
): Promise<void> {
  const nextCount = currentFailedLoginCount + 1;

  await getD1()
    .prepare(
      `UPDATE users
      SET failed_login_count = ?,
        locked_until = CASE
          WHEN ? >= 5 THEN datetime('now', '+15 minutes')
          ELSE locked_until
        END
      WHERE id = ?`,
    )
    .bind(nextCount, nextCount, userId)
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

async function ensureBootstrapSuperAdmin<Row extends UserRow>(row: Row): Promise<Row> {
  const bootstrapEmail = getBootstrapAdminEmail();
  const rowEmail = row.email ?? externalAuthIdToEmail(row.external_auth_id);

  if (bootstrapEmail !== rowEmail || row.role_key === "super_admin") {
    return row;
  }

  await getD1()
    .prepare(
      `UPDATE users
      SET role_key = 'super_admin'
      WHERE id = ?`,
    )
    .bind(row.id)
    .run();

  return {
    ...row,
    role_key: "super_admin",
  };
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

function mapUserRow(row: UserRow): ArchiveUser {
  return {
    id: row.id,
    email: row.email ?? externalAuthIdToEmail(row.external_auth_id),
    externalAuthId: row.external_auth_id,
    displayName: row.display_name,
    role: row.role_key,
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
