import type { SessionUserAccessRow } from "../db/user-access";
import {
  USER_ACCESS_COLUMNS,
  USER_ACCESS_JOINS,
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
  const rows = await db
    .prepare(
      `SELECT s.id AS session_id,${USER_ACCESS_COLUMNS}
    FROM user_sessions s JOIN users u ON u.id=s.user_id ${USER_ACCESS_JOINS}
    WHERE s.session_hash=? AND s.revoked_at IS NULL AND datetime(s.expires_at)>CURRENT_TIMESTAMP AND u.status='active'
    ORDER BY r.priority DESC,r.id,rp.permission_key`,
    )
    .bind(hash)
    .all<SessionUserAccessRow>();
  const user = mapUserAccessRows(rows.results)[0];
  return user ? { user, sessionId: rows.results[0].session_id } : null;
}
