import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import type { AdminAuditLog, AdminRoleEvent } from "@/lib/dto/db/admin-audit";
import { auditRecord } from "@/lib/entity-audit";

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

export async function searchAdminAuditLogs(
  runtime: AppRuntime,
  input: {
    query?: string;
    eventType?: string;
    targetType?: string;
    targetId?: string;
    logId?: number;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  items: AdminAuditLog[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const pageSize = clampLimit(input.pageSize ?? 50);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const clauses: string[] = [];
  const detailSql = "CASE WHEN json_valid(a.detail_json) THEN a.detail_json ELSE NULL END";
  const binds: Array<string | number> = [];
  if (input.logId) { clauses.push("a.id=?"); binds.push(input.logId); }
  if (input.query?.trim()) {
    const value = `%${input.query.trim()}%`;
    clauses.push(
      `(u.display_name LIKE ? OR COALESCE(a.email,u.email) LIKE ? OR CAST(a.user_id AS TEXT)=? OR json_extract(${detailSql},'$.actor.displayName') LIKE ? OR CAST(json_extract(${detailSql},'$.actor.userId') AS TEXT)=?)`,
    );
    binds.push(value, value, input.query.trim(), value, input.query.trim());
  }
  if (input.eventType?.trim()) {
    clauses.push("a.event_type LIKE ?");
    binds.push(`%${input.eventType.trim()}%`);
  }
  if (input.targetType || input.targetId?.trim()) {
    const targetClauses: string[] = [];
    if (input.targetType) { targetClauses.push("json_extract(target.value,'$.type')=?"); binds.push(input.targetType); }
    if (input.targetId?.trim()) { targetClauses.push("CAST(json_extract(target.value,'$.id') AS TEXT)=?"); binds.push(input.targetId.trim()); }
    const legacyTypes = ["work", "creator", "character", "category", "tag"].filter((type) => !input.targetType || type === input.targetType);
    const legacyClauses = legacyTypes.map((type) => {
      const path = type === "tag" ? "$.originalName" : `$.${type}Id`;
      if (!input.targetId?.trim()) return `json_extract(${detailSql},'${path}') IS NOT NULL`;
      binds.push(input.targetId.trim());
      return `CAST(json_extract(${detailSql},'${path}') AS TEXT)=?`;
    });
    if (!input.targetType || input.targetType === "genre_group") {
      for (const path of ["$.sourceGroup", "$.targetGroup"]) {
        const event = "a.event_type='admin_genre_merge'";
        if (input.targetId?.trim()) {
          legacyClauses.push(`(${event} AND CAST(json_extract(${detailSql},'${path}') AS TEXT)=?)`);
          binds.push(input.targetId.trim());
        } else legacyClauses.push(`(${event} AND json_extract(${detailSql},'${path}') IS NOT NULL)`);
      }
    }
    clauses.push(`(EXISTS(SELECT 1 FROM json_each(${detailSql},'$.targets') target WHERE ${targetClauses.join(" AND ")})
      ${legacyClauses.length ? `OR (${legacyClauses.join(" OR ")})` : ""})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const database = getD1(runtime);
  const [rowsResult, countResult] = await database.batch([
    database
      .prepare(
        `SELECT a.id,a.user_id,u.display_name AS actor_name,COALESCE(a.email,u.email) AS email,a.event_type,a.ip_hash,a.user_agent_hash,a.detail_json,a.created_at
       FROM auth_audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where}
       ORDER BY datetime(a.created_at) DESC,a.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(...binds, pageSize, (page - 1) * pageSize),
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM auth_audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where}`,
      )
      .bind(...binds),
  ]);
  return {
    items: ((rowsResult.results ?? []) as AuditLogRow[]).map(mapAuditLog),
    total: Number(
      (countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    page,
    pageSize,
  };
}

export async function listAdminRoleEvents(
  runtime: AppRuntime,
  limit = 100,
): Promise<AdminRoleEvent[]> {
  const rows = await getD1(runtime)
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
    role: {
      id: row.role_id,
      key: row.role_key_snapshot,
      name: row.role_name_snapshot,
    },
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
  const detail = parseDetail(row.detail_json);
  const historicalId = auditRecord(auditRecord(detail)?.actor)?.userId;
  return {
    id: row.id,
    userId: row.user_id ?? (typeof historicalId === "number" && Number.isSafeInteger(historicalId) && historicalId > 0 ? historicalId : null),
    actorName: row.actor_name,
    email: row.email,
    eventType: row.event_type,
    ipHash: row.ip_hash,
    userAgentHash: row.user_agent_hash,
    detail,
    createdAt: row.created_at,
  };
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.max(1, Math.min(500, Math.floor(value)));
}
