import { emojiText } from "@/lib/face-emojis";
import { getD1 } from "@/app/.server/db/d1";
import { getForumRuntime } from "@/app/.server/forum/context";
import { forumLocation } from "@/app/.server/forum/location";
import type { AppRuntime } from "@/app/.server/runtime";
import type { PermissionKey } from "@/lib/authz/permissions";
import { hasPermission, isPermissionKey } from "@/lib/authz/permissions";
import { isAdministrator } from "@/lib/authz/roles";
import { administratorSql, roleAccessSql } from "./permissions";
import type {
  InboxItem,
  InboxItemStatus,
  InboxItemType,
  InboxReadTarget,
} from "@/lib/dto/db/inbox";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";
import type { InboxCategory, InboxCursor } from "@/lib/inbox";
import { INBOX_PAGE_SIZE } from "@/lib/inbox";
import { userPermissionSql } from "@/app/.server/auth/permission-sql";
import { workMaintainerRecipientSql } from "./work-maintainers";
import type { MaintainerRequestStatus } from "@/lib/work-maintainers";

type InboxItemRow = {
  id: number;
  type: InboxItemType;
  status: InboxItemStatus;
  sender_user_id: number | null;
  sender_display_name: string | null;
  sender_status: string | null;
  sender_avatar: string | null;
  friend_action: string | null;
  friend_is_following: number;
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
  closed_reason: string | null;
  rejection_reason: string | null;
  created_at: string;
  read_at: string | null;
  target_status: string | null;
  target_priority: number;
  role_priority: number | null;
  role_kind: string | null;
  role_status: string | null;
  already_assigned: number;
  can_reject: number;
  work_comment_id: number | null;
  reply_comment_id: number | null;
  like_comment_id: number | null;
  timeline_event_id: number | null;
  timeline_reply_id: number | null;
  work_maintainer_request_id: number | null;
  maintainer_work_id: number | null;
  maintainer_work_title: string | null;
  maintainer_work_status: string | null;
  maintainer_request_status: MaintainerRequestStatus | null;
  applicant_avatar: string | null;
  can_approve_maintainer: number;
  is_recipient: number;
};

function inboxSelect(details: boolean) {
  return `SELECT
  i.id,
  i.type,
  i.work_comment_id,
  i.reply_comment_id,
  i.like_comment_id,
  i.timeline_event_id,
  i.timeline_reply_id,
  i.work_maintainer_request_id,
  maintainer_request.work_id AS maintainer_work_id,
  json_extract(i.metadata_json,'$.workTitle') AS maintainer_work_title,
  maintainer_work.status AS maintainer_work_status,
  maintainer_request.status AS maintainer_request_status,
${details ? `target.avatar_blob_sha256 AS applicant_avatar,
  sender.display_name AS sender_display_name,
  sender.status AS sender_status,
  sender.avatar_blob_sha256 AS sender_avatar,
  target.display_name AS target_display_name,
  resolver.display_name AS resolved_by_display_name,
  i.title,i.body,
  json_extract(i.metadata_json,'$.closedReason') AS closed_reason,
  json_extract(i.metadata_json,'$.rejectionReason') AS rejection_reason,
  CASE WHEN i.requested_role_id IS NOT NULL THEN ${roleAccessSql("target.id", "i.requested_role_id")} ELSE 0 END AS already_assigned,` : ""}
  i.status,
  i.sender_user_id,
  CASE WHEN i.type='system_notice' THEN json_extract(i.metadata_json,'$.friend') END AS friend_action,
  i.recipient_user_id,
  i.required_permission_key,
  i.target_user_id,
  i.requested_role_id,
  i.requested_role_key_snapshot,
  i.requested_role_name_snapshot,
  i.role_event_id,
  i.resolved_by_user_id,
  i.resolved_at,
  i.created_at,
  target.status AS target_status,
  CASE WHEN i.type='role_change_request' THEN COALESCE((SELECT MAX(r.priority) FROM effective_user_roles ur JOIN roles r ON r.id=ur.role_id AND r.status='active' WHERE ur.user_id=target.id),0) ELSE 0 END AS target_priority,
  requested_role.key AS role_key,
  requested_role.priority AS role_priority,
  requested_role.kind AS role_kind,
  requested_role.status AS role_status,
  requested_role.application_enabled AS role_application_enabled,
  requested_role.available_to_all AS role_available_to_all,
  reads.read_at AS recorded_read_at
FROM inbox_items i
LEFT JOIN work_maintainer_requests maintainer_request ON maintainer_request.id=i.work_maintainer_request_id
LEFT JOIN works maintainer_work ON maintainer_work.id=maintainer_request.work_id
${details ? "LEFT JOIN users sender ON sender.id = i.sender_user_id LEFT JOIN users resolver ON resolver.id = i.resolved_by_user_id" : ""}
LEFT JOIN users target ON target.id = i.target_user_id
LEFT JOIN roles requested_role ON requested_role.id=i.requested_role_id
LEFT JOIN inbox_item_reads reads ON reads.item_id = i.id AND reads.user_id = ?`;
}

export function buildInboxVisibilityClause(
  user: ArchiveUser,
): {
  sql: string;
  audienceBinds: readonly (PermissionKey | number)[];
} {
  return {
    sql: `i.recipient_user_id = ? OR (i.type='role_change_request' AND ${administratorSql("?", "COALESCE((SELECT key FROM roles WHERE id=i.requested_role_id),i.requested_role_key_snapshot)")})
      OR (i.type<>'role_change_request' AND ${user.permissionKeys.length
        ? `i.required_permission_key IN (${user.permissionKeys.map(() => "?").join(",")})` : "0"})
      OR EXISTS(SELECT 1 FROM work_maintainer_requests mr JOIN works mw ON mw.id=mr.work_id
        WHERE mr.id=i.work_maintainer_request_id AND mw.status<>'deleted'
          AND ${workMaintainerRecipientSql('mr.work_id', String(user.id))})`,
    audienceBinds: [user.id, ...user.permissionKeys],
  };
}

function inboxQuery(user: ArchiveUser, details = true, selection?: { sql: string; binds: (string | number)[] }) {
  const visibility = buildInboxVisibilityClause(user);
  return {
    sql: `WITH visible AS (${inboxSelect(details)}
      WHERE ${selection ? `i.id IN (${selection.sql})` : `(${visibility.sql})`}), actionable AS (
      SELECT *, recipient_user_id=${user.id} AS is_recipient,
        ${details ? `EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_user_id=${user.id} AND f.followed_user_id=sender_user_id) AS friend_is_following,
        CASE WHEN work_maintainer_request_id IS NOT NULL THEN (${userPermissionSql('target_user_id', 'work.update_own')} AND NOT EXISTS
          (SELECT 1 FROM work_uploaders WHERE work_id=maintainer_work_id AND user_id=target_user_id)) ELSE 0 END AS can_approve_maintainer,` : ""}
        CASE WHEN work_maintainer_request_id IS NOT NULL AND
          (recipient_user_id=${user.id} OR NOT ${workMaintainerRecipientSql('maintainer_work_id', String(user.id))})
          THEN COALESCE(recorded_read_at,created_at) ELSE recorded_read_at END AS read_at,
        CASE WHEN type='role_change_request' THEN (status='pending' AND ?
        AND target_user_id<>? AND target_status='active' AND role_priority IS NOT NULL
        AND (role_kind='custom' OR role_key IN ('uploader','admin')) AND role_status='active'
        AND role_application_enabled=1 AND role_available_to_all=0
        AND ?>target_priority AND ?>role_priority)
        WHEN work_maintainer_request_id IS NOT NULL THEN (maintainer_request_status='pending'
          AND target_user_id<>${user.id} AND maintainer_work_status<>'deleted'
          AND ${workMaintainerRecipientSql('maintainer_work_id', String(user.id))}) ELSE 0 END AS can_reject
      FROM visible)`,
    binds: [
      user.id,
      ...(selection?.binds ?? [user.id, ...visibility.audienceBinds]),
      canResolveInboxRequests(user) ? 1 : 0,
      user.id,
      user.maxRolePriority,
      user.maxRolePriority,
    ],
  };
}

export function canResolveInboxRequests(user: ArchiveUser) {
  return (
    isAdministrator(user) &&
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
  const query = inboxQuery(user, false);
  const categorySql = {
    all: "1",
    comments: "work_comment_id IS NOT NULL",
    replies: "reply_comment_id IS NOT NULL OR timeline_reply_id IS NOT NULL",
    forum: "type='forum_reply'",
    likes: "(type='forum_like' OR like_comment_id IS NOT NULL OR (timeline_event_id IS NOT NULL AND timeline_reply_id IS NULL))",
    friends: "friend_action IN ('added','returned')",
    system:
      "type IN ('role_change_request','role_change_notice','system_notice') AND work_comment_id IS NULL AND reply_comment_id IS NULL AND like_comment_id IS NULL AND timeline_event_id IS NULL AND COALESCE(friend_action,'') NOT IN ('added','returned')",
    pending: "can_reject=1",
  }[input.category];
  const filter = `(${categorySql}) AND ${input.unread ? "read_at IS NULL" : "1"}`;
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
  // The LIMIT stays inside the ID subquery. Hydration and permission filtering
  // share one SQL snapshot, without scanning the audience again for each row.
  const details = inboxQuery(user, true, {
    sql: `${query.sql} SELECT id FROM actionable WHERE ${filter}${boundary}
      ORDER BY created_at ${order},id ${order} LIMIT ? OFFSET ?`,
    binds: [
      ...query.binds,
      ...boundaryBinds,
      INBOX_PAGE_SIZE,
      (page - 1) * INBOX_PAGE_SIZE,
    ],
  });
  const rows = await getD1(runtime)
    .prepare(`${details.sql} SELECT * FROM actionable ORDER BY created_at ${order},id ${order}`)
    .bind(...details.binds).all<InboxItemRow>();
  const items = (rows.results ?? []).map((row) => mapInboxItemRow(row, user));
  if (newer) items.reverse();
  await attachInteractions(runtime, items);
  await attachCommentNotifications(runtime, items, rows.results ?? []);
  await attachTimelineNotifications(runtime, items, rows.results ?? []);
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

function unreadInboxAudience(user: ArchiveUser) {
  // Keep each audience on its index. UNION removes items visible in multiple ways.
  const permissionAudience = user.permissionKeys.length
    ? `UNION SELECT id FROM inbox_items
        WHERE type<>'role_change_request'
          AND required_permission_key IN (${user.permissionKeys.map(() => "?").join(",")})`
    : "";
  return {
    sql: `current_administrator AS MATERIALIZED (
        SELECT ${administratorSql("?", "'admin'")} AS can_review_admin
        WHERE ${administratorSql("?")}
      ), audience AS (
        SELECT id FROM inbox_items WHERE recipient_user_id=? AND work_maintainer_request_id IS NULL
        ${permissionAudience}
        UNION SELECT i.id FROM work_uploaders wu
          JOIN work_maintainer_requests mr ON mr.work_id=wu.work_id
          JOIN works mw ON mw.id=mr.work_id AND mw.status<>'deleted'
          JOIN inbox_items i ON i.work_maintainer_request_id=mr.id
          WHERE wu.user_id=${user.id} AND mr.applicant_user_id<>${user.id}
            AND ${userPermissionSql(String(user.id), 'work.update_own')}
        UNION SELECT i.id FROM current_administrator CROSS JOIN inbox_items i
          WHERE i.type='role_change_request'
            AND (current_administrator.can_review_admin OR
              COALESCE((SELECT key FROM roles WHERE id=i.requested_role_id),i.requested_role_key_snapshot)<>'admin')
      )`,
    binds: [user.id, user.id, user.id, ...user.permissionKeys],
  };
}

export async function countUnreadInboxItemsForUser(
  runtime: AppRuntime,
  user: ArchiveUser,
): Promise<number> {
  const audience = unreadInboxAudience(user);
  const row = await getD1(runtime)
    .prepare(
      `WITH ${audience.sql}
      SELECT COUNT(*) AS count FROM audience i
      WHERE NOT EXISTS (
        SELECT 1 FROM inbox_item_reads reads WHERE reads.item_id=i.id AND reads.user_id=?
      )`,
    )
    .bind(...audience.binds, user.id)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function markInboxItemRead(
  runtime: AppRuntime,
  input: {
    user: ArchiveUser;
    itemId: number;
    target?: InboxReadTarget;
  },
): Promise<void> {
  const item = await getInboxItemForUser(runtime, input.itemId, input.user);
  const target = input.target;
  if (target && ("eventId" in target
    ? !item.timelineNotification || item.timelineNotification.eventId !== target.eventId || item.timelineNotification.replyId !== target.replyId
    : !item.interaction || item.interaction.topicId !== target.topicId || item.interaction.postNumber !== target.postNumber || item.interaction.commentId !== target.commentId)) {
    throw new HttpError(409, "提醒对应的内容已变化或不可用。");
  }
  const visibility = buildInboxVisibilityClause(input.user);
  await getD1(runtime)
    .prepare(
      `INSERT INTO inbox_item_reads (item_id, user_id, read_at)
      SELECT i.id,?,CURRENT_TIMESTAMP FROM inbox_items i WHERE i.id=? AND (${visibility.sql})
      ON CONFLICT(item_id, user_id) DO NOTHING`,
    )
    .bind(input.user.id, item.id, input.user.id, ...visibility.audienceBinds)
    .run();
}

export async function markAllInboxItemsRead(
  runtime: AppRuntime,
  user: ArchiveUser,
): Promise<number> {
  const visibility = buildInboxVisibilityClause(user);
  // One statement fixes the visible set at the start of the write; later events stay unread.
  const result = await getD1(runtime)
    .prepare(
      `INSERT INTO inbox_item_reads(item_id,user_id,read_at)
    SELECT i.id,?,CURRENT_TIMESTAMP FROM inbox_items i WHERE (${visibility.sql})
      AND NOT EXISTS(SELECT 1 FROM inbox_item_reads r WHERE r.item_id=i.id AND r.user_id=?)
    ON CONFLICT(item_id,user_id) DO NOTHING`,
    )
    .bind(user.id, user.id, ...visibility.audienceBinds, user.id)
    .run();
  return Number(result.meta.changes ?? 0);
}

export async function getInboxItemForUser(
  runtime: AppRuntime,
  itemId: number,
  viewer: ArchiveUser,
): Promise<InboxItem> {
  const visibility = buildInboxVisibilityClause(viewer);
  const query = inboxQuery(viewer, true, {
    sql: `SELECT i.id FROM inbox_items i WHERE i.id=? AND (${visibility.sql})`,
    binds: [itemId, viewer.id, ...visibility.audienceBinds],
  });
  const row = await getD1(runtime)
    .prepare(`${query.sql} SELECT * FROM actionable WHERE id=?`)
    .bind(...query.binds, itemId)
    .first<InboxItemRow>();

  if (!row) {
    throw new HttpError(404, "提醒不存在或不可访问。");
  }

  const item = mapInboxItemRow(row, viewer);

  await attachInteractions(runtime, [item]);
  await attachCommentNotifications(runtime, [item], [row]);
  await attachTimelineNotifications(runtime, [item], [row]);
  return item;
}

function mapInboxItemRow(row: InboxItemRow, viewer: ArchiveUser): InboxItem {
  const friendNotification: InboxItem["friendNotification"] = row.friend_action === "added" || row.friend_action === "returned" ? {
    userId: row.sender_status === "active" ? row.sender_user_id : null,
    kind: row.friend_action,
    actorName: row.sender_status === "active" ? row.sender_display_name ?? "用户" : row.sender_status === "disabled" ? "该用户已停用" : "账户已注销",
    actorHref: row.sender_status === "active" && row.sender_user_id !== null ? `/users/${row.sender_user_id}` : null,
    actorAvatar: row.sender_status === "active" ? row.sender_avatar : null,
    action: row.friend_action === "added" ? "请求与你成为好友" : "通过了你的好友请求",
    isFollowing: !!row.friend_is_following,
    canFollow: row.sender_status === "active" && row.sender_user_id !== null && row.sender_user_id !== viewer.id
      && !row.friend_is_following && hasPermission(viewer, "timeline.follow.create"),
  } : null;
  return {
    canApprove: !!row.can_reject && (row.work_maintainer_request_id !== null
      ? !!row.can_approve_maintainer : row.role_status === "active" && !row.already_assigned),
    canReject: !!row.can_reject,
    maintainerRequest: row.work_maintainer_request_id !== null && row.maintainer_work_id !== null ? {
      workId: row.maintainer_work_id, workTitle: row.maintainer_work_title ?? '作品',
      applicant: { id: row.target_user_id!, displayName: row.target_display_name ?? '账户已注销', avatarBlobSha256: row.applicant_avatar },
      status: row.maintainer_request_status ?? 'closed',
      canWithdraw: !!row.is_recipient && row.maintainer_request_status === 'pending',
    } : null,
    interaction: null,
    friendNotification,
    commentNotification: null,
    timelineNotification: null,
    id: row.id,
    type: row.type,
    status: row.status,
    senderUserId: row.sender_user_id,
    senderDisplayName: friendNotification?.actorName ?? row.sender_display_name,
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
    closedReason: row.closed_reason,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

async function attachCommentNotifications(runtime: AppRuntime, items: InboxItem[], source: InboxItemRow[]) {
  const ids = source.filter((row) => row.work_comment_id !== null || row.reply_comment_id !== null || row.like_comment_id !== null).map((row) => row.id);
  if (!ids.length) return;
  const rows = await getD1(runtime).prepare(`SELECT i.id,json_extract(i.metadata_json,'$.mention') AS mention,c.body,i.reply_comment_id,i.like_comment_id,c.root_comment_id,
      c.work_id,c.creator_id,c.character_id,
      COALESCE(NULLIF(w.chinese_title,''),w.original_title,cr.name,ch.primary_name) AS target_title,
      sender.id AS sender_id,sender.display_name,sender.status AS sender_status,
      (SELECT COUNT(*) FROM comment_images ci WHERE ci.comment_id=c.id AND ci.status='ready') AS image_count
    FROM inbox_items i JOIN public_comments c ON c.id=COALESCE(i.like_comment_id,i.reply_comment_id,i.work_comment_id)
    LEFT JOIN public_works w ON w.id=c.work_id
    LEFT JOIN creators cr ON cr.id=c.creator_id
    LEFT JOIN characters ch ON ch.id=c.character_id
    JOIN users sender ON sender.id=i.sender_user_id AND sender.status IN ('active','deleted')
    WHERE i.id IN (SELECT value FROM json_each(?))
      AND (i.reply_comment_id IS NULL OR EXISTS (
        SELECT 1 FROM public_comments target WHERE target.id=COALESCE(c.reply_to_comment_id,c.root_comment_id)
      ))`)
    .bind(JSON.stringify(ids)).all<{
      id: number; mention: number | null; body: string; reply_comment_id: number | null; like_comment_id: number | null; root_comment_id: number | null;
      work_id: number | null; creator_id: number | null; character_id: number | null; target_title: string;
      sender_id: number; display_name: string; sender_status: string; image_count: number;
    }>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  const noticeIds = new Set(ids);
  for (const item of items) {
    if (!noticeIds.has(item.id)) continue;
    item.senderUserId = null;
    item.senderDisplayName = null;
    item.title = "相关内容已不可用";
    item.body = "";
    const row = byId.get(item.id);
    if (!row) continue;
    const name = row.sender_status === "deleted" ? "账户已注销" : row.display_name;
    const action = row.mention ? "在评论中提及了你" : row.like_comment_id
      ? `赞了你的${row.root_comment_id ? "回复" : "评论"}`
      : row.reply_comment_id ? "回复了你的评论" : "评论了你上传的作品";
    item.title = `${name}${action}`;
    item.commentNotification = {
      actorName: name,
      actorHref: row.sender_status === "active" ? `/users/${row.sender_id}` : null,
      action,
      kind: row.mention ? "mention" : row.like_comment_id ? "like" : row.reply_comment_id ? "reply" : "comment",
      targetTitle: row.target_title,
      href: `${row.work_id ? `/games/${row.work_id}` : row.creator_id ? `/creators/${row.creator_id}` : `/characters/${row.character_id}`}#sec-comments`,
      excerpt: emojiText(row.body).slice(0, 180) + (row.image_count ? ` ［${row.image_count} 张图片］` : ""),
    };
  }
}

async function attachTimelineNotifications(runtime: AppRuntime, items: InboxItem[], source: InboxItemRow[]) {
  const ids = source.filter((row) => row.timeline_event_id !== null).map((row) => row.id);
  if (!ids.length) return;
  const rows = await getD1(runtime).prepare(`SELECT i.id,e.id AS event_id,r.id AS reply_id,
      CASE WHEN i.timeline_reply_id IS NULL THEN e.body ELSE r.body END AS body,
      sender.id AS sender_id,sender.display_name,sender.avatar_blob_sha256,
      CASE WHEN i.timeline_reply_id IS NULL THEN
        (SELECT COUNT(*) FROM comment_images ci WHERE ci.status='ready' AND ci.timeline_event_id=e.id)
        ELSE (SELECT COUNT(*) FROM comment_images ci WHERE ci.status='ready' AND ci.timeline_reply_id=r.id) END AS image_count
    FROM inbox_items i JOIN timeline_events e ON e.id=i.timeline_event_id AND e.kind='status' AND e.hidden_at IS NULL
    JOIN users author ON author.id=e.user_id AND author.status='active'
    JOIN users sender ON sender.id=i.sender_user_id AND sender.status='active'
    LEFT JOIN timeline_status_replies r ON r.id=i.timeline_reply_id AND r.event_id=e.id AND r.user_id=sender.id AND r.hidden_at IS NULL
    WHERE i.id IN (SELECT value FROM json_each(?)) AND (i.timeline_reply_id IS NULL OR r.id IS NOT NULL)`)
    .bind(JSON.stringify(ids)).all<{
      id: number; event_id: number; reply_id: number | null; body: string; sender_id: number;
      display_name: string; avatar_blob_sha256: string | null; image_count: number;
    }>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  const noticeIds = new Set(ids);
  for (const item of items) {
    if (!noticeIds.has(item.id)) continue;
    item.senderUserId = null;
    item.senderDisplayName = null;
    item.title = "相关内容已不可用";
    item.body = "";
    const row = byId.get(item.id);
    if (!row) continue;
    const action = row.reply_id === null ? "赞了你的吐槽" : "回复了你的吐槽";
    item.title = row.display_name + action;
    item.timelineNotification = {
      eventId: row.event_id, replyId: row.reply_id, kind: row.reply_id === null ? "like" : "reply",
      actorName: row.display_name, actorHref: `/users/${row.sender_id}`, actorAvatar: row.avatar_blob_sha256,
      action, targetTitle: "你的吐槽",
      href: `/timeline?event=${row.event_id}${row.reply_id === null ? `#timeline-event-${row.event_id}` : `&reply=${row.reply_id}#timeline-reply-item-${row.reply_id}`}`,
      excerpt: emojiText(row.body).slice(0, 180) + (row.image_count ? ` ［${row.image_count} 张图片］` : ""),
    };
  }
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
    mention: number | null;
  };
  const rows = await getD1(runtime)
    .prepare(
      `SELECT i.id,json_extract(i.metadata_json,'$.mention') AS mention,t.id AS topic_id,p.post_number,c.id AS comment_id,
    t.title AS topic_title,CASE WHEN i.forum_comment_id IS NOT NULL THEN c.body ELSE p.body END AS excerpt,
    sender.id AS actor_id,sender.display_name AS actor_name,sender.status AS actor_status,
    sender.avatar_blob_sha256 AS actor_avatar,c.reply_to_id
    FROM inbox_items i JOIN forum_public_topics t ON t.id=i.forum_topic_id
    JOIN forum_posts p ON p.id=i.forum_post_id AND p.topic_id=t.id
    JOIN users sender ON sender.id=i.sender_user_id AND sender.status IN ('active','deleted')
    LEFT JOIN forum_public_comments c ON c.id=i.forum_comment_id AND c.post_id=p.id
    WHERE i.id IN (SELECT value FROM json_each(?))
      AND ((i.type='forum_like' AND i.forum_comment_id IS NOT NULL) OR
        EXISTS(SELECT 1 FROM forum_public_posts visible_post WHERE visible_post.id=p.id))
      AND (i.forum_comment_id IS NULL OR (c.id IS NOT NULL AND (i.type='forum_like' OR c.reply_to_id IS NULL OR
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
      row.mention ? "在讨论中提及了你" : item.type === "forum_like"
        ? row.comment_id
          ? "赞了你的回复"
          : "赞了你的帖子"
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
  if (item.timelineNotification) return { href: item.timelineNotification.href };
  if (item.commentNotification) return { href: item.commentNotification.href };
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
