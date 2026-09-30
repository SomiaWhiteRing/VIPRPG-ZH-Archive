import type { UserAccessRow, UserRow } from "../db/user-access";
import {
  USER_ACCESS_COLUMNS,
  USER_ACCESS_JOINS,
  USER_PROFILE_COLUMNS,
  mapUserAccessRows,
} from "../db/user-access";
import { getSessionHashFromCookieHeader } from "./session-token";

export async function loadRequestSession(
  db: D1Database,
  cookie: string | null,
) {
  const hash = await getSessionHashFromCookieHeader(cookie);
  if (!hash) return null;
  return findActiveSessionByHash(db, hash);
}

export async function findActiveSessionByHash(db: D1Database, hash: string) {
  // Return the user profile once, instead of repeating it for every permission.
  const row = await db
    .prepare(
      `SELECT u.session_id,${USER_PROFILE_COLUMNS},json_group_array(json_object(
        'role_id',u.role_id,'role_key',u.role_key,'role_name',u.role_name,
        'role_priority',u.role_priority,'role_kind',u.role_kind,'permission_key',u.permission_key
      )) AS access_json FROM (SELECT s.id AS session_id,${USER_ACCESS_COLUMNS}
    FROM user_sessions s JOIN users u ON u.id=s.user_id ${USER_ACCESS_JOINS}
    WHERE s.session_hash=? AND s.revoked_at IS NULL AND datetime(s.expires_at)>CURRENT_TIMESTAMP AND u.status='active'
    ORDER BY r.priority DESC,r.id,rp.permission_key) u GROUP BY u.session_id`,
    )
    .bind(hash)
    .first<UserRow & { session_id: number; access_json: string }>();
  if (!row) return null;
  const grants = JSON.parse(row.access_json) as Array<Omit<UserAccessRow, keyof UserRow>>;
  const user = mapUserAccessRows(grants.map((grant) => ({ ...row, ...grant })))[0];
  return { user, sessionId: row.session_id };
}
