import { getD1 } from "@/lib/server/db/d1";
import type { UserRole } from "@/lib/server/auth/roles";

export type AdminAuditLog = {
  id: number;
  userId: number | null;
  actorName: string | null;
  email: string | null;
  eventType: string;
  ipHash: string | null;
  userAgentHash: string | null;
  detail: unknown;
  createdAt: string;
};

export type AdminRoleEvent = {
  id: number;
  actorUserId: number | null;
  actorName: string | null;
  targetUserId: number;
  targetName: string | null;
  oldRole: UserRole;
  newRole: UserRole;
  reason: string | null;
  sourceInboxItemId: number | null;
  createdAt: string;
};

type AuditLogRow = {
  id: number;
  user_id: number | null;
  actor_name: string | null;
  email: string | null;
  event_type: string;
  ip_hash: string | null;
  user_agent_hash: string | null;
  detail_json: string | null;
  created_at: string;
};

type RoleEventRow = {
  id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  target_user_id: number;
  target_name: string | null;
  old_role_key: UserRole;
  new_role_key: UserRole;
  reason: string | null;
  source_inbox_item_id: number | null;
  created_at: string;
};

export async function listAdminAuditLogs(limit = 200): Promise<AdminAuditLog[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        a.id,
        a.user_id,
        u.display_name AS actor_name,
        COALESCE(a.email, u.email) AS email,
        a.event_type,
        a.ip_hash,
        a.user_agent_hash,
        a.detail_json,
        a.created_at
      FROM auth_audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY datetime(a.created_at) DESC, a.id DESC
      LIMIT ?`,
    )
    .bind(clampLimit(limit))
    .all<AuditLogRow>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    actorName: row.actor_name,
    email: row.email,
    eventType: row.event_type,
    ipHash: row.ip_hash,
    userAgentHash: row.user_agent_hash,
    detail: parseDetail(row.detail_json),
    createdAt: row.created_at,
  }));
}

export async function listAdminRoleEvents(limit = 100): Promise<AdminRoleEvent[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        e.id,
        e.actor_user_id,
        actor.display_name AS actor_name,
        e.target_user_id,
        target.display_name AS target_name,
        e.old_role_key,
        e.new_role_key,
        e.reason,
        e.source_inbox_item_id,
        e.created_at
      FROM user_role_events e
      LEFT JOIN users actor ON actor.id = e.actor_user_id
      LEFT JOIN users target ON target.id = e.target_user_id
      ORDER BY datetime(e.created_at) DESC, e.id DESC
      LIMIT ?`,
    )
    .bind(clampLimit(limit))
    .all<RoleEventRow>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    targetUserId: row.target_user_id,
    targetName: row.target_name,
    oldRole: row.old_role_key,
    newRole: row.new_role_key,
    reason: row.reason,
    sourceInboxItemId: row.source_inbox_item_id,
    createdAt: row.created_at,
  }));
}

function parseDetail(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.max(1, Math.min(500, Math.floor(value)));
}
