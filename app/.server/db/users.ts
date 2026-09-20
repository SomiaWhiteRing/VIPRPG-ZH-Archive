import type { AppRuntime } from "@/app/.server/runtime";
import { memoizeRequest } from "@/app/.server/runtime";
import type { ArchiveUser, UserStatus } from "@/lib/dto/db/user-access";
import type { PublicUserProfile } from "@/lib/dto/db/users";
import type { ProfileVisibility } from "@/lib/user-profile";
import { findActiveSessionByHash } from "../auth/request-auth";
import { userSearchVisibilityStatement } from "../forum/search-index";
import type {
  ProfileVisibilityRow,
  UserAccessRow,
  UserRow,
} from "./user-access";
import {
  USER_ACCESS_COLUMNS,
  USER_ACCESS_JOINS,
  mapProfileVisibility,
  mapUserAccessRows,
} from "./user-access";

import { getBootstrapAdminEmail } from "@/app/.server/auth/config";
import {
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "@/app/.server/auth/password";
import { hasPermission } from "@/lib/authz/permissions";

import { getD1 } from "@/app/.server/db/d1";
import {
  canManageUser,
  userManagementScopeSql,
} from "@/app/.server/db/permissions";
import { HttpError } from "@/lib/http";

type UserAuthRow = UserRow & {
  password_hash: string | null;
  failed_login_count: number;
  locked_until: string | null;
};

type PublicUserRow = Pick<
  UserRow,
  "id" | "display_name" | "avatar_blob_sha256" | "bio" | "created_at"
> &
  ProfileVisibilityRow;

const USER_SELECT = `SELECT
  id,
  external_auth_id,
  email,
  display_name,
  avatar_blob_sha256,
  bio,
  profile_show_bio,
  profile_show_showcase,
  profile_show_favorites,
  profile_show_history,
  profile_show_catalogs,
  profile_show_comments,
  profile_show_discussions,
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
  profile_show_showcase,
  profile_show_favorites,
  profile_show_history,
  profile_show_catalogs,
  profile_show_comments,
  profile_show_discussions,
  status,
  email_verified_at,
  last_login_at,
  created_at,
  updated_at,
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

export async function findUserById(
  runtime: AppRuntime,
  id: number,
): Promise<ArchiveUser | null> {
  const rows = await getD1(runtime)
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

export async function findUserByEmail(
  runtime: AppRuntime,
  rawEmail: string,
): Promise<ArchiveUser | null> {
  const email = normalizeEmail(rawEmail);
  const rows = await getD1(runtime)
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

export async function findActiveUserBySessionHash(
  runtime: AppRuntime,
  sessionHash: string,
): Promise<{
  sessionId: number;
  user: ArchiveUser;
} | null> {
  return findActiveSessionByHash(getD1(runtime), sessionHash);
}

export const findPublicUserById = async (
  runtime: AppRuntime,
  id: number,
): Promise<PublicUserProfile | null> => {
  return memoizeRequest(runtime, `public-user:${id}`, async () => {
    const row = await getD1(runtime)
      .prepare(
        `SELECT id,display_name,avatar_blob_sha256,bio,
              profile_show_bio,profile_show_showcase,profile_show_favorites,profile_show_history,
              profile_show_catalogs,profile_show_comments,profile_show_discussions,created_at
       FROM users
       WHERE id=? AND status IN ('active','deleted')
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
};

export async function createOrActivateVerifiedUser(
  runtime: AppRuntime,
  input: {
    email: string;
    passwordHash: string;
  },
): Promise<ArchiveUser> {
  const email = normalizeEmail(input.email);
  const externalAuthId = emailToExternalAuthId(email);
  const existing = await findUserRowByEmail(runtime, email);

  if (existing?.status === "deleted") throw new Error("账号不存在");
  if (existing?.status === "disabled") {
    throw new Error("账户已被禁用");
  }

  if (existing) {
    await getD1(runtime)
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
      .bind(email, email, input.passwordHash, existing.id)
      .run();

    await ensureInitialBootstrapRole(runtime, existing.id, email);
    return requiredUserById(runtime, existing.id);
  }

  await getD1(runtime)
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
    .bind(externalAuthId, email, email, input.passwordHash)
    .run();

  const created = await findUserRowByEmail(runtime, email);
  if (created) {
    await ensureInitialBootstrapRole(runtime, created.id, email);
  }

  return requiredUserByEmail(runtime, email);
}

export async function authenticateUser(
  runtime: AppRuntime,
  input: {
    email: string;
    password: string;
  },
): Promise<ArchiveUser> {
  const email = normalizeEmail(input.email);
  const row = await findUserAuthRowByEmail(runtime, email);

  if (!row || row.status === "deleted") {
    await verifyPassword(input.password, null);
    throw new Error("账号不存在");
  }
  if (row.status === "disabled") {
    await verifyPassword(input.password, null);
    throw new Error("邮箱或密码不正确");
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new Error("登录失败次数过多，请稍后再试");
  }

  const passwordLengthValid =
    input.password.length >= 12 && input.password.length <= 256;
  const verified = await verifyPassword(
    passwordLengthValid ? input.password : "invalid-password-placeholder",
    row.password_hash,
  );

  if (!passwordLengthValid || !verified) {
    await recordFailedLogin(runtime, row.id);
    throw new Error("邮箱或密码不正确");
  }

  const upgradedHash = passwordHashNeedsUpgrade(row.password_hash)
    ? await hashPassword(input.password)
    : row.password_hash;

  await getD1(runtime)
    .prepare(
      `UPDATE users
      SET password_hash = ?,
        password_updated_at = CASE WHEN password_hash <> ? THEN CURRENT_TIMESTAMP ELSE password_updated_at END,
        last_login_at = CURRENT_TIMESTAMP,
        failed_login_count = 0,
        locked_until = NULL
      WHERE id = ?`,
    )
    .bind(upgradedHash, upgradedHash, row.id)
    .run();

  return requiredUserById(runtime, row.id);
}

export async function setUserPasswordByEmail(
  runtime: AppRuntime,
  input: {
    email: string;
    passwordHash: string;
  },
): Promise<void> {
  const email = normalizeEmail(input.email);
  const existing = await findUserRowByEmail(runtime, email);

  if (!existing || existing.status !== "active") {
    throw new Error("账户不存在或不可用");
  }

  const database = getD1(runtime);
  await database.batch([
    database
      .prepare(
        `UPDATE users
      SET password_hash = ?,
        password_updated_at = CURRENT_TIMESTAMP,
        email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
        failed_login_count = 0,
        locked_until = NULL
      WHERE id = ?`,
      )
      .bind(input.passwordHash, existing.id),
    database
      .prepare(
        `
      UPDATE user_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE user_id = ? AND revoked_at IS NULL
    `,
      )
      .bind(existing.id),
    database
      .prepare(
        `
      INSERT INTO auth_audit_logs (user_id, email, event_type)
      VALUES (?, ?, 'password_reset_completed')
    `,
      )
      .bind(existing.id, email),
  ]);
}

export async function updateOwnProfile(
  runtime: AppRuntime,
  input: {
    user: ArchiveUser;
    displayName: string;
    bio: string;
  },
): Promise<void> {
  const displayName = input.displayName.trim();
  const bio = input.bio.trim();
  if (!displayName || [...displayName].length > 80)
    throw new HttpError(400, "显示名长度必须为 1 至 80 个字符");
  if ([...bio].length > 500)
    throw new HttpError(400, "简介不能超过 500 个字符");
  await getD1(runtime).batch([
    getD1(runtime)
      .prepare(
        `UPDATE users SET display_name=?,bio=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .bind(displayName, bio, input.user.id),
    getD1(runtime)
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type) VALUES(?,?,'profile_updated')`,
      )
      .bind(input.user.id, input.user.email),
  ]);
}

export async function updateOwnProfileVisibility(
  runtime: AppRuntime,
  input: {
    user: ArchiveUser;
    visibility: ProfileVisibility;
  },
): Promise<void> {
  await getD1(runtime).batch([
    getD1(runtime)
      .prepare(
        `UPDATE users
         SET profile_show_bio=?,profile_show_showcase=?,profile_show_favorites=?,profile_show_history=?,
             profile_show_catalogs=?,profile_show_comments=?,profile_show_discussions=?,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
      )
      .bind(
        input.visibility.bio ? 1 : 0,
        input.visibility.showcase ? 1 : 0,
        input.visibility.favorites ? 1 : 0,
        input.visibility.history ? 1 : 0,
        input.visibility.catalogs ? 1 : 0,
        input.visibility.comments ? 1 : 0,
        input.visibility.discussions ? 1 : 0,
        input.user.id,
      ),
    getD1(runtime)
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type) VALUES(?,?,'profile_visibility_updated')`,
      )
      .bind(input.user.id, input.user.email),
  ]);
}

export async function updateOwnAvatar(
  runtime: AppRuntime,
  user: ArchiveUser,
  sha256: string | null,
): Promise<void> {
  await getD1(runtime).batch([
    getD1(runtime)
      .prepare(
        `UPDATE users SET avatar_blob_sha256=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .bind(sha256, user.id),
    getD1(runtime)
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type) VALUES(?,?,'avatar_updated')`,
      )
      .bind(user.id, user.email),
  ]);
}

export async function verifyOwnPassword(
  runtime: AppRuntime,
  userId: number,
  password: string,
): Promise<void> {
  const row = await findUserAuthRowById(runtime, userId);
  const validLength = password.length >= 12 && password.length <= 256;
  const valid = await verifyPassword(
    validLength ? password : "invalid-password-placeholder",
    row?.password_hash ?? null,
  );
  if (!row || row.status !== "active" || !validLength || !valid)
    throw new HttpError(400, "当前密码不正确");
}

export async function changeOwnPassword(
  runtime: AppRuntime,
  input: {
    user: ArchiveUser;
    currentSessionId: number;
    currentPassword: string;
    newPassword: string;
  },
): Promise<void> {
  await verifyOwnPassword(runtime, input.user.id, input.currentPassword);
  if (input.newPassword.length < 12 || input.newPassword.length > 256)
    throw new HttpError(400, "新密码长度必须为 12 至 256 个字符");
  const passwordHash = await hashPassword(input.newPassword);
  await getD1(runtime).batch([
    getD1(runtime)
      .prepare(
        `UPDATE users SET password_hash=?,password_updated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .bind(passwordHash, input.user.id),
    getD1(runtime)
      .prepare(
        `UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE user_id=? AND id<>? AND revoked_at IS NULL`,
      )
      .bind(input.user.id, input.currentSessionId),
    getD1(runtime)
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type) VALUES(?,?,'password_changed')`,
      )
      .bind(input.user.id, input.user.email),
  ]);
}

export async function changeOwnEmail(
  runtime: AppRuntime,
  input: {
    user: ArchiveUser;
    currentSessionId: number;
    newEmail: string;
  },
): Promise<void> {
  const newEmail = normalizeEmail(input.newEmail);
  const existing = await findUserRowByEmail(runtime, newEmail);
  if (existing && existing.id !== input.user.id)
    throw new HttpError(409, "该邮箱已被使用");
  await getD1(runtime).batch([
    getD1(runtime)
      .prepare(
        `UPDATE users SET email=?,external_auth_id=?,email_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .bind(newEmail, emailToExternalAuthId(newEmail), input.user.id),
    getD1(runtime)
      .prepare(
        `UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE user_id=? AND id<>? AND revoked_at IS NULL`,
      )
      .bind(input.user.id, input.currentSessionId),
    getD1(runtime)
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json) VALUES(?,?,'email_changed',?)`,
      )
      .bind(
        input.user.id,
        newEmail,
        JSON.stringify({ previousEmail: input.user.email }),
      ),
  ]);
}

export async function searchUsersForAdmin(
  runtime: AppRuntime,
  input: {
    actor: ArchiveUser;
    query?: string;
    status?: string;
    sort?: "default" | "name";
    page?: number;
    pageSize?: number;
  },
): Promise<{
  items: ArchiveUser[];
  total: number;
  page: number;
  pageSize: number;
}> {
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
  const binds: Array<string | number> = [
    input.actor.id,
    input.actor.maxRolePriority,
  ];
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
    binds.push(
      pattern,
      pattern,
      pattern,
      /^\d+$/.test(query) ? Number(query) : -1,
    );
  }
  const where = clauses.join(" AND ");
  const order =
    input.sort === "name"
      ? "u.display_name COLLATE NOCASE ASC,u.id DESC"
      : "datetime(u.created_at) DESC,u.id DESC";
  const database = getD1(runtime);
  const [countResult, usersResult] = await database.batch([
    database
      .prepare(`SELECT COUNT(*) AS count FROM users u WHERE ${where}`)
      .bind(...binds),
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
  const total = Number(
    (countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0,
  );
  return {
    items: mapUserAccessRows((usersResult.results ?? []) as UserAccessRow[]),
    total,
    page,
    pageSize,
  };
}

export async function setUserStatusForAdmin(
  runtime: AppRuntime,
  input: {
    actor: ArchiveUser;
    targetUserId: number;
    status: UserStatus;
  },
): Promise<ArchiveUser> {
  const target = await findUserById(runtime, input.targetUserId);

  if (!target) {
    throw new HttpError(404, "目标用户不存在");
  }

  if (
    !hasPermission(input.actor, "user.status.update") ||
    !canManageUser(input.actor, target)
  ) {
    throw new HttpError(403, "只能管理自己权限范围内的用户");
  }

  if (target.status === "deleted" || input.status === "deleted")
    throw new HttpError(400, "已注销账户不能启用，注销须由本人操作");
  if (target.status === input.status) {
    return target;
  }

  const database = getD1(runtime);
  const statements = [
    database
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
      SELECT ?,?,'admin_user_status_update',? FROM users target WHERE target.id=? AND target.status=?
        AND target.status<>'deleted' AND ${userManagementScopeSql("user.status.update", "target.id")}`,
      )
      .bind(
        input.actor.id,
        input.actor.email,
        JSON.stringify({
          targetUserId: target.id,
          before: target.status,
          status: input.status,
        }),
        target.id,
        target.status,
        input.actor.id,
      ),
    database
      .prepare(
        `UPDATE users
      SET status = ?
      WHERE id = ? AND changes() = 1`,
      )
      .bind(input.status, target.id),
  ];
  if (input.status === "disabled") {
    statements.push(
      database
        .prepare(
          `
      UPDATE user_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE user_id = ? AND revoked_at IS NULL AND changes() = 1
    `,
        )
        .bind(target.id),
    );
  }
  statements.push(userSearchVisibilityStatement(database, target.id));
  const [authorization] = await database.batch(statements);
  if (Number(authorization.meta.changes) !== 1)
    throw new HttpError(409, "账户或管理权限已变化，请刷新后重试。");

  const updated = await findUserById(runtime, target.id);

  if (!updated) {
    throw new Error("目标用户更新后不可读取");
  }

  return updated;
}

async function recordFailedLogin(
  runtime: AppRuntime,
  userId: number,
): Promise<void> {
  await getD1(runtime)
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

async function findUserRowByEmail(
  runtime: AppRuntime,
  email: string,
): Promise<UserRow | null> {
  return getD1(runtime)
    .prepare(
      `${USER_SELECT}
      WHERE email = ? OR external_auth_id = ?
      ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END
      LIMIT 1`,
    )
    .bind(email, emailToExternalAuthId(email), email)
    .first<UserRow>();
}

async function findUserAuthRowByEmail(
  runtime: AppRuntime,
  email: string,
): Promise<UserAuthRow | null> {
  return getD1(runtime)
    .prepare(
      `${USER_AUTH_SELECT}
      WHERE email = ? OR external_auth_id = ?
      ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END
      LIMIT 1`,
    )
    .bind(email, emailToExternalAuthId(email), email)
    .first<UserAuthRow>();
}

async function findUserAuthRowById(
  runtime: AppRuntime,
  id: number,
): Promise<UserAuthRow | null> {
  return getD1(runtime)
    .prepare(`${USER_AUTH_SELECT} WHERE id=? LIMIT 1`)
    .bind(id)
    .first<UserAuthRow>();
}

async function ensureInitialBootstrapRole(
  runtime: AppRuntime,
  userId: number,
  email: string,
): Promise<void> {
  const database = getD1(runtime);
  if (getBootstrapAdminEmail(runtime) !== email) return;
  const existingRoot = await database
    .prepare(
      `
    SELECT 1 AS present FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE r.kind = 'bootstrap_admin' LIMIT 1
  `,
    )
    .first<{ present: number }>();
  if (!existingRoot) {
    const eventKey = crypto.randomUUID();
    await database.batch([
      database
        .prepare(
          `INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE key = 'super_admin'`,
        )
        .bind(userId),
      database
        .prepare(
          `
        INSERT INTO user_role_events (
          event_key, actor_user_id, target_user_id, action, role_id,
          role_key_snapshot, role_name_snapshot, reason
        ) SELECT ?, ?, ?, 'assigned', id, key, name, 'initial_bootstrap'
        FROM roles WHERE key = 'super_admin'
      `,
        )
        .bind(eventKey, userId, userId),
      database
        .prepare(
          `
        INSERT INTO auth_audit_logs (user_id, email, event_type, detail_json)
        VALUES (?, ?, 'bootstrap_admin_initialized', ?)
      `,
        )
        .bind(userId, email, JSON.stringify({ eventKey })),
    ]);
  }
}

async function requiredUserByEmail(
  runtime: AppRuntime,
  email: string,
): Promise<ArchiveUser> {
  const user = await findUserByEmail(runtime, email);

  if (!user) {
    throw new Error("User was not created");
  }

  return user;
}

async function requiredUserById(
  runtime: AppRuntime,
  id: number,
): Promise<ArchiveUser> {
  const user = await findUserById(runtime, id);

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

function emailToExternalAuthId(email: string): string {
  return `email:${email}`;
}

export async function deleteOwnAccount(
  runtime: AppRuntime,
  user: ArchiveUser,
  password: string,
): Promise<void> {
  if (user.isBootstrapAdmin)
    throw new HttpError(400, "请先轮换根账户，再注销此账户");
  await verifyOwnPassword(runtime, user.id, password);
  const db = getD1(runtime);
  await db.batch([
    db.prepare("DELETE FROM user_showcase_entries WHERE user_id=?").bind(user.id),
    db
      .prepare(
        `UPDATE users SET status='deleted',display_name='账户已注销',avatar_blob_sha256=NULL,
      bio='',password_hash=NULL,profile_show_bio=0,profile_show_showcase=0,profile_show_favorites=0,profile_show_history=0,
      profile_show_catalogs=0,profile_show_comments=0,profile_show_discussions=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'`,
      )
      .bind(user.id),
    db
      .prepare(
        `UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE user_id=?`,
      )
      .bind(user.id),
    db
      .prepare(
        `DELETE FROM user_roles WHERE user_id=? AND role_id NOT IN (SELECT id FROM roles WHERE key='user')`,
      )
      .bind(user.id),
    db
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type) VALUES(?,?,'account_deleted')`,
      )
      .bind(user.id, user.email),
  ]);
}
