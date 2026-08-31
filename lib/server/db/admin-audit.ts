import { getD1 } from "@/lib/server/db/d1";
import type { RoleSnapshot } from "@/lib/server/db/inbox";

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
  action: "assigned" | "removed";
  role: RoleSnapshot;
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
  action: "assigned" | "removed";
  role_id: number | null;
  role_key_snapshot: string;
  role_name_snapshot: string;
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

export async function searchAdminAuditLogs(input: {
  query?: string;
  eventType?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: AdminAuditLog[]; total: number; page: number; pageSize: number }> {
  const pageSize = clampLimit(input.pageSize ?? 50);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const clauses: string[] = [];
  const binds: Array<string | number> = [];
  if (input.query?.trim()) {
    const value = `%${input.query.trim()}%`;
    clauses.push("(u.display_name LIKE ? OR COALESCE(a.email,u.email) LIKE ? OR CAST(a.user_id AS TEXT)=?)");
    binds.push(value, value, input.query.trim());
  }
  if (input.eventType?.trim()) {
    clauses.push("a.event_type LIKE ?");
    binds.push(`%${input.eventType.trim()}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const database = getD1();
  const [rowsResult, countResult] = await database.batch([
    database.prepare(
      `SELECT a.id,a.user_id,u.display_name AS actor_name,COALESCE(a.email,u.email) AS email,a.event_type,a.ip_hash,a.user_agent_hash,a.detail_json,a.created_at
       FROM auth_audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where}
       ORDER BY datetime(a.created_at) DESC,a.id DESC LIMIT ? OFFSET ?`,
    ).bind(...binds, pageSize, (page - 1) * pageSize),
    database.prepare(
      `SELECT COUNT(*) AS count FROM auth_audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where}`,
    ).bind(...binds),
  ]);
  return {
    items: ((rowsResult.results ?? []) as AuditLogRow[]).map(mapAuditLog),
    total: Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    page,
    pageSize,
  };
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
        e.action,
        e.role_id,
        e.role_key_snapshot,
        e.role_name_snapshot,
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
    action: row.action,
    role: { id: row.role_id, key: row.role_key_snapshot, name: row.role_name_snapshot },
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

function mapAuditLog(row: AuditLogRow): AdminAuditLog {
  return {
    id: row.id,
    userId: row.user_id,
    actorName: row.actor_name,
    email: row.email,
    eventType: row.event_type,
    ipHash: row.ip_hash,
    userAgentHash: row.user_agent_hash,
    detail: parseDetail(row.detail_json),
    createdAt: row.created_at,
  };
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.max(1, Math.min(500, Math.floor(value)));
}
