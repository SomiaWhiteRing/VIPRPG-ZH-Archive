import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import type { PermissionKey } from "@/lib/authz/permissions";
import {
  hasPermission,
  parsePermissionKeys,
  PERMISSION_LIST,
} from "@/lib/authz/permissions";
import type { RoleKind, RoleStatus } from "@/lib/authz/roles";
import { hasRoleAccess, isAdministrator, isCustomRolePriority, roleSupportsApplications, ROLE_TEMPLATES } from "@/lib/authz/roles";
import type {
  Permission,
  RoleRequestSummary,
  RoleSummary,
  AccountRoleOption,
} from "@/lib/dto/db/permissions";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";

type RoleRow = {
  id: number;
  key: string;
  name: string;
  description: string;
  priority: number;
  kind: RoleKind;
  status: RoleStatus;
  application_enabled: number;
  available_to_all: number;
  user_count: number;
  permission_keys_json: string;
};

type RoleTarget = {
  id: number;
  key: string;
  name: string;
  priority: number;
  kind: RoleKind;
  status: RoleStatus;
};

type UserPriorityTarget = { status: string; priority: number };

export class RoleConflictError extends HttpError {
  constructor(public readonly currentRole: RoleSummary | null) {
    super(
      409,
      "此角色已在其他页面修改。请核对最新配置后重新编辑。",
      "role_conflict",
    );
  }
}

const ROLE_EDIT_SNAPSHOT_SQL = `json_array(r.name,r.description,r.priority,r.status,r.application_enabled,r.available_to_all,
  json((SELECT json_group_array(permission_key) FROM
    (SELECT permission_key FROM role_permissions WHERE role_id=r.id ORDER BY permission_key))))`;

const CURRENT_BOOTSTRAP_SQL = `EXISTS (SELECT 1 FROM users a JOIN user_roles ar ON ar.user_id=a.id
  JOIN roles root ON root.id=ar.role_id WHERE a.id=? AND a.status='active'
  AND root.kind='bootstrap_admin' AND root.status='active')`;

export function userManagementScopeSql(
  permission: "user.role.assign" | "user.status.update",
  target: string,
): string {
  return `EXISTS (SELECT 1 FROM users manager WHERE manager.id=? AND manager.status='active'
    AND manager.id<>${target}
    AND EXISTS (SELECT 1 FROM effective_user_roles mr JOIN roles r ON r.id=mr.role_id AND r.status='active'
      JOIN role_permissions p ON p.role_id=r.id WHERE mr.user_id=manager.id AND p.permission_key='${permission}')
    AND COALESCE((SELECT MAX(r.priority) FROM effective_user_roles mr JOIN roles r ON r.id=mr.role_id AND r.status='active'
      WHERE mr.user_id=manager.id),0) > COALESCE((SELECT MAX(r.priority) FROM effective_user_roles tr
      JOIN roles r ON r.id=tr.role_id AND r.status='active' WHERE tr.user_id=${target}),0))`;
}

export function administratorSql(userId: string): string {
  return `EXISTS (SELECT 1 FROM users administrator JOIN user_roles membership ON membership.user_id=administrator.id
    JOIN roles admin_role ON admin_role.id=membership.role_id AND admin_role.status='active'
    WHERE administrator.id=${userId} AND administrator.status='active' AND admin_role.key IN ('admin','super_admin'))`;
}

export function roleAccessSql(userId: string, roleId: string): string {
  return `(EXISTS (SELECT 1 FROM effective_user_roles granted WHERE granted.user_id=${userId} AND granted.role_id=${roleId})
    OR (EXISTS (SELECT 1 FROM role_permissions wanted WHERE wanted.role_id=${roleId})
      AND NOT EXISTS (SELECT 1 FROM role_permissions wanted WHERE wanted.role_id=${roleId}
        AND NOT EXISTS (SELECT 1 FROM effective_user_roles granted JOIN role_permissions p ON p.role_id=granted.role_id
          WHERE granted.user_id=${userId} AND p.permission_key=wanted.permission_key))))`;
}

type RoleRequestTarget = {
  type: string;
  status: string;
  target_user_id: number | null;
  requested_role_id: number | null;
};

export function listPermissions(): readonly Permission[] {
  return PERMISSION_LIST;
}

export async function listRoles(runtime: AppRuntime): Promise<RoleSummary[]> {
  const rows = await getD1(runtime)
    .prepare(
      `${ROLE_SUMMARY_SELECT} ORDER BY r.priority DESC, r.id ASC`,
    )
    .all<RoleRow>();
  return rows.results.map(mapRoleSummary);
}

const ROLE_SUMMARY_SELECT = `SELECT r.id,r.key,r.name,r.description,r.priority,r.kind,r.status,
  r.application_enabled,r.available_to_all,
  (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id=r.id) AS user_count,
  (SELECT json_group_array(permission_key) FROM
    (SELECT permission_key FROM role_permissions WHERE role_id=r.id ORDER BY permission_key)) AS permission_keys_json
  FROM roles r`;

function mapRoleSummary(row: RoleRow): RoleSummary {
  if (!isRoleKind(row.kind)) throw new Error(`Unknown role kind: ${String(row.kind)}`);
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    priority: row.priority,
    kind: row.kind,
    status: row.status,
    userCount: Number(row.user_count),
    applicationEnabled: row.application_enabled === 1,
    availableToAll: row.available_to_all === 1,
    permissionKeys: parsePermissionKeys(JSON.parse(row.permission_keys_json)),
  };
}

export async function listUserRoleMemberships(
  runtime: AppRuntime,
  userIds: number[],
): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  if (!userIds.length) return result;
  const rows = await getD1(runtime)
    .prepare(
      `SELECT user_id,role_id FROM user_roles WHERE user_id IN (${userIds.map(() => "?").join(",")})`,
    )
    .bind(...userIds)
    .all<{ user_id: number; role_id: number }>();
  for (const row of rows.results ?? [])
    result.set(row.user_id, [...(result.get(row.user_id) ?? []), row.role_id]);
  return result;
}

export async function listAccountRoleOptions(
  runtime: AppRuntime,
  actor: ArchiveUser,
): Promise<AccountRoleOption[]> {
  const database = getD1(runtime);
  const roles = await listRoles(runtime);
  const memberships = await listUserRoleMemberships(runtime, [actor.id]);
  const requests = await database.prepare(`SELECT id, status, requested_role_id AS role_id,
    requested_role_key_snapshot AS role_key, requested_role_name_snapshot AS role_name,
    json_extract(metadata_json,'$.closedReason') AS closed_reason
    FROM inbox_items i WHERE type='role_change_request' AND target_user_id=?
      AND id=(SELECT MAX(latest.id) FROM inbox_items latest WHERE latest.type='role_change_request'
        AND latest.target_user_id=i.target_user_id AND latest.requested_role_id=i.requested_role_id)`)
    .bind(actor.id).all<{
      id: number; status: RoleRequestSummary["status"]; role_id: number;
      role_key: string; role_name: string; closed_reason: string | null;
    }>();
  const byRole = new Map(requests.results.map((row) => [row.role_id, {
    id: row.id, status: row.status, closedReason: row.closed_reason,
    requestedRole: { id: row.role_id, key: row.role_key, name: row.role_name },
  }]));
  const assigned = memberships.get(actor.id) ?? [];
  return roles.filter((role) => roleSupportsApplications(role) && (
    (role.status === "active" && (role.applicationEnabled || role.availableToAll)) ||
    assigned.includes(role.id) || byRole.has(role.id)
  )).map((role) => ({
    id: role.id, key: role.key, name: role.name, description: role.description, status: role.status,
    applicationEnabled: role.applicationEnabled, availableToAll: role.availableToAll,
    individuallyAssigned: assigned.includes(role.id),
    granted: role.status === "active" && hasRoleAccess(actor, role),
    request: byRole.get(role.id) ?? null,
  }));
}

export async function requestRole(
  runtime: AppRuntime,
  actor: ArchiveUser,
  input: { roleId: number; reason?: string },
): Promise<RoleRequestSummary> {
  if (actor.status !== "active") throw new HttpError(401, "账户不可用");
  if (!Number.isSafeInteger(input.roleId) || input.roleId <= 0)
    throw new HttpError(400, "请选择要申请的权限");
  const reason = input.reason?.trim() ?? "";
  if (reason.length > 2000) throw new HttpError(400, "申请理由不能超过 2000 字");
  const database = getD1(runtime);
  const eventKey = crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO inbox_items (
      type,status,sender_user_id,recipient_user_id,required_permission_key,target_user_id,
      requested_role_id,requested_role_key_snapshot,requested_role_name_snapshot,title,body,event_key)
      SELECT 'role_change_request','pending',u.id,u.id,'user.role.assign',u.id,r.id,r.key,r.name,
        r.name || '权限申请',?,?
      FROM users u JOIN roles r ON r.id=? WHERE u.id=? AND u.status='active'
        AND r.status='active' AND (r.key='uploader' OR r.kind='custom')
        AND r.application_enabled=1 AND r.available_to_all=0 AND NOT ${roleAccessSql("u.id", "r.id")}`)
      .bind(reason, eventKey, input.roleId, actor.id),
    requiredPreviousMutationAuditStatement(database, actor, "role_request_created", {
      eventKey, targetUserId: actor.id, roleId: input.roleId,
    }),
  ]);
  // Read our record even if an administrator resolved it immediately after submission.
  const request = await database.prepare(`SELECT id,status,requested_role_id AS role_id,
      requested_role_key_snapshot AS role_key,requested_role_name_snapshot AS role_name,
      json_extract(metadata_json,'$.closedReason') AS closed_reason
    FROM inbox_items WHERE type='role_change_request' AND target_user_id=? AND requested_role_id=?
      AND (event_key=? OR status='pending') ORDER BY id DESC LIMIT 1`)
    .bind(actor.id, input.roleId, eventKey).first<{
      id: number; status: RoleRequestSummary["status"]; role_id: number;
      role_key: string; role_name: string; closed_reason: string | null;
    }>();
  if (!request) throw new HttpError(409, "当前权限已拥有或不再开放申请，请刷新后查看。");
  return {
    id: request.id, status: request.status, closedReason: request.closed_reason,
    requestedRole: { id: request.role_id, key: request.role_key, name: request.role_name },
  };
}

export async function createRole(
  runtime: AppRuntime,
  input: {
    actor: ArchiveUser;
    key: string;
    name: string;
    description?: string;
    priority: number;
    template?: keyof typeof ROLE_TEMPLATES;
  },
): Promise<number> {
  requireBootstrapAdmin(input.actor);
  const key = normalizeRoleKey(input.key);
  const name = normalizeRoleName(input.name);
  if (!isCustomRolePriority(input.priority))
    throw new HttpError(400, "自定义角色优先级必须在 101 到 699 之间");
  const database = getD1(runtime);
  const grants = input.template
    ? ROLE_TEMPLATES[input.template].permissionKeys
    : [];
  const [result] = await database.batch([
    database
      .prepare(
        `
      INSERT INTO roles (key, name, description, priority, kind)
      SELECT ?, ?, ?, ?, 'custom' WHERE ${CURRENT_BOOTSTRAP_SQL}
    `,
      )
      .bind(
        key,
        name,
        input.description?.trim() ?? "",
        input.priority,
        input.actor.id,
      ),
    requiredPreviousMutationAuditStatement(
      database,
      input.actor,
      "role_created",
      { key, priority: input.priority },
    ),
    ...grants.map((permission) =>
      database
        .prepare(
          `
      INSERT INTO role_permissions (role_id, permission_key)
      SELECT id, ? FROM roles WHERE key=? AND changes()=1
    `,
        )
        .bind(permission, key),
    ),
  ]);
  if (Number(result.meta.changes) !== 1)
    throw new HttpError(403, "当前账户已无权创建角色");
  const roleId = Number(result.meta.last_row_id);
  if (!Number.isSafeInteger(roleId) || roleId <= 0)
    throw new Error("创建角色失败");
  return roleId;
}

export async function updateRole(
  runtime: AppRuntime,
  input: {
    actor: ArchiveUser;
    roleId: number;
    name: string;
    description?: string;
    priority: number;
    status: RoleStatus;
    applicationEnabled: boolean;
    availableToAll: boolean;
    expected: string;
  },
): Promise<RoleSummary> {
  requireBootstrapAdmin(input.actor);
  const database = getD1(runtime);
  const role = (await listRoles(runtime)).find((item) => item.id === input.roleId);
  if (!role) throw new HttpError(404, "角色不存在");
  if (role.kind === "custom" && !isCustomRolePriority(input.priority))
    throw new HttpError(400, "自定义角色优先级必须在 101 到 699 之间");
  if (role.kind !== "custom" && (input.name !== role.name || input.priority !== role.priority || input.status !== role.status))
    throw new HttpError(403, "系统角色的名称、优先级和状态不可修改");
  if (!roleSupportsApplications(role) && (input.applicationEnabled || input.availableToAll))
    throw new HttpError(400, "此角色不能开放申请或向所有用户开放");
  const eventKey = crypto.randomUUID();
  const closedReason = input.status === "disabled" ? "该角色已停用，申请已关闭。"
    : input.availableToAll ? "此权限已向所有用户开放，无需申请。"
    : !input.applicationEnabled ? "该角色已关闭开放申请，本次申请已关闭。" : null;
  const results = await database.batch([
    database
      .prepare(
        `UPDATE roles AS r SET name = ?, description = ?, priority = ?, status = ?,
          application_enabled = ?, available_to_all = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND ${ROLE_EDIT_SNAPSHOT_SQL}=? AND ${CURRENT_BOOTSTRAP_SQL}`,
      )
      .bind(
        normalizeRoleName(input.name),
        input.description?.trim() ?? "",
        input.priority,
        input.status,
        Number(input.applicationEnabled),
        Number(input.availableToAll),
        role.id,
        input.expected,
        input.actor.id,
      ),
    requiredPreviousMutationAuditStatement(
      database,
      input.actor,
      "role_updated",
      {
        eventKey,
        roleId: role.id,
        before: input.expected,
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        priority: input.priority,
        status: input.status,
        applicationEnabled: input.applicationEnabled,
        availableToAll: input.availableToAll,
      },
    ),
    ...(closedReason ? [
      database.prepare(`UPDATE inbox_items SET status='archived',resolved_by_user_id=?,resolved_at=CURRENT_TIMESTAMP,
          metadata_json=json_set(COALESCE(metadata_json,'{}'),'$.closedReason',?,'$.closureEventKey',?)
        WHERE type='role_change_request' AND status='pending' AND requested_role_id=?
          AND EXISTS (SELECT 1 FROM auth_audit_logs WHERE user_id=? AND event_type='role_updated'
            AND json_extract(detail_json,'$.eventKey')=?)`)
        .bind(input.actor.id, closedReason, eventKey, role.id, input.actor.id, eventKey),
      database.prepare(`INSERT INTO inbox_items(type,status,sender_user_id,recipient_user_id,target_user_id,title,body,event_key)
        SELECT 'system_notice','open',?,i.target_user_id,i.target_user_id,'权限申请已关闭',
          i.requested_role_name_snapshot || '：' || json_extract(i.metadata_json,'$.closedReason'),
          'role-request-closed:' || ? || ':' || i.id
        FROM inbox_items i WHERE i.type='role_change_request' AND i.status='archived'
          AND json_extract(i.metadata_json,'$.closureEventKey')=?`)
        .bind(input.actor.id, eventKey, eventKey),
    ] : []),
    database.prepare(`${ROLE_SUMMARY_SELECT} WHERE r.id=?`).bind(role.id),
  ]);
  if (Number(results[0].meta.changes) !== 1)
    throw new RoleConflictError(
      (await listRoles(runtime)).find((item) => item.id === role.id) ?? null,
    );
  return mapRoleSummary(results.at(-1)!.results[0] as RoleRow);
}

export async function replaceRolePermissions(
  runtime: AppRuntime,
  input: {
    actor: ArchiveUser;
    roleId: number;
    permissionKeys: readonly unknown[];
    expected: string;
  },
): Promise<RoleSummary> {
  requireBootstrapAdmin(input.actor);
  let permissions: PermissionKey[];
  try {
    permissions = parsePermissionKeys(input.permissionKeys);
  } catch {
    throw new HttpError(400, "权限清单包含未知 key");
  }
  const role = await requiredCustomRole(runtime, input.roleId);
  const database = getD1(runtime);
  const eventKey = crypto.randomUUID();
  const authorized = `EXISTS (SELECT 1 FROM auth_audit_logs WHERE user_id=? AND event_type='role_permissions_updated' AND json_extract(detail_json,'$.eventKey')=?)`;
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
      SELECT ?,?,'role_permissions_updated',json_object('eventKey',?,'roleId',r.id,
        'before',json((SELECT json_group_array(permission_key) FROM (SELECT permission_key FROM role_permissions WHERE role_id=r.id ORDER BY permission_key))),
        'after',json(?))
      FROM roles r WHERE r.id=? AND r.kind='custom' AND ${ROLE_EDIT_SNAPSHOT_SQL}=? AND ${CURRENT_BOOTSTRAP_SQL}`,
      )
      .bind(
        input.actor.id,
        input.actor.email,
        eventKey,
        JSON.stringify([...permissions].sort()),
        role.id,
        input.expected,
        input.actor.id,
      ),
    database
      .prepare(
        `DELETE FROM role_permissions WHERE role_id = ? AND ${authorized}`,
      )
      .bind(role.id, input.actor.id, eventKey),
    ...permissions.map((permission) =>
      database
        .prepare(
          `INSERT INTO role_permissions (role_id, permission_key) SELECT ?, ? WHERE ${authorized}`,
        )
        .bind(role.id, permission, input.actor.id, eventKey),
    ),
    database.prepare(`${ROLE_SUMMARY_SELECT} WHERE r.id=?`).bind(role.id),
  ]);
  if (Number(results[0].meta.changes) !== 1)
    throw new RoleConflictError(
      (await listRoles(runtime)).find((item) => item.id === role.id) ?? null,
    );
  return mapRoleSummary(results.at(-1)!.results[0] as RoleRow);
}

export async function assignRoleToUser(
  runtime: AppRuntime,
  input: {
    actor: ArchiveUser;
    targetUserId: number;
    roleId: number;
    sourceInboxItemId?: number | null;
    reason?: string | null;
  },
): Promise<void> {
  await changeUserRole(runtime, { ...input, action: "assigned" });
}

export async function removeRoleFromUser(
  runtime: AppRuntime,
  input: {
    actor: ArchiveUser;
    targetUserId: number;
    roleId: number;
    reason?: string | null;
  },
): Promise<void> {
  await changeUserRole(runtime, { ...input, action: "removed" });
}

export async function resolveRoleRequest(
  runtime: AppRuntime,
  input: {
    actor: ArchiveUser;
    itemId: number;
    decision: "approve" | "reject";
  },
): Promise<void> {
  if (
    !isAdministrator(input.actor) ||
    !hasPermission(input.actor, "inbox.role_request.resolve") ||
    !hasPermission(input.actor, "user.role.assign")
  ) {
    throw new HttpError(403, "没有处理角色申请的权限");
  }
  const database = getD1(runtime);
  const request = await database
    .prepare(
      `
    SELECT type, status, target_user_id, requested_role_id
    FROM inbox_items WHERE id = ?
  `,
    )
    .bind(input.itemId)
    .first<RoleRequestTarget>();
  if (
    !request ||
    request.type !== "role_change_request" ||
    request.status !== "pending" ||
    !request.target_user_id ||
    !request.requested_role_id
  ) {
    throw new HttpError(409, "这条申请已经处理或不是有效的角色申请");
  }

  if (input.decision === "approve") {
    await changeUserRole(runtime, {
      actor: input.actor,
      targetUserId: request.target_user_id,
      roleId: request.requested_role_id,
      action: "assigned",
      sourceInboxItemId: input.itemId,
      reason: "approved_role_change_request",
    });
    return;
  }

  const [targetResult, roleResult] = await database.batch([
    userPriorityTargetStatement(database, request.target_user_id),
    database
      .prepare("SELECT id,key,name,priority,kind,status FROM roles WHERE id=?")
      .bind(request.requested_role_id),
  ]);
  const target = targetResult.results?.[0] as UserPriorityTarget | undefined;
  const role = roleResult.results?.[0] as RoleTarget | undefined;
  assertManageableRoleChange(
    input.actor,
    request.target_user_id,
    target ?? null,
    role ?? null,
  );
  const results = await database.batch([
    roleChangeAuditStatement(
      database,
      input.actor,
      request.target_user_id,
      role!,
      "role_request_rejected",
      {
        inboxItemId: input.itemId,
        targetUserId: request.target_user_id,
        roleId: request.requested_role_id,
      },
      false,
      input.itemId,
    ),
    resolvedRoleRequestStatement(database, {
      itemId: input.itemId,
      actorUserId: input.actor.id,
      targetUserId: request.target_user_id,
      roleId: request.requested_role_id,
      status: "rejected",
    }),
    database
      .prepare(
        `
      INSERT INTO inbox_items (type, status, sender_user_id, recipient_user_id, target_user_id, title, body)
      SELECT 'system_notice', 'open', ?, ?, ?, ?, ?
      WHERE changes() = 1
    `,
      )
      .bind(
        input.actor.id,
        request.target_user_id,
        request.target_user_id,
        "角色申请未通过",
        `${input.actor.displayName} 未通过你的角色 ${role!.name} 申请。`,
      ),
    resolvedInboxReadStatement(database, input.itemId, input.actor.id),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "这条申请已经被其他操作处理");
  }
}

export function canManageUser(
  actor: ArchiveUser,
  target: ArchiveUser,
): boolean {
  return (
    actor.status === "active" &&
    actor.id !== target.id &&
    actor.maxRolePriority > target.maxRolePriority
  );
}

function requireBootstrapAdmin(actor: ArchiveUser): void {
  if (!actor.isBootstrapAdmin || actor.status !== "active")
    throw new HttpError(403, "只有当前超级管理员可修改角色策略");
}

async function changeUserRole(
  runtime: AppRuntime,
  input: {
    actor: ArchiveUser;
    targetUserId: number;
    roleId: number;
    action: "assigned" | "removed";
    sourceInboxItemId?: number | null;
    reason?: string | null;
  },
): Promise<void> {
  if (!hasPermission(input.actor, "user.role.assign"))
    throw new HttpError(403, "没有分配用户角色的权限");
  const database = getD1(runtime);
  const sourceInboxItemId = input.sourceInboxItemId ?? null;
  const validationStatements = [
    userPriorityTargetStatement(database, input.targetUserId),
    database
      .prepare("SELECT id,key,name,priority,kind,status FROM roles WHERE id=?")
      .bind(input.roleId),
    database
      .prepare(
        "SELECT 1 AS present FROM user_roles WHERE user_id=? AND role_id=?",
      )
      .bind(input.targetUserId, input.roleId),
    ...(sourceInboxItemId
      ? [
          database
            .prepare(
              `SELECT type,status,target_user_id,requested_role_id FROM inbox_items WHERE id=?`,
            )
            .bind(sourceInboxItemId),
        ]
      : []),
  ];
  const validation = await database.batch(validationStatements);
  const target = validation[0].results?.[0] as UserPriorityTarget | undefined;
  const role = validation[1].results?.[0] as RoleTarget | undefined;
  const membership = validation[2].results?.[0] as
    | { present: number }
    | undefined;
  const sourceRequest = sourceInboxItemId
    ? (validation[3].results?.[0] as RoleRequestTarget | undefined)
    : null;
  assertManageableRoleChange(
    input.actor,
    input.targetUserId,
    target ?? null,
    role ?? null,
    input.action === "assigned",
  );
  if (
    sourceInboxItemId &&
    (!sourceRequest ||
      sourceRequest.type !== "role_change_request" ||
      sourceRequest.status !== "pending" ||
      sourceRequest.target_user_id !== input.targetUserId ||
      sourceRequest.requested_role_id !== input.roleId)
  ) {
    throw new HttpError(409, "角色申请来源无效或已经处理");
  }
  if (input.action === "assigned" && membership)
    throw new HttpError(409, "目标用户已有该角色");
  if (input.action === "removed" && role!.key === "user")
    throw new HttpError(403, "基础 user 角色不可移除");
  if (input.action === "removed" && !membership)
    throw new HttpError(409, "目标用户没有该角色");

  const actionLabel = input.action === "assigned" ? "分配" : "移除";
  const eventKey = crypto.randomUUID();
  const mutation =
    input.action === "assigned"
      ? database
          .prepare(
            "INSERT INTO user_roles (user_id, role_id) SELECT ?, ? WHERE changes() = 1",
          )
          .bind(input.targetUserId, role!.id)
      : database
          .prepare(
            "DELETE FROM user_roles WHERE user_id = ? AND role_id = ? AND changes() = 1",
          )
          .bind(input.targetUserId, role!.id);
  const statements = [
    roleChangeAuditStatement(
      database,
      input.actor,
      input.targetUserId,
      role!,
      input.action === "assigned" ? "user_role_assigned" : "user_role_removed",
      {
        targetUserId: input.targetUserId,
        roleId: role!.id,
        roleKey: role!.key,
      },
      input.action === "assigned",
      sourceInboxItemId,
      input.action,
    ),
    ...(sourceInboxItemId
      ? [
          resolvedRoleRequestStatement(database, {
            itemId: sourceInboxItemId,
            actorUserId: input.actor.id,
            targetUserId: input.targetUserId,
            roleId: input.roleId,
            status: "approved",
          }),
        ]
      : []),
    mutation,
    database
      .prepare(
        `
      INSERT INTO user_role_events (
        event_key, actor_user_id, target_user_id, action, role_id, role_key_snapshot,
        role_name_snapshot, reason, source_inbox_item_id
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE changes() = 1
    `,
      )
      .bind(
        eventKey,
        input.actor.id,
        input.targetUserId,
        input.action,
        role!.id,
        role!.key,
        role!.name,
        input.reason ?? null,
        sourceInboxItemId,
      ),
    database
      .prepare(
        `
      INSERT INTO inbox_items (
        type, status, sender_user_id, recipient_user_id, target_user_id,
        role_event_id, title, body
      ) SELECT
        'role_change_notice', 'open', ?, ?, ?,
        (SELECT id FROM user_role_events WHERE event_key = ?),
        ?, ?
      WHERE changes() = 1
    `,
      )
      .bind(
        input.actor.id,
        input.targetUserId,
        input.targetUserId,
        eventKey,
        "账户角色已调整",
        `${input.actor.displayName} 已${actionLabel}角色 ${role!.name}。`,
      ),
    ...(sourceInboxItemId
      ? [
          resolvedInboxReadStatement(
            database,
            sourceInboxItemId,
            input.actor.id,
          ),
        ]
      : []),
  ];
  const results = await database.batch(statements);
  const mutationResult = results[sourceInboxItemId ? 2 : 1];
  if (Number(mutationResult?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "账户、角色或申请状态已变化，请刷新后重试。");
  }
}

function resolvedInboxReadStatement(
  database: ReturnType<typeof getD1>,
  itemId: number,
  userId: number,
) {
  return database
    .prepare(
      `INSERT INTO inbox_item_reads(item_id,user_id,read_at)
    SELECT id,?,CURRENT_TIMESTAMP FROM inbox_items WHERE id=? AND resolved_by_user_id=? AND changes()=1
    ON CONFLICT(item_id,user_id) DO NOTHING`,
    )
    .bind(userId, itemId, userId);
}

function userPriorityTargetStatement(
  database: ReturnType<typeof getD1>,
  userId: number,
): D1PreparedStatement {
  return database
    .prepare(
      `
    SELECT u.status, COALESCE(MAX(CASE WHEN r.status = 'active' THEN r.priority END), 0) AS priority
    FROM users u LEFT JOIN effective_user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
    WHERE u.id = ? GROUP BY u.id
  `,
    )
    .bind(userId);
}

function assertManageableRoleChange(
  actor: ArchiveUser,
  targetUserId: number,
  target: UserPriorityTarget | null,
  role: RoleTarget | null,
  requireActiveRole = false,
): void {
  if (actor.id === targetUserId) throw new HttpError(403, "不能调整自己的角色");
  if (!target || target.status !== "active")
    throw new HttpError(404, "目标用户不存在或不可用");
  if (!role) throw new HttpError(404, "目标角色不存在");
  if (requireActiveRole && role.status !== "active")
    throw new HttpError(409, "目标角色已停用");
  if (!isRoleKind(role.kind))
    throw new Error(`Unknown role kind: ${String(role.kind)}`);
  if (role.kind === "bootstrap_admin")
    throw new HttpError(403, "超级管理员不能通过网页授予");
  if (role.key === "admin" && !actor.isBootstrapAdmin)
    throw new HttpError(403, "只有超级管理员可以授予或收回管理员角色");
  if (
    actor.maxRolePriority <= Number(target.priority) ||
    actor.maxRolePriority <= role.priority
  ) {
    throw new HttpError(403, "只能调整低于自己优先级的用户和角色");
  }
}

function roleChangeAuditStatement(
  database: ReturnType<typeof getD1>,
  actor: ArchiveUser,
  targetUserId: number,
  role: RoleTarget,
  eventType: string,
  detail: Record<string, string | number | boolean | null>,
  requireActiveRole: boolean,
  inboxItemId: number | null = null,
  action?: "assigned" | "removed",
) {
  return database
    .prepare(
      `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
    SELECT ?,?,?,? FROM users target JOIN roles role ON role.id=?
    WHERE target.id=? AND target.status='active' AND role.kind<>'bootstrap_admin'
      AND (role.key<>'admin' OR ${CURRENT_BOOTSTRAP_SQL})
      AND role.name=? AND role.priority=? AND (?=0 OR role.status='active')
      AND ${userManagementScopeSql("user.role.assign", "target.id")}
      AND role.priority < (SELECT MAX(r.priority) FROM effective_user_roles ar JOIN roles r ON r.id=ar.role_id
        WHERE ar.user_id=? AND r.status='active')
      ${action ? `AND ${action === "assigned" ? "NOT " : ""}EXISTS (SELECT 1 FROM user_roles WHERE user_id=target.id AND role_id=role.id)` : ""}
      ${action === "removed" ? "AND role.key<>'user'" : ""}
      ${
        inboxItemId
          ? `AND EXISTS (SELECT 1 FROM inbox_items WHERE id=? AND type='role_change_request' AND status='pending'
        AND target_user_id=target.id AND requested_role_id=role.id)
        AND role.status='active' AND role.application_enabled=1 AND role.available_to_all=0
        AND (role.key='uploader' OR role.kind='custom')
        AND ${administratorSql("?")}
        ${action === "assigned" ? `AND NOT ${roleAccessSql("target.id", "role.id")}` : ""}
        AND EXISTS (SELECT 1 FROM effective_user_roles ar JOIN roles r ON r.id=ar.role_id AND r.status='active'
          JOIN role_permissions p ON p.role_id=r.id WHERE ar.user_id=? AND p.permission_key='inbox.role_request.resolve')`
          : ""
      }`,
    )
    .bind(
      actor.id,
      actor.email,
      eventType,
      JSON.stringify(detail),
      role.id,
      targetUserId,
      actor.id,
      role.name,
      role.priority,
      requireActiveRole ? 1 : 0,
      actor.id,
      actor.id,
      ...(inboxItemId ? [inboxItemId, actor.id, actor.id] : []),
    );
}

function resolvedRoleRequestStatement(
  database: ReturnType<typeof getD1>,
  input: {
    itemId: number;
    actorUserId: number;
    targetUserId: number;
    roleId: number;
    status: "approved" | "rejected";
  },
) {
  return database
    .prepare(
      `
    UPDATE inbox_items
    SET status = ?,
      resolved_by_user_id = ?,
      resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND changes() = 1
      AND type = 'role_change_request'
      AND status = 'pending'
      AND target_user_id = ?
      AND requested_role_id = ?
  `,
    )
    .bind(
      input.status,
      input.actorUserId,
      input.itemId,
      input.targetUserId,
      input.roleId,
    );
}

async function requiredCustomRole(
  runtime: AppRuntime,
  roleId: number,
): Promise<RoleTarget> {
  const role = await getD1(runtime)
    .prepare(
      "SELECT id, key, name, priority, kind, status FROM roles WHERE id = ?",
    )
    .bind(roleId)
    .first<RoleTarget>();
  if (!role) throw new HttpError(404, "角色不存在");
  if (role.kind !== "custom") throw new HttpError(403, "系统角色不可修改");
  return role;
}

function normalizeRoleKey(value: string): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key || key.length > 64) throw new HttpError(400, "角色 key 格式不正确");
  return key;
}

function normalizeRoleName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80) throw new HttpError(400, "角色名称格式不正确");
  return name;
}

function isRoleKind(value: string): value is RoleKind {
  return (
    value === "built_in" || value === "bootstrap_admin" || value === "custom"
  );
}

function requiredPreviousMutationAuditStatement(
  database: ReturnType<typeof getD1>,
  actor: ArchiveUser,
  eventType: string,
  detail: Record<string, string | number | boolean | null>,
) {
  return database
    .prepare(
      `
    INSERT INTO auth_audit_logs (user_id, email, event_type, detail_json)
    SELECT ?, ?, ?, ?
    WHERE changes() = 1
  `,
    )
    .bind(actor.id, actor.email, eventType, JSON.stringify(detail));
}
