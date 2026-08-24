import type { RoleKey, RoleId } from "@/lib/authz/roles";
import { hasPermission, isPermissionKey, type PermissionKey } from "@/lib/authz/permissions";
import { getD1 } from "@/lib/server/db/d1";
import type { ArchiveUser } from "@/lib/server/db/users";

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
  requiredPermissionKey: PermissionKey | null;
  targetUserId: number | null;
  targetDisplayName: string | null;
  requestedRole: RoleSnapshot | null;
  roleEventId: number | null;
  resolvedByUserId: number | null;
  resolvedByDisplayName: string | null;
  resolvedAt: string | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export type RoleSnapshot = { id: RoleId | null; key: RoleKey; name: string };

type InboxItemRow = {
  id: number;
  type: InboxItemType;
  status: InboxItemStatus;
  sender_user_id: number | null;
  sender_display_name: string | null;
  recipient_user_id: number | null;
  required_permission_key: string | null;
  target_user_id: number | null;
  target_display_name: string | null;
  requested_role_id: number | null;
  requested_role_key_snapshot: string | null;
  requested_role_name_snapshot: string | null;
  role_event_id: number | null;
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
  i.required_permission_key,
  i.target_user_id,
  target.display_name AS target_display_name,
  i.requested_role_id,
  i.requested_role_key_snapshot,
  i.requested_role_name_snapshot,
  i.role_event_id,
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

type IdRow = {
  id: number;
};

export function buildInboxVisibilityClause(permissionKeys: readonly PermissionKey[]): {
  sql: string;
  permissionBinds: readonly PermissionKey[];
} {
  if (permissionKeys.length === 0) {
    return { sql: "i.recipient_user_id = ? OR 0", permissionBinds: [] };
  }

  return {
    sql: `i.recipient_user_id = ? OR i.required_permission_key IN (${permissionKeys.map(() => "?").join(",")})`,
    permissionBinds: permissionKeys,
  };
}

export async function listInboxItemsForUser(user: ArchiveUser): Promise<InboxItem[]> {
  const visibility = buildInboxVisibilityClause(user.permissionKeys);
  const rows = await getD1()
    .prepare(
      `${INBOX_SELECT}
      WHERE ${visibility.sql}
      ORDER BY
        CASE i.status WHEN 'pending' THEN 0 ELSE 1 END,
        i.created_at DESC
      LIMIT 200`,
    )
    .bind(user.id, user.id, ...visibility.permissionBinds)
    .all<InboxItemRow>();

  return (rows.results ?? [])
    .map(mapInboxItemRow)
    .filter((item) => canViewInboxItem(user, item));
}

export async function countUnreadInboxItemsForUser(
  user: ArchiveUser,
): Promise<number> {
  const visibility = buildInboxVisibilityClause(user.permissionKeys);
  const row = await getD1()
    .prepare(
      `SELECT COUNT(*) AS count
      FROM inbox_items i
      LEFT JOIN inbox_item_reads reads
        ON reads.item_id = i.id AND reads.user_id = ?
      WHERE (${visibility.sql})
        AND reads.read_at IS NULL`,
    )
    .bind(user.id, user.id, ...visibility.permissionBinds)
    .first<{ count: number }>();
  return row?.count ?? 0;
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
  const visibility = buildInboxVisibilityClause(user.permissionKeys);
  const rows = await getD1()
    .prepare(
      `SELECT i.id
      FROM inbox_items i
      LEFT JOIN inbox_item_reads reads
        ON reads.item_id = i.id AND reads.user_id = ?
      WHERE (${visibility.sql})
        AND reads.read_at IS NULL
      LIMIT 500`,
    )
    .bind(user.id, user.id, ...visibility.permissionBinds)
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

function canViewInboxItem(user: ArchiveUser, item: InboxItem): boolean {
  if (item.recipientUserId === user.id) {
    return true;
  }

  return Boolean(
    item.requiredPermissionKey && hasPermission(user, item.requiredPermissionKey),
  );
}

function mapInboxItemRow(row: InboxItemRow): InboxItem {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    senderUserId: row.sender_user_id,
    senderDisplayName: row.sender_display_name,
    recipientUserId: row.recipient_user_id,
    requiredPermissionKey: parseOptionalPermissionKey(row.required_permission_key),
    targetUserId: row.target_user_id,
    targetDisplayName: row.target_display_name,
    requestedRole: row.requested_role_id ? { id: row.requested_role_id, key: row.requested_role_key_snapshot ?? "", name: row.requested_role_name_snapshot ?? "" } : null,
    roleEventId: row.role_event_id,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedByDisplayName: row.resolved_by_display_name,
    resolvedAt: row.resolved_at,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

function parseOptionalPermissionKey(value: string | null): PermissionKey | null {
  if (value === null) return null;
  if (!isPermissionKey(value)) throw new Error(`Unknown permission key: ${value}`);
  return value;
}
