import { getBootstrapAdminEmail } from "@/lib/server/auth/config";
import { verifyPassword } from "@/lib/server/auth/password";
import { getD1 } from "@/lib/server/db/d1";

export type UserRole = "admin" | "uploader";
export type UploadStatus = "pending" | "approved" | "rejected";
export type UserStatus = "active" | "disabled";

export type ArchiveUser = {
  id: number;
  email: string;
  externalAuthId: string;
  displayName: string;
  role: UserRole;
  uploadStatus: UploadStatus;
  status: UserStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  approvedAt: string | null;
  approvedByUserId: number | null;
};

type UserRow = {
  id: number;
  external_auth_id: string;
  email: string | null;
  display_name: string;
  role: UserRole;
  upload_status: UploadStatus;
  status: UserStatus;
  email_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by_user_id: number | null;
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
  role,
  upload_status,
  status,
  email_verified_at,
  last_login_at,
  created_at,
  approved_at,
  approved_by_user_id
FROM users`;

const USER_AUTH_SELECT = `SELECT
  id,
  external_auth_id,
  email,
  display_name,
  role,
  upload_status,
  status,
  email_verified_at,
  last_login_at,
  created_at,
  approved_at,
  approved_by_user_id,
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
  return (
    user.status === "active" &&
    (user.role === "admin" || user.uploadStatus === "approved")
  );
}

export async function findUserById(id: number): Promise<ArchiveUser | null> {
  const row = await getD1()
    .prepare(`${USER_SELECT} WHERE id = ?`)
    .bind(id)
    .first<UserRow>();

  return row ? mapUserRow(row) : null;
}

export async function findUserByEmail(rawEmail: string): Promise<ArchiveUser | null> {
  const row = await findUserRowByEmail(normalizeEmail(rawEmail));

  return row ? mapUserRow(row) : null;
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
          role = CASE WHEN ? THEN 'admin' ELSE role END,
          upload_status = CASE WHEN ? THEN 'approved' ELSE upload_status END,
          approved_at = CASE WHEN ? THEN COALESCE(approved_at, CURRENT_TIMESTAMP) ELSE approved_at END,
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
        isBootstrapAdmin ? 1 : 0,
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
        role,
        upload_status,
        status,
        password_hash,
        password_updated_at,
        email_verified_at,
        last_login_at,
        approved_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ${
        isBootstrapAdmin ? "CURRENT_TIMESTAMP" : "NULL"
      })`,
    )
    .bind(
      externalAuthId,
      email,
      email,
      isBootstrapAdmin ? "admin" : "uploader",
      isBootstrapAdmin ? "approved" : "pending",
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
        role = CASE WHEN ? THEN 'admin' ELSE role END,
        upload_status = CASE WHEN ? THEN 'approved' ELSE upload_status END,
        approved_at = CASE WHEN ? THEN COALESCE(approved_at, CURRENT_TIMESTAMP) ELSE approved_at END
      WHERE id = ?`,
    )
    .bind(
      getBootstrapAdminEmail() === email ? 1 : 0,
      getBootstrapAdminEmail() === email ? 1 : 0,
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

export async function listUsersForAdmin(): Promise<ArchiveUser[]> {
  const rows = await getD1()
    .prepare(
      `${USER_SELECT}
      ORDER BY
        CASE upload_status
          WHEN 'pending' THEN 0
          WHEN 'rejected' THEN 1
          ELSE 2
        END,
        created_at DESC
      LIMIT 200`,
    )
    .all<UserRow>();

  return (rows.results ?? []).map(mapUserRow);
}

export async function listPendingUploaders(): Promise<ArchiveUser[]> {
  const rows = await getD1()
    .prepare(
      `${USER_SELECT}
      WHERE role = 'uploader' AND upload_status = 'pending' AND status = 'active'
      ORDER BY created_at ASC
      LIMIT 200`,
    )
    .all<UserRow>();

  return (rows.results ?? []).map(mapUserRow);
}

export async function requestUploadAccess(userId: number): Promise<ArchiveUser> {
  await getD1()
    .prepare(
      `UPDATE users
      SET upload_status = 'pending',
        approved_at = NULL,
        approved_by_user_id = NULL
      WHERE id = ? AND role = 'uploader' AND upload_status <> 'approved'`,
    )
    .bind(userId)
    .run();

  return requiredUserById(userId);
}

export async function approveUploader(
  userId: number,
  approvedByUserId: number,
): Promise<ArchiveUser> {
  await getD1()
    .prepare(
      `UPDATE users
      SET upload_status = 'approved',
        approved_at = CURRENT_TIMESTAMP,
        approved_by_user_id = ?
      WHERE id = ? AND role = 'uploader'`,
    )
    .bind(approvedByUserId, userId)
    .run();

  return requiredUserById(userId);
}

export async function rejectUploader(
  userId: number,
  approvedByUserId: number,
): Promise<ArchiveUser> {
  await getD1()
    .prepare(
      `UPDATE users
      SET upload_status = 'rejected',
        approved_at = NULL,
        approved_by_user_id = ?
      WHERE id = ? AND role = 'uploader'`,
    )
    .bind(approvedByUserId, userId)
    .run();

  return requiredUserById(userId);
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
    role: row.role,
    uploadStatus: row.upload_status,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    approvedByUserId: row.approved_by_user_id,
  };
}

function externalAuthIdToEmail(externalAuthId: string): string {
  return externalAuthId.startsWith("email:")
    ? externalAuthId.slice("email:".length)
    : externalAuthId;
}
