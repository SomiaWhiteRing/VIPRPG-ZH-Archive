import { emojiText } from "@/lib/face-emojis";
import { getD1 } from "@/app/.server/db/d1";
import { getForumRuntime } from "@/app/.server/forum/context";
import { forumLocation } from "@/app/.server/forum/location";
import type { AppRuntime } from "@/app/.server/runtime";
import type { PermissionKey } from "@/lib/authz/permissions";
import { hasPermission, isPermissionKey } from "@/lib/authz/permissions";
import type {
  InboxItem,
  InboxItemStatus,
  InboxItemType,
} from "@/lib/dto/db/inbox";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";
import type { InboxCategory, InboxCursor } from "@/lib/inbox";
import { INBOX_PAGE_SIZE } from "@/lib/inbox";

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
  target_status: string | null;
  target_priority: number;
  role_priority: number | null;
  role_kind: string | null;
  role_status: string | null;
  already_assigned: number;
  can_reject: number;
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
  target.status AS target_status,
  COALESCE((SELECT MAX(r.priority) FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.status='active' WHERE ur.user_id=target.id),0) AS target_priority,
  requested_role.priority AS role_priority,
  requested_role.kind AS role_kind,
  requested_role.status AS role_status,
  EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=target.id AND ur.role_id=i.requested_role_id) AS already_assigned,
  reads.read_at
FROM inbox_items i
LEFT JOIN users sender ON sender.id = i.sender_user_id
LEFT JOIN users target ON target.id = i.target_user_id
LEFT JOIN roles requested_role ON requested_role.id=i.requested_role_id
LEFT JOIN users resolver ON resolver.id = i.resolved_by_user_id
LEFT JOIN inbox_item_reads reads ON reads.item_id = i.id AND reads.user_id = ?`;

export function buildInboxVisibilityClause(
  permissionKeys: readonly PermissionKey[],
): {
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

function inboxQuery(user: ArchiveUser) {
  const visibility = buildInboxVisibilityClause(user.permissionKeys);
  return {
    sql: `WITH visible AS (${INBOX_SELECT} WHERE (${visibility.sql})), actionable AS (
      SELECT *, (type='role_change_request' AND status='pending' AND ?
        AND target_user_id<>? AND target_status='active' AND role_priority IS NOT NULL
        AND role_kind<>'bootstrap_admin' AND ?>target_priority AND ?>role_priority) AS can_reject
      FROM visible)`,
    binds: [
      user.id,
      user.id,
      ...visibility.permissionBinds,
      canResolveInboxRequests(user) ? 1 : 0,
      user.id,
      user.maxRolePriority,
      user.maxRolePriority,
    ],
  };
}

export function canResolveInboxRequests(user: ArchiveUser) {
  return (
    hasPermission(user, "inbox.role_request.resolve") &&
    hasPermission(user, "user.role.assign")
  );
}

export async function listInboxItemsForUser(
  runtime: AppRuntime,
  user: ArchiveUser,
  input: {
    category: InboxCategory;
    unread: boolean;
    page: number;
    cursor?: InboxCursor;
  },
) {
  const query = inboxQuery(user);
  const categorySql = {
    all: "1",
    replies: "type='forum_reply'",
    likes: "type='forum_like'",
    system:
      "type IN ('role_change_request','role_change_notice','system_notice')",
    pending: "can_reject=1",
  }[input.category];
  const filter = `${categorySql} AND ${input.unread ? "read_at IS NULL" : "1"}`;
  // Resolve the boundary from all visible items, including ones just marked read.
  // Filtering unread rows before resolving it would lose the pagination anchor.
  const anchor =
    input.unread && input.cursor
      ? await getD1(runtime)
          .prepare(`${query.sql} SELECT id,created_at FROM actionable WHERE id=?`)
          .bind(...query.binds, input.cursor.itemId)
          .first<{ id: number; created_at: string }>()
      : null;
  const newer = !!anchor && input.cursor?.direction === "newer";
  const comparison = newer ? ">" : "<";
  const order = newer ? "ASC" : "DESC";
  const boundary = anchor
    ? ` AND (created_at ${comparison} ? OR (created_at=? AND id ${comparison} ?))`
    : "";
  const boundaryBinds = anchor
    ? [anchor.created_at, anchor.created_at, anchor.id]
    : [];
  const totals = await getD1(runtime)
    .prepare(
      `${query.sql} SELECT
    COUNT(CASE WHEN ${filter} THEN 1 END) AS total,
    COUNT(CASE WHEN ${filter}${boundary} THEN 1 END) AS matching,
    COUNT(CASE WHEN can_reject=1 THEN 1 END) AS pending,
    COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread FROM actionable`,
    )
    .bind(...query.binds, ...boundaryBinds)
    .first<{ total: number; matching: number; pending: number; unread: number }>();
  const total = totals?.total ?? 0;
  const matching = totals?.matching ?? 0;
  const page = input.unread
    ? 1
    : Math.max(
        1,
        Math.min(input.page, Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE))),
      );
  const rows = await getD1(runtime)
    .prepare(
      `${query.sql} SELECT * FROM actionable WHERE ${filter}${boundary}
    ORDER BY created_at ${order},id ${order} LIMIT ? OFFSET ?`,
    )
    .bind(
      ...query.binds,
      ...boundaryBinds,
      INBOX_PAGE_SIZE,
      (page - 1) * INBOX_PAGE_SIZE,
    )
    .all<InboxItemRow>();
  const items = (rows.results ?? []).map(mapInboxItemRow);
  if (newer) items.reverse();
  await attachInteractions(runtime, items);
  const firstId = items[0]?.id ?? anchor?.id;
  const lastId = items.at(-1)?.id ?? anchor?.id;
  const hasNewer = newer ? matching > INBOX_PAGE_SIZE : total > matching;
  const hasOlder = newer ? total > matching : matching > INBOX_PAGE_SIZE;
  return {
    items,
    total,
    page,
    pageSize: INBOX_PAGE_SIZE,
    pending: totals?.pending ?? 0,
    unread: totals?.unread ?? 0,
    previousCursor:
      input.unread && hasNewer && firstId
        ? { itemId: firstId, direction: "newer" as const }
        : undefined,
    nextCursor:
      input.unread && hasOlder && lastId
        ? { itemId: lastId, direction: "older" as const }
        : undefined,
  };
}

export async function countUnreadInboxItemsForUser(
  runtime: AppRuntime,
  user: ArchiveUser,
): Promise<number> {
  const visibility = buildInboxVisibilityClause(user.permissionKeys);
  const row = await getD1(runtime)
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

export async function markInboxItemRead(
  runtime: AppRuntime,
  input: {
    user: ArchiveUser;
    itemId: number;
    target?: { topicId: number; postNumber: number; commentId: number | null };
  },
): Promise<void> {
  const item = await getInboxItemForUser(runtime, input.itemId, input.user);
  if (
    input.target &&
    (!item.interaction ||
      item.interaction.topicId !== input.target.topicId ||
      item.interaction.postNumber !== input.target.postNumber ||
      item.interaction.commentId !== input.target.commentId)
  ) {
    throw new HttpError(409, "提醒对应的内容已变化或不可用。");
  }
  const visibility = buildInboxVisibilityClause(input.user.permissionKeys);
  await getD1(runtime)
    .prepare(
      `INSERT INTO inbox_item_reads (item_id, user_id, read_at)
      SELECT i.id,?,CURRENT_TIMESTAMP FROM inbox_items i WHERE i.id=? AND (${visibility.sql})
      ON CONFLICT(item_id, user_id) DO NOTHING`,
    )
    .bind(input.user.id, item.id, input.user.id, ...visibility.permissionBinds)
    .run();
}

export async function markAllInboxItemsRead(
  runtime: AppRuntime,
  user: ArchiveUser,
): Promise<number> {
  const visibility = buildInboxVisibilityClause(user.permissionKeys);
  // One statement fixes the visible set at the start of the write; later events stay unread.
  const result = await getD1(runtime)
    .prepare(
      `INSERT INTO inbox_item_reads(item_id,user_id,read_at)
    SELECT i.id,?,CURRENT_TIMESTAMP FROM inbox_items i WHERE (${visibility.sql})
      AND NOT EXISTS(SELECT 1 FROM inbox_item_reads r WHERE r.item_id=i.id AND r.user_id=?)
    ON CONFLICT(item_id,user_id) DO NOTHING`,
    )
    .bind(user.id, user.id, ...visibility.permissionBinds, user.id)
    .run();
  return Number(result.meta.changes ?? 0);
}

export async function getInboxItemForUser(
  runtime: AppRuntime,
  itemId: number,
  viewer: ArchiveUser,
): Promise<InboxItem> {
  const query = inboxQuery(viewer);
  const row = await getD1(runtime)
    .prepare(`${query.sql} SELECT * FROM actionable WHERE id=?`)
    .bind(...query.binds, itemId)
    .first<InboxItemRow>();

  if (!row) {
    throw new HttpError(404, "提醒不存在或不可访问。");
  }

  const item = mapInboxItemRow(row);

  await attachInteractions(runtime, [item]);
  return item;
}

function mapInboxItemRow(row: InboxItemRow): InboxItem {
  return {
    canApprove:
      !!row.can_reject && row.role_status === "active" && !row.already_assigned,
    canReject: !!row.can_reject,
    interaction: null,
    id: row.id,
    type: row.type,
    status: row.status,
    senderUserId: row.sender_user_id,
    senderDisplayName: row.sender_display_name,
    recipientUserId: row.recipient_user_id,
    requiredPermissionKey: parseOptionalPermissionKey(
      row.required_permission_key,
    ),
    targetUserId: row.target_user_id,
    targetDisplayName: row.target_display_name,
    requestedRole: row.requested_role_id
      ? {
          id: row.requested_role_id,
          key: row.requested_role_key_snapshot ?? "",
          name: row.requested_role_name_snapshot ?? "",
        }
      : null,
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

async function attachInteractions(runtime: AppRuntime, items: InboxItem[]) {
  const interactions = items.filter(
    (item) => item.type === "forum_reply" || item.type === "forum_like",
  );
  if (!interactions.length) return;
  type InteractionRow = {
    id: number;
    topic_id: number;
    post_number: number;
    comment_id: number | null;
    topic_title: string;
    excerpt: string;
    actor_id: number;
    actor_name: string;
    actor_status: string;
    actor_avatar: string | null;
    reply_to_id: number | null;
  };
  const rows = await getD1(runtime)
    .prepare(
      `SELECT i.id,t.id AS topic_id,p.post_number,c.id AS comment_id,
    t.title AS topic_title,CASE WHEN i.type='forum_like' THEN ''
      WHEN i.forum_comment_id IS NOT NULL THEN c.body ELSE p.body END AS excerpt,
    sender.id AS actor_id,sender.display_name AS actor_name,sender.status AS actor_status,
    sender.avatar_blob_sha256 AS actor_avatar,c.reply_to_id
    FROM inbox_items i JOIN forum_public_topics t ON t.id=i.forum_topic_id
    JOIN forum_public_posts p ON p.id=i.forum_post_id AND p.topic_id=t.id
    JOIN users sender ON sender.id=i.sender_user_id AND sender.status IN ('active','deleted')
    LEFT JOIN forum_public_comments c ON c.id=i.forum_comment_id AND c.post_id=p.id
    WHERE i.id IN (SELECT value FROM json_each(?))
      AND (i.forum_comment_id IS NULL OR (c.id IS NOT NULL AND (c.reply_to_id IS NULL OR
        EXISTS(SELECT 1 FROM forum_public_comments target WHERE target.id=c.reply_to_id AND target.post_id=p.id))))`,
    )
    .bind(JSON.stringify(interactions.map((item) => item.id)))
    .all<InteractionRow>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  for (const item of interactions) {
    // No private actor identity or content is serialized for an unavailable interaction.
    item.senderUserId = null;
    item.senderDisplayName = null;
    item.title = "相关内容已不可用";
    item.body = "";
    const row = byId.get(item.id);
    if (!row) continue;
    const name = row.actor_status === "deleted" ? "账户已注销" : row.actor_name;
    const action =
      item.type === "forum_like"
        ? "赞了你的帖子"
        : row.comment_id
          ? row.reply_to_id
            ? "回复了你的回复"
            : "回复了你的帖子"
          : "回复了你的主题";
    item.title = `${name}${action}`;
    item.interaction = {
      topicId: row.topic_id,
      postNumber: row.post_number,
      commentId: row.comment_id,
      topicTitle: row.topic_title,
      excerpt: emojiText(row.excerpt).slice(0,180),
      actorName: name,
      action,
      actorHref:
        row.actor_status === "active" ? `/users/${row.actor_id}` : null,
      actorAvatar: row.actor_status === "active" ? row.actor_avatar : null,
    };
  }
}

export async function inboxTargetLocation(
  runtime: AppRuntime,
  item: InboxItem,
) {
  if (!item.interaction) return null;
  const target = item.interaction;
  try {
    return await forumLocation(
      getForumRuntime(runtime),
      target.topicId,
      target.commentId
        ? { commentId: target.commentId }
        : { postNumber: target.postNumber },
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

function parseOptionalPermissionKey(
  value: string | null,
): PermissionKey | null {
  if (value === null) return null;
  if (!isPermissionKey(value))
    throw new Error(`Unknown permission key: ${value}`);
  return value;
}
