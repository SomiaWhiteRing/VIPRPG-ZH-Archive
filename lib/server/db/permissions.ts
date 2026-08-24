import {
  PERMISSION_LIST,
  hasPermission,
  parsePermissionKeys,
  type PermissionDefinition,
  type PermissionKey,
} from "@/lib/authz/permissions";
import {
  isCustomRolePriority,
  type RoleKind,
  type RoleStatus,
} from "@/lib/authz/roles";
import { getD1 } from "@/lib/server/db/d1";
import type { ArchiveUser } from "@/lib/server/db/users";
import { HttpError } from "@/lib/server/http/json";

export type Permission = PermissionDefinition;

export type RoleSummary = {
  id: number;
  key: string;
  name: string;
  description: string;
  priority: number;
  kind: RoleKind;
  status: RoleStatus;
  userCount: number;
  permissionKeys: PermissionKey[];
};

type RoleRow = {
  id: number;
  key: string;
  name: string;
  description: string;
  priority: number;
  kind: RoleKind;
  status: RoleStatus;
  user_count: number;
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

type RoleRequestTarget = {
  type: string;
  status: string;
  target_user_id: number | null;
  requested_role_id: number | null;
};

export type RoleRequestSummary = {
  id: number;
  status: string;
  requestedRole: { id: number; key: string; name: string } | null;
};

export function listPermissions(): readonly Permission[] {
  return PERMISSION_LIST;
}

export async function listPermissionKeysForUser(userId: number): Promise<PermissionKey[]> {
  const rows = await getD1().prepare(`
    SELECT DISTINCT rp.permission_key
    FROM role_permissions rp
    JOIN user_roles ur ON ur.role_id = rp.role_id
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ? AND r.status = 'active'
    ORDER BY rp.permission_key
  `).bind(userId).all<{ permission_key: string }>();
  return parsePermissionKeys((rows.results ?? []).map((row) => row.permission_key));
}

export async function listRolesForUser(userId: number): Promise<Array<{
  id: number;
  key: string;
  name: string;
  priority: number;
  kind: RoleKind;
}>> {
  const rows = await getD1().prepare(`
    SELECT r.id, r.key, r.name, r.priority, r.kind
    FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ? AND r.status = 'active'
    ORDER BY r.priority DESC, r.id
  `).bind(userId).all<{ id: number; key: string; name: string; priority: number; kind: RoleKind }>();
  for (const role of rows.results ?? []) {
    if (!isRoleKind(role.kind)) throw new Error(`Unknown role kind: ${String(role.kind)}`);
  }
  return rows.results ?? [];
}

export async function listRoles(): Promise<RoleSummary[]> {
  const rows = await getD1().prepare(`
    SELECT r.id, r.key, r.name, r.description, r.priority, r.kind, r.status,
      COUNT(DISTINCT ur.user_id) AS user_count
    FROM roles r LEFT JOIN user_roles ur ON ur.role_id = r.id
    GROUP BY r.id ORDER BY r.priority DESC, r.name ASC
  `).all<RoleRow>();
  const roles = rows.results ?? [];
  if (roles.length === 0) return [];
  for (const role of roles) {
    if (!isRoleKind(role.kind)) throw new Error(`Unknown role kind: ${String(role.kind)}`);
  }
  const grants = await getD1().prepare(`
    SELECT role_id, permission_key FROM role_permissions
    WHERE role_id IN (${roles.map(() => "?").join(",")})
    ORDER BY permission_key
  `).bind(...roles.map((role) => role.id)).all<{ role_id: number; permission_key: string }>();
  const byRole = new Map<number, PermissionKey[]>();
  for (const row of grants.results ?? []) {
    const [permission] = parsePermissionKeys([row.permission_key]);
    byRole.set(row.role_id, [...(byRole.get(row.role_id) ?? []), permission]);
  }
  return roles.map((row) => ({ ...row, userCount: Number(row.user_count), permissionKeys: byRole.get(row.id) ?? [] }));
}

export async function listAssignableRoles(actor: ArchiveUser): Promise<RoleSummary[]> {
  return (await listRoles()).filter((role) =>
    role.key !== "user" && role.kind !== "bootstrap_admin" &&
    role.priority < actor.maxRolePriority,
  );
}

export async function requestUploaderRole(actor: ArchiveUser): Promise<RoleRequestSummary> {
  if (actor.status !== "active") throw new HttpError(401, "账户不可用");
  if (hasPermission(actor, "import_job.create")) {
    throw new HttpError(409, "当前账户已有上传权限");
  }

  const database = getD1();
  const role = await database.prepare(
    "SELECT id, key, name FROM roles WHERE key = 'uploader' AND status = 'active'",
  ).first<{ id: number; key: string; name: string }>();
  if (!role) throw new Error("上传者角色不存在");

  await database.batch([
    database.prepare(`
    INSERT OR IGNORE INTO inbox_items (
      type, status, sender_user_id, recipient_user_id, required_permission_key,
      target_user_id, requested_role_id, requested_role_key_snapshot,
      requested_role_name_snapshot, title, body
    ) VALUES ('role_change_request', 'pending', ?, ?, 'user.role.assign', ?, ?, ?, ?, ?, ?)
    `).bind(
      actor.id,
      actor.id,
      actor.id,
      role.id,
      role.key,
      role.name,
      "上传者权限申请",
      `${actor.displayName} 申请获得上传者角色。`,
    ),
    roleRequestAuditStatement(database, actor, {
      targetUserId: actor.id,
      roleId: role.id,
      roleKey: role.key,
    }),
  ]);

  const request = await database.prepare(`
    SELECT id, status, requested_role_id, requested_role_key_snapshot,
      requested_role_name_snapshot
    FROM inbox_items
    WHERE type = 'role_change_request'
      AND status = 'pending'
      AND target_user_id = ?
      AND requested_role_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(actor.id, role.id).first<{
    id: number;
    status: string;
    requested_role_id: number | null;
    requested_role_key_snapshot: string | null;
    requested_role_name_snapshot: string | null;
  }>();

  if (!request) throw new Error("角色申请创建失败");
  return {
    id: request.id,
    status: request.status,
    requestedRole: request.requested_role_id
      ? {
          id: request.requested_role_id,
          key: request.requested_role_key_snapshot ?? role.key,
          name: request.requested_role_name_snapshot ?? role.name,
        }
      : null,
  };
}

export async function createRole(input: {
  actor: ArchiveUser;
  key: string;
  name: string;
  description?: string;
  priority: number;
}): Promise<number> {
  requireBootstrapAdmin(input.actor);
  const key = normalizeRoleKey(input.key);
  const name = normalizeRoleName(input.name);
  if (!isCustomRolePriority(input.priority)) throw new HttpError(400, "自定义角色优先级必须在 101 到 699 之间");
  const database = getD1();
  const [result] = await database.batch([
    database.prepare(`
      INSERT INTO roles (key, name, description, priority, kind)
      VALUES (?, ?, ?, ?, 'custom')
    `).bind(key, name, input.description?.trim() ?? "", input.priority),
    auditStatement(database, input.actor, "role_created", { key, priority: input.priority }),
  ]);
  const roleId = Number(result.meta.last_row_id);
  if (!Number.isSafeInteger(roleId) || roleId <= 0) throw new Error("创建角色失败");
  return roleId;
}

export async function updateRole(input: {
  actor: ArchiveUser;
  roleId: number;
  name: string;
  description?: string;
  priority: number;
  status: RoleStatus;
}): Promise<void> {
  requireBootstrapAdmin(input.actor);
  if (!isCustomRolePriority(input.priority)) throw new HttpError(400, "自定义角色优先级必须在 101 到 699 之间");
  const database = getD1();
  const role = await requiredCustomRole(input.roleId);
  await database.batch([
    database.prepare(`UPDATE roles SET name = ?, description = ?, priority = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND kind = 'custom'`)
      .bind(normalizeRoleName(input.name), input.description?.trim() ?? "", input.priority, input.status, role.id),
    auditStatement(database, input.actor, "role_updated", { roleId: role.id, priority: input.priority, status: input.status }),
  ]);
}

export async function replaceRolePermissions(input: {
  actor: ArchiveUser;
  roleId: number;
  permissionKeys: readonly unknown[];
}): Promise<void> {
  requireBootstrapAdmin(input.actor);
  let permissions: PermissionKey[];
  try {
    permissions = parsePermissionKeys(input.permissionKeys);
  } catch {
    throw new HttpError(400, "权限清单包含未知 key");
  }
  const role = await requiredCustomRole(input.roleId);
  const database = getD1();
  await database.batch([
    database.prepare("DELETE FROM role_permissions WHERE role_id = ?").bind(role.id),
    ...permissions.map((permission) => database.prepare("INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)").bind(role.id, permission)),
    auditStatement(database, input.actor, "role_permissions_updated", { roleId: role.id, permissionCount: permissions.length }),
  ]);
}

export async function assignRoleToUser(input: {
  actor: ArchiveUser;
  targetUserId: number;
  roleId: number;
  sourceInboxItemId?: number | null;
  reason?: string | null;
}): Promise<void> {
  await changeUserRole({ ...input, action: "assigned" });
}

export async function removeRoleFromUser(input: {
  actor: ArchiveUser;
  targetUserId: number;
  roleId: number;
  reason?: string | null;
}): Promise<void> {
  await changeUserRole({ ...input, action: "removed" });
}

export async function resolveRoleRequest(input: {
  actor: ArchiveUser;
  itemId: number;
  decision: "approve" | "reject";
}): Promise<void> {
  if (!hasPermission(input.actor, "inbox.role_request.resolve")) {
    throw new HttpError(403, "没有处理角色申请的权限");
  }
  const database = getD1();
  const request = await database.prepare(`
    SELECT type, status, target_user_id, requested_role_id
    FROM inbox_items WHERE id = ?
  `).bind(input.itemId).first<RoleRequestTarget>();
  if (
    !request || request.type !== "role_change_request" || request.status !== "pending" ||
    !request.target_user_id || !request.requested_role_id
  ) {
    throw new HttpError(409, "这条申请已经处理或不是有效的角色申请");
  }

  if (input.decision === "approve") {
    await changeUserRole({
      actor: input.actor,
      targetUserId: request.target_user_id,
      roleId: request.requested_role_id,
      action: "assigned",
      sourceInboxItemId: input.itemId,
      reason: "approved_role_change_request",
    });
    return;
  }

  const [target, role] = await Promise.all([
    loadUserPriorityTarget(database, request.target_user_id),
    database.prepare("SELECT id, key, name, priority, kind, status FROM roles WHERE id = ?")
      .bind(request.requested_role_id).first<RoleTarget>(),
  ]);
  assertManageableRoleChange(input.actor, request.target_user_id, target, role);
  const results = await database.batch([
    resolvedRoleRequestStatement(database, {
      itemId: input.itemId,
      actorUserId: input.actor.id,
      targetUserId: request.target_user_id,
      roleId: request.requested_role_id,
      status: "rejected",
    }),
    database.prepare(`
      INSERT INTO inbox_items (type, status, sender_user_id, recipient_user_id, target_user_id, title, body)
      SELECT 'system_notice', 'open', ?, ?, ?, ?, ?
      WHERE changes() = 1
    `).bind(
      input.actor.id,
      request.target_user_id,
      request.target_user_id,
      "角色申请未通过",
      `${input.actor.displayName} 未通过你的角色 ${role!.name} 申请。`,
    ),
    requiredPreviousMutationAuditStatement(database, input.actor, "role_request_rejected", {
      inboxItemId: input.itemId,
      targetUserId: request.target_user_id,
      roleId: request.requested_role_id,
    }),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "这条申请已经被其他操作处理");
  }
}

export function canManageUser(actor: ArchiveUser, target: ArchiveUser): boolean {
  return actor.status === "active" && actor.id !== target.id &&
    actor.maxRolePriority > target.maxRolePriority;
}

function requireBootstrapAdmin(actor: ArchiveUser): void {
  if (!actor.isBootstrapAdmin || actor.status !== "active") throw new HttpError(403, "只有当前超级管理员可修改角色策略");
}

async function changeUserRole(input: {
  actor: ArchiveUser;
  targetUserId: number;
  roleId: number;
  action: "assigned" | "removed";
  sourceInboxItemId?: number | null;
  reason?: string | null;
}): Promise<void> {
  if (!hasPermission(input.actor, "user.role.assign")) throw new HttpError(403, "没有分配用户角色的权限");
  const database = getD1();
  const sourceInboxItemId = input.sourceInboxItemId ?? null;
  const [target, role, membership, sourceRequest] = await Promise.all([
    loadUserPriorityTarget(database, input.targetUserId),
    database.prepare("SELECT id, key, name, priority, kind, status FROM roles WHERE id = ?").bind(input.roleId).first<RoleTarget>(),
    database.prepare("SELECT 1 AS present FROM user_roles WHERE user_id = ? AND role_id = ?").bind(input.targetUserId, input.roleId).first<{ present: number }>(),
    sourceInboxItemId
      ? database.prepare(`SELECT type, status, target_user_id, requested_role_id FROM inbox_items WHERE id = ?`)
        .bind(sourceInboxItemId).first<RoleRequestTarget>()
      : Promise.resolve(null),
  ]);
  assertManageableRoleChange(input.actor, input.targetUserId, target, role, input.action === "assigned");
  if (sourceInboxItemId && (
    !sourceRequest || sourceRequest.type !== "role_change_request" || sourceRequest.status !== "pending" ||
    sourceRequest.target_user_id !== input.targetUserId || sourceRequest.requested_role_id !== input.roleId
  )) {
    throw new HttpError(409, "角色申请来源无效或已经处理");
  }
  if (input.action === "assigned" && membership) throw new HttpError(409, "目标用户已有该角色");
  if (input.action === "removed" && role!.key === "user") throw new HttpError(403, "基础 user 角色不可移除");
  if (input.action === "removed" && !membership) throw new HttpError(409, "目标用户没有该角色");

  const actionLabel = input.action === "assigned" ? "分配" : "移除";
  const eventKey = crypto.randomUUID();
  const mutation = input.action === "assigned"
    ? (sourceInboxItemId
      ? database.prepare("INSERT INTO user_roles (user_id, role_id) SELECT ?, ? WHERE changes() = 1").bind(input.targetUserId, role!.id)
      : database.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(input.targetUserId, role!.id))
    : (sourceInboxItemId
      ? database.prepare("DELETE FROM user_roles WHERE user_id = ? AND role_id = ? AND changes() = 1").bind(input.targetUserId, role!.id)
      : database.prepare("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?").bind(input.targetUserId, role!.id));
  const statements = [
    ...(sourceInboxItemId ? [resolvedRoleRequestStatement(database, {
      itemId: sourceInboxItemId,
      actorUserId: input.actor.id,
      targetUserId: input.targetUserId,
      roleId: input.roleId,
      status: "approved",
    })] : []),
    mutation,
    database.prepare(`
      INSERT INTO user_role_events (
        event_key, actor_user_id, target_user_id, action, role_id, role_key_snapshot,
        role_name_snapshot, reason, source_inbox_item_id
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE changes() = 1
    `).bind(eventKey, input.actor.id, input.targetUserId, input.action, role!.id, role!.key, role!.name, input.reason ?? null, sourceInboxItemId),
    database.prepare(`
      INSERT INTO inbox_items (
        type, status, sender_user_id, recipient_user_id, target_user_id,
        role_event_id, title, body
      ) SELECT
        'role_change_notice', 'open', ?, ?, ?,
        (SELECT id FROM user_role_events WHERE event_key = ?),
        ?, ?
      WHERE changes() = 1
    `).bind(input.actor.id, input.targetUserId, input.targetUserId, eventKey, "账户角色已调整", `${input.actor.displayName} 已${actionLabel}角色 ${role!.name}。`),
    requiredPreviousMutationAuditStatement(database, input.actor, input.action === "assigned" ? "user_role_assigned" : "user_role_removed", {
      targetUserId: input.targetUserId, roleId: role!.id, roleKey: role!.key,
    }),
  ];
  const results = await database.batch(statements);
  const mutationResult = results[sourceInboxItemId ? 1 : 0];
  if (Number(mutationResult?.meta.changes ?? 0) !== 1) {
    throw new HttpError(409, "角色申请已经被其他操作处理");
  }
}

async function loadUserPriorityTarget(
  database: ReturnType<typeof getD1>,
  userId: number,
): Promise<UserPriorityTarget | null> {
  return database.prepare(`
    SELECT u.status, COALESCE(MAX(CASE WHEN r.status = 'active' THEN r.priority END), 0) AS priority
    FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
    WHERE u.id = ? GROUP BY u.id
  `).bind(userId).first<UserPriorityTarget>();
}

function assertManageableRoleChange(
  actor: ArchiveUser,
  targetUserId: number,
  target: UserPriorityTarget | null,
  role: RoleTarget | null,
  requireActiveRole = false,
): void {
  if (actor.id === targetUserId) throw new HttpError(403, "不能调整自己的角色");
  if (!target || target.status !== "active") throw new HttpError(404, "目标用户不存在或不可用");
  if (!role) throw new HttpError(404, "目标角色不存在");
  if (requireActiveRole && role.status !== "active") throw new HttpError(409, "目标角色已停用");
  if (!isRoleKind(role.kind)) throw new Error(`Unknown role kind: ${String(role.kind)}`);
  if (role.kind === "bootstrap_admin") throw new HttpError(403, "超级管理员不能通过网页授予");
  if (actor.maxRolePriority <= Number(target.priority) || actor.maxRolePriority <= role.priority) {
    throw new HttpError(403, "只能调整低于自己优先级的用户和角色");
  }
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
  return database.prepare(`
    UPDATE inbox_items
    SET status = ?,
      resolved_by_user_id = ?,
      resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND type = 'role_change_request'
      AND status = 'pending'
      AND target_user_id = ?
      AND requested_role_id = ?
  `).bind(input.status, input.actorUserId, input.itemId, input.targetUserId, input.roleId);
}

async function requiredCustomRole(roleId: number): Promise<RoleTarget> {
  const role = await getD1().prepare("SELECT id, key, name, priority, kind, status FROM roles WHERE id = ?").bind(roleId).first<RoleTarget>();
  if (!role) throw new HttpError(404, "角色不存在");
  if (role.kind !== "custom") throw new HttpError(403, "系统角色不可修改");
  return role;
}

function normalizeRoleKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key || key.length > 64) throw new HttpError(400, "角色 key 格式不正确");
  return key;
}

function normalizeRoleName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80) throw new HttpError(400, "角色名称格式不正确");
  return name;
}

function isRoleKind(value: string): value is RoleKind {
  return value === "built_in" || value === "bootstrap_admin" || value === "custom";
}

function auditStatement(
  database: ReturnType<typeof getD1>,
  actor: ArchiveUser,
  eventType: string,
  detail: Record<string, string | number | boolean | null>,
) {
  return database.prepare(`
    INSERT INTO auth_audit_logs (user_id, email, event_type, detail_json)
    VALUES (?, ?, ?, ?)
  `).bind(actor.id, actor.email, eventType, JSON.stringify(detail));
}

function requiredPreviousMutationAuditStatement(
  database: ReturnType<typeof getD1>,
  actor: ArchiveUser,
  eventType: string,
  detail: Record<string, string | number | boolean | null>,
) {
  return database.prepare(`
    INSERT INTO auth_audit_logs (user_id, email, event_type, detail_json)
    SELECT ?, ?, ?, ?
    WHERE changes() = 1
  `).bind(actor.id, actor.email, eventType, JSON.stringify(detail));
}

function roleRequestAuditStatement(
  database: ReturnType<typeof getD1>,
  actor: ArchiveUser,
  detail: Record<string, string | number | boolean | null>,
) {
  return database.prepare(`
    INSERT INTO auth_audit_logs (user_id, email, event_type, detail_json)
    SELECT ?, ?, CASE WHEN changes() = 1 THEN 'role_request_created' ELSE 'role_request_reused' END, ?
  `).bind(actor.id, actor.email, JSON.stringify(detail));
}
