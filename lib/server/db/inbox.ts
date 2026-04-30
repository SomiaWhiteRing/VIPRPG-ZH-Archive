import {
  USER_ROLES,
  canAssignRole,
  canManageRole,
  legacyRoleFor,
  legacyUploadStatusFor,
  roleLabel,
  roleWeight,
  type UserRole,
} from "@/lib/server/auth/roles";
import { getD1 } from "@/lib/server/db/d1";
import { type ArchiveUser, findUserById } from "@/lib/server/db/users";

export type InboxItemType =
  | "role_change_request"
  | "role_change_notice"
  | "system_notice";

export type InboxItemStatus =
  | "open"
  | "pending"
  | "approved"
  | "rejected"
  | "archived";

export type InboxItem = {
  id: number;
  type: InboxItemType;
  status: InboxItemStatus;
  senderUserId: number | null;
  senderDisplayName: string | null;
  recipientUserId: number | null;
  audienceMinRole: UserRole | null;
  targetUserId: number | null;
  targetDisplayName: string | null;
  requestedRole: UserRole | null;
  oldRole: UserRole | null;
  newRole: UserRole | null;
  resolvedByUserId: number | null;
  resolvedByDisplayName: string | null;
  resolvedAt: string | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

type InboxItemRow = {
  id: number;
  type: InboxItemType;
  status: InboxItemStatus;
  sender_user_id: number | null;
  sender_display_name: string | null;
  recipient_user_id: number | null;
  audience_min_role_key: UserRole | null;
  target_user_id: number | null;
  target_display_name: string | null;
  requested_role_key: UserRole | null;
  old_role_key: UserRole | null;
  new_role_key: UserRole | null;
  resolved_by_user_id: number | null;
  resolved_by_display_name: string | null;
  resolved_at: string | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

const INBOX_SELECT = `SELECT
  i.id,
  i.type,
  i.status,
  i.sender_user_id,
  sender.display_name AS sender_display_name,
  i.recipient_user_id,
  i.audience_min_role_key,
  i.target_user_id,
  target.display_name AS target_display_name,
  i.requested_role_key,
  i.old_role_key,
  i.new_role_key,
  i.resolved_by_user_id,
  resolver.display_name AS resolved_by_display_name,
  i.resolved_at,
  i.title,
  i.body,
  i.created_at,
  reads.read_at
FROM inbox_items i
LEFT JOIN users sender ON sender.id = i.sender_user_id
LEFT JOIN users target ON target.id = i.target_user_id
LEFT JOIN users resolver ON resolver.id = i.resolved_by_user_id
LEFT JOIN inbox_item_reads reads ON reads.item_id = i.id AND reads.user_id = ?`;

type CountRow = {
  count: number;
};

type IdRow = {
  id: number;
};

export async function listInboxItemsForUser(user: ArchiveUser): Promise<InboxItem[]> {
  const visibleAudienceRoles = getVisibleAudienceRoles(user);
  const audiencePlaceholders = visibleAudienceRoles.map(() => "?").join(", ");
  const rows = await getD1()
    .prepare(
      `${INBOX_SELECT}
      WHERE i.recipient_user_id = ?
        OR i.audience_min_role_key IN (${audiencePlaceholders})
      ORDER BY
        CASE i.status WHEN 'pending' THEN 0 ELSE 1 END,
        i.created_at DESC
      LIMIT 200`,
    )
    .bind(user.id, user.id, ...visibleAudienceRoles)
    .all<InboxItemRow>();

  return (rows.results ?? [])
    .map(mapInboxItemRow)
    .filter((item) => canViewInboxItem(user, item));
}

export async function countUnreadInboxItemsForUser(
  user: ArchiveUser,
): Promise<number> {
  const visibleAudienceRoles = getVisibleAudienceRoles(user);
  const audiencePlaceholders = visibleAudienceRoles.map(() => "?").join(", ");
  const row = await getD1()
    .prepare(
      `SELECT COUNT(*) AS count
      FROM inbox_items i
      LEFT JOIN inbox_item_reads reads
        ON reads.item_id = i.id AND reads.user_id = ?
      WHERE (i.recipient_user_id = ?
          OR i.audience_min_role_key IN (${audiencePlaceholders}))
        AND reads.read_at IS NULL`,
    )
    .bind(user.id, user.id, ...visibleAudienceRoles)
    .first<CountRow>();

  return row?.count ?? 0;
}

export async function createUploadRoleRequest(user: ArchiveUser): Promise<InboxItem> {
  if (roleWeight(user.role) >= roleWeight("uploader")) {
    return createDirectNotice({
      recipientUserId: user.id,
      title: "你已经具备上传权限",
      body: `当前层级为 ${roleLabel(user.role)}，无需再次申请上传者权限。`,
    });
  }

  const existing = await findPendingRoleRequest(user.id, "uploader");

  if (existing) {
    return existing;
  }

  const result = await getD1()
    .prepare(
      `INSERT INTO inbox_items (
        type,
        status,
        sender_user_id,
        recipient_user_id,
        audience_min_role_key,
        target_user_id,
        requested_role_key,
        title,
        body
      ) VALUES ('role_change_request', 'pending', ?, ?, 'admin', ?, 'uploader', ?, ?)`,
    )
    .bind(
      user.id,
      user.id,
      user.id,
      "上传者权限申请",
      `${user.displayName} 申请将账户层级调整为上传者。`,
    )
    .run();

  return requiredInboxItem(Number(result.meta.last_row_id), user);
}

export async function changeUserRole(input: {
  actor: ArchiveUser;
  targetUserId: number;
  newRole: UserRole;
  sourceInboxItemId?: number | null;
  reason?: string | null;
}): Promise<ArchiveUser> {
  const target = await findUserById(input.targetUserId);

  if (!target || target.status !== "active") {
    throw new Error("目标用户不存在或不可用");
  }

  if (input.actor.id === target.id) {
    throw new Error("不能调整自己的层级");
  }

  if (!canManageRole(input.actor.role, target.role)) {
    throw new Error("只能调整低于自己层级的用户");
  }

  if (!canAssignRole(input.actor.role, input.newRole)) {
    throw new Error("只能分配低于自己层级的角色");
  }

  if (target.role === input.newRole) {
    throw new Error("目标用户已经是该层级");
  }

  await getD1()
    .prepare(
      `UPDATE users
      SET role_key = ?,
        role = ?,
        upload_status = ?,
        approved_at = CASE WHEN ? = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END,
        approved_by_user_id = ?
      WHERE id = ?`,
    )
    .bind(
      input.newRole,
      legacyRoleFor(input.newRole),
      legacyUploadStatusFor(input.newRole),
      legacyUploadStatusFor(input.newRole),
      input.actor.id,
      target.id,
    )
    .run();

  const event = await getD1()
    .prepare(
      `INSERT INTO user_role_events (
        actor_user_id,
        target_user_id,
        old_role_key,
        new_role_key,
        reason,
        source_inbox_item_id
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.actor.id,
      target.id,
      target.role,
      input.newRole,
      input.reason ?? null,
      input.sourceInboxItemId ?? null,
    )
    .run();

  await createRoleChangeNotice({
    actor: input.actor,
    target,
    oldRole: target.role,
    newRole: input.newRole,
    eventId: Number(event.meta.last_row_id),
  });

  const updated = await findUserById(target.id);

  if (!updated) {
    throw new Error("目标用户更新后不可读取");
  }

  return updated;
}

export async function resolveRoleChangeRequest(input: {
  actor: ArchiveUser;
  itemId: number;
  decision: "approve" | "reject";
}): Promise<void> {
  const item = await requiredInboxItem(input.itemId, input.actor);

  if (item.type !== "role_change_request" || item.status !== "pending") {
    throw new Error("这条申请已经处理或不是角色申请");
  }

  if (!item.targetUserId || !item.requestedRole) {
    throw new Error("申请内容不完整");
  }

  if (input.decision === "approve") {
    await changeUserRole({
      actor: input.actor,
      targetUserId: item.targetUserId,
      newRole: item.requestedRole,
      sourceInboxItemId: item.id,
      reason: "approved_role_change_request",
    });

    await markInboxItemResolved(item.id, input.actor.id, "approved");
    return;
  }

  await markInboxItemResolved(item.id, input.actor.id, "rejected");
  await createDirectNotice({
    recipientUserId: item.targetUserId,
    title: "上传者权限申请未通过",
    body: `${input.actor.displayName} 未通过你的上传者权限申请。`,
  });
}

export async function markInboxItemRead(input: {
  user: ArchiveUser;
  itemId: number;
}): Promise<void> {
  const item = await requiredInboxItem(input.itemId, input.user);

  if (!canViewInboxItem(input.user, item)) {
    throw new Error("没有权限读取这条站内信");
  }

  await getD1()
    .prepare(
      `INSERT INTO inbox_item_reads (item_id, user_id, read_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(item_id, user_id) DO UPDATE SET read_at = CURRENT_TIMESTAMP`,
    )
    .bind(item.id, input.user.id)
    .run();
}

export async function markAllInboxItemsRead(user: ArchiveUser): Promise<number> {
  const visibleAudienceRoles = getVisibleAudienceRoles(user);
  const audiencePlaceholders = visibleAudienceRoles.map(() => "?").join(", ");
  const rows = await getD1()
    .prepare(
      `SELECT i.id
      FROM inbox_items i
      LEFT JOIN inbox_item_reads reads
        ON reads.item_id = i.id AND reads.user_id = ?
      WHERE (i.recipient_user_id = ?
          OR i.audience_min_role_key IN (${audiencePlaceholders}))
        AND reads.read_at IS NULL
      LIMIT 500`,
    )
    .bind(user.id, user.id, ...visibleAudienceRoles)
    .all<IdRow>();
  const ids = (rows.results ?? []).map((row) => row.id);

  if (ids.length === 0) {
    return 0;
  }

  await getD1().batch(
    ids.map((id) =>
      getD1()
        .prepare(
          `INSERT INTO inbox_item_reads (item_id, user_id, read_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(item_id, user_id) DO UPDATE
          SET read_at = CURRENT_TIMESTAMP`,
        )
        .bind(id, user.id),
    ),
  );

  return ids.length;
}

async function findPendingRoleRequest(
  targetUserId: number,
  requestedRole: UserRole,
): Promise<InboxItem | null> {
  const row = await getD1()
    .prepare(
      `${INBOX_SELECT}
      WHERE i.type = 'role_change_request'
        AND i.status = 'pending'
        AND i.target_user_id = ?
        AND i.requested_role_key = ?
      ORDER BY i.created_at DESC
      LIMIT 1`,
    )
    .bind(targetUserId, targetUserId, requestedRole)
    .first<InboxItemRow>();

  return row ? mapInboxItemRow(row) : null;
}

async function requiredInboxItem(
  itemId: number,
  viewer: ArchiveUser,
): Promise<InboxItem> {
  const row = await getD1()
    .prepare(`${INBOX_SELECT} WHERE i.id = ? LIMIT 1`)
    .bind(viewer.id, itemId)
    .first<InboxItemRow>();

  if (!row) {
    throw new Error("站内信不存在");
  }

  const item = mapInboxItemRow(row);

  if (!canViewInboxItem(viewer, item)) {
    throw new Error("没有权限读取这条站内信");
  }

  return item;
}

async function createRoleChangeNotice(input: {
  actor: ArchiveUser;
  target: ArchiveUser;
  oldRole: UserRole;
  newRole: UserRole;
  eventId: number;
}): Promise<void> {
  await getD1()
    .prepare(
      `INSERT INTO inbox_items (
        type,
        status,
        sender_user_id,
        recipient_user_id,
        target_user_id,
        old_role_key,
        new_role_key,
        title,
        body,
        metadata_json
      ) VALUES ('role_change_notice', 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.actor.id,
      input.target.id,
      input.target.id,
      input.oldRole,
      input.newRole,
      "账户层级已调整",
      `${input.actor.displayName} 已将你的账户层级从 ${roleLabel(
        input.oldRole,
      )} 调整为 ${roleLabel(input.newRole)}。`,
      JSON.stringify({ roleEventId: input.eventId }),
    )
    .run();
}

async function createDirectNotice(input: {
  recipientUserId: number;
  title: string;
  body: string;
}): Promise<InboxItem> {
  const result = await getD1()
    .prepare(
      `INSERT INTO inbox_items (
        type,
        status,
        recipient_user_id,
        title,
        body
      ) VALUES ('system_notice', 'open', ?, ?, ?)`,
    )
    .bind(input.recipientUserId, input.title, input.body)
    .run();

  const recipient = await findUserById(input.recipientUserId);

  if (!recipient) {
    throw new Error("通知接收人不存在");
  }

  return requiredInboxItem(Number(result.meta.last_row_id), recipient);
}

async function markInboxItemResolved(
  itemId: number,
  actorUserId: number,
  status: "approved" | "rejected",
): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE inbox_items
      SET status = ?,
        resolved_by_user_id = ?,
        resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(status, actorUserId, itemId)
    .run();
}

function canViewInboxItem(user: ArchiveUser, item: InboxItem): boolean {
  if (item.recipientUserId === user.id) {
    return true;
  }

  return Boolean(
    item.audienceMinRole && roleWeight(user.role) >= roleWeight(item.audienceMinRole),
  );
}

function getVisibleAudienceRoles(user: ArchiveUser): UserRole[] {
  return USER_ROLES.filter((role) => roleWeight(user.role) >= roleWeight(role));
}

function mapInboxItemRow(row: InboxItemRow): InboxItem {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    senderUserId: row.sender_user_id,
    senderDisplayName: row.sender_display_name,
    recipientUserId: row.recipient_user_id,
    audienceMinRole: row.audience_min_role_key,
    targetUserId: row.target_user_id,
    targetDisplayName: row.target_display_name,
    requestedRole: row.requested_role_key,
    oldRole: row.old_role_key,
    newRole: row.new_role_key,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedByDisplayName: row.resolved_by_display_name,
    resolvedAt: row.resolved_at,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}
