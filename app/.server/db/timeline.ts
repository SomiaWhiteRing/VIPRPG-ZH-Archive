import { contentEmojiStatements, validateBodyEmojis } from "@/app/.server/emojis/service";
import { statusBody, timelineBody, timelineEmojiMap } from "@/app/.server/timeline/content";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { hasPermission, type PermissionKey } from "@/lib/authz/permissions";
import { userPermissionSql } from "@/app/.server/auth/permission-sql";
import { sha256Hex } from "@/lib/sha256";
import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { emojiText } from "@/lib/face-emojis";
import { mentionText } from "@/lib/mentions";
import { HttpError } from "@/lib/http";
import { commentImagesById, parseCommentImageIds, timelineImageGuard, timelineImageStatement, timelineImagesById } from "@/app/.server/comments/images";
import { TIMELINE_RECORD_KINDS, isTimelineDefaultView, isTimelineKind, isTimelineRecordKind, type TimelineDefaultView, type TimelineKind, type TimelineSettings, type TimelineItem, type TimelinePage } from "@/lib/dto/db/timeline";

type Bind = string | number | null;
export function timelineStatement(db: D1Database, input: {
  userId: number; kind: TimelineKind; action: "收藏了作品" | "上传了作品" | "上传了新版本" | "初次游玩"; eventKey?: string;
  workId?: number; catalogId?: number; archiveVersionId?: number;
  predicate?: string; args?: Bind[];
}) {
  return db.prepare(`INSERT INTO timeline_events(user_id,kind,action,event_key,work_id,catalog_id,archive_version_id)
    SELECT id,?,?,?,?,?,? FROM users WHERE id=? AND status='active' AND timeline_enabled=1
    AND ${userPermissionSql("users.id", "timeline.use")}
    AND EXISTS(SELECT 1 FROM json_each(timeline_record_kinds) WHERE value=?)
    AND (${input.predicate ?? "1"}) ON CONFLICT(event_key) DO NOTHING`)
    .bind(input.kind, input.action, input.eventKey ?? crypto.randomUUID(), input.workId ?? null,
      input.catalogId ?? null, input.archiveVersionId ?? null, input.userId, input.kind, ...(input.args ?? []));
}

export async function readTimelineSettings(runtime: AppRuntime, userId: number): Promise<TimelineSettings> {
  const row = await getD1(runtime).prepare(`SELECT timeline_enabled,timeline_record_kinds,timeline_as_homepage,timeline_default_view FROM users WHERE id=? AND status='active'`)
    .bind(userId).first<{ timeline_enabled: number; timeline_record_kinds: string; timeline_as_homepage: number; timeline_default_view: TimelineDefaultView }>();
  if (!row) throw new HttpError(404, "账户不可用");
  const kinds: unknown = JSON.parse(row.timeline_record_kinds);
  return { enabled: row.timeline_enabled === 1, recordKinds: Array.isArray(kinds) ? kinds.filter(isTimelineRecordKind) : [], timelineAsHomepage: row.timeline_as_homepage === 1, defaultView: row.timeline_default_view };
}

export async function updateTimelineSettings(runtime: AppRuntime, userId: number, input: Record<string, unknown>): Promise<TimelineSettings> {
  if (typeof input.enabled !== "boolean" || !Array.isArray(input.recordKinds) || input.recordKinds.length > TIMELINE_RECORD_KINDS.length ||
    input.recordKinds.some((kind) => !isTimelineRecordKind(kind)) || new Set(input.recordKinds).size !== input.recordKinds.length ||
    (input.timelineAsHomepage !== undefined && typeof input.timelineAsHomepage !== "boolean") ||
    (input.defaultView !== undefined && !isTimelineDefaultView(input.defaultView)))
    throw new HttpError(400, "动态设置格式无效");
  const kinds = TIMELINE_RECORD_KINDS.filter((kind) => (input.recordKinds as unknown[]).includes(kind));
  if (input.enabled) await assertTimelinePermission(runtime, userId, ["timeline.use"]);
  const result = await getD1(runtime).prepare(`UPDATE users SET timeline_enabled=?,timeline_record_kinds=?,timeline_as_homepage=COALESCE(?,timeline_as_homepage),timeline_default_view=COALESCE(?,timeline_default_view),updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='active' AND (?=0 OR ${userPermissionSql("users.id", "timeline.use")}) RETURNING timeline_as_homepage,timeline_default_view`)
    .bind(input.enabled ? 1 : 0, JSON.stringify(kinds), input.timelineAsHomepage === undefined ? null : input.timelineAsHomepage ? 1 : 0, input.defaultView === undefined ? null : input.defaultView as TimelineDefaultView, userId, input.enabled ? 1 : 0)
    .first<{ timeline_as_homepage: number; timeline_default_view: TimelineDefaultView }>();
  if (!result) throw new HttpError(404, "账户不可用");
  return { enabled: input.enabled, recordKinds: kinds, timelineAsHomepage: result.timeline_as_homepage === 1, defaultView: result.timeline_default_view };
}

// Public source projections are checked on every read, not copied into events.
// Recording switches only affect future activity writes; source privacy gates reads.
// Resolve complex public views by source ID to avoid materializing them site-wide.
const FROM = `FROM timeline_events e JOIN users u ON u.id=e.user_id
  LEFT JOIN public_works w ON w.id=e.work_id
  LEFT JOIN catalogs cat ON cat.id=e.catalog_id AND cat.status='published'
  LEFT JOIN users cat_owner ON cat_owner.id=cat.owner_user_id
  LEFT JOIN comments c ON c.id=(SELECT pc.id FROM public_comments pc WHERE pc.id=e.comment_id)
  LEFT JOIN public_works cw ON cw.id=c.work_id
  LEFT JOIN creators cr ON cr.id=c.creator_id AND cr.public_at IS NOT NULL
  LEFT JOIN characters ch ON ch.id=c.character_id
  LEFT JOIN forum_posts fp ON fp.id=(SELECT pp.id FROM forum_public_posts pp WHERE pp.id=e.forum_post_id)
  LEFT JOIN forum_topics ft ON ft.id=fp.topic_id
  LEFT JOIN archive_versions av ON av.id=e.archive_version_id
  WHERE (u.status='active' OR (u.status='deleted' AND e.kind IN ('join','rename'))) AND e.hidden_at IS NULL AND CASE e.kind
    WHEN 'favorite' THEN e.action='收藏了作品' AND u.profile_show_favorites=1 AND w.id IS NOT NULL
    WHEN 'play' THEN u.profile_show_history=1 AND w.id IS NOT NULL
    WHEN 'upload' THEN w.id IS NOT NULL AND (e.archive_version_id IS NULL OR (av.status='published' AND av.purged_at IS NULL AND av.work_id=w.id))
    WHEN 'catalog' THEN e.action='创建了目录' AND u.profile_show_catalogs=1 AND cat.id IS NOT NULL AND cat_owner.status='active' AND cat_owner.profile_show_catalogs=1
    WHEN 'comment' THEN u.profile_show_comments=1 AND c.id IS NOT NULL AND c.root_comment_id IS NULL
    WHEN 'discussion' THEN u.profile_show_discussions=1 AND ft.id IS NOT NULL AND fp.post_number=1
    WHEN 'status' THEN 1 WHEN 'join' THEN 1 WHEN 'rename' THEN 1 ELSE 0 END`;
const COLUMNS = `e.id,e.user_id,e.kind,e.action,e.created_at,e.updated_at,e.body,e.previous_name,e.new_name,e.work_id,e.catalog_id,e.comment_id,e.forum_post_id,
  u.display_name,u.avatar_blob_sha256,
  CASE WHEN e.kind='catalog' THEN cat.title WHEN e.kind='discussion' THEN ft.title
    ELSE COALESCE(NULLIF(w.chinese_title,''),w.original_title,NULLIF(cw.chinese_title,''),cw.original_title,cr.name,ch.primary_name) END AS target_title,
  COALESCE(w.id,cw.id) AS preview_work_id,
  COALESCE(NULLIF(w.chinese_title,''),w.original_title,NULLIF(cw.chinese_title,''),cw.original_title) AS preview_work_title,
  COALESCE(w.original_title,cw.original_title) AS preview_work_original_title,
  COALESCE(w.genre,cw.genre) AS preview_work_genre,COALESCE(w.engine_family,cw.engine_family) AS preview_work_engine,
  (SELECT ma.blob_sha256 FROM work_media_assets wma JOIN media_assets ma ON ma.id=wma.media_asset_id
    WHERE wma.work_id=COALESCE(w.id,cw.id) AND wma.role='cover' ORDER BY wma.sort_order,wma.media_asset_id LIMIT 1) AS preview_work_cover,
  CASE WHEN e.kind='comment' THEN (SELECT COUNT(*) FROM public_comments r WHERE r.root_comment_id=c.id)
    WHEN e.kind='discussion' THEN (SELECT COUNT(*) FROM forum_public_posts p WHERE p.topic_id=ft.id AND p.post_number>1)
    ELSE NULL END AS source_reply_count,
  c.work_id AS comment_work_id,c.creator_id AS comment_creator_id,c.character_id AS comment_character_id,
  cat.description AS catalog_description,c.body AS source_body,
  ft.id AS topic_id,fp.post_number,
  (SELECT favorite_note FROM user_work_entries f WHERE f.user_id=e.user_id AND f.work_id=e.work_id AND f.favorited_at IS NOT NULL) AS favorite_note`;
type TimelineRow = {
  id: number; user_id: number; kind: TimelineKind; action: string; created_at: string; updated_at: string; body: string | null;
  previous_name: string | null; new_name: string | null;
  work_id: number | null; catalog_id: number | null; comment_id: number | null; forum_post_id: number | null;
  display_name: string; avatar_blob_sha256: string | null; target_title: string | null;
  preview_work_id: number | null; preview_work_title: string | null; preview_work_original_title: string | null;
  preview_work_genre: string | null; preview_work_engine: string | null; preview_work_cover: string | null;
  source_reply_count: number | null;
  comment_work_id: number | null; comment_creator_id: number | null; comment_character_id: number | null;
  catalog_description: string | null; source_body: string | null; topic_id: number | null; post_number: number | null; favorite_note: string | null;
  like_count: number; reply_count: number; liked_by_me: number;
};
type Cursor = { at: string; id: number; actor: number | null; kind: TimelineKind | null; followingUserId: number | null; followingRevision: number | null };
function readCursor(value: string, actor: number | null, kind: TimelineKind | null, followingUserId: number | null): Cursor {
  try {
    if (value.length > 300) throw new Error();
    const cursor = JSON.parse(atob(value)) as Cursor;
    if (!cursor || typeof cursor.at !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cursor.at) ||
      !Number.isSafeInteger(cursor.id) || cursor.id < 1 || cursor.actor !== actor || cursor.kind !== kind || cursor.followingUserId !== followingUserId ||
      (followingUserId !== null && (!Number.isSafeInteger(cursor.followingRevision) || cursor.followingRevision! < 0))) throw new Error();
    return cursor;
  } catch { throw new HttpError(400, "动态分页位置无效，请返回最新动态"); }
}
function mapItem(row: TimelineRow, viewer: Awaited<ReturnType<typeof getCurrentUser>>, emojis: Awaited<ReturnType<typeof timelineEmojiMap>>): TimelineItem {
  let href: string | null = null;
  const title = row.target_title;
  if (row.catalog_id) href = `/catalogs/${row.catalog_id}`;
  else if (row.work_id) href = `/games/${row.work_id}`;
  else if (row.comment_id) {
    href = `${row.comment_work_id ? `/games/${row.comment_work_id}` : row.comment_creator_id ? `/creators/${row.comment_creator_id}` : `/characters/${row.comment_character_id}`}#sec-comments`;
  } else if (row.forum_post_id) href = `/discussions/${row.topic_id}/posts/${row.post_number}`;
  const sourceText = row.kind === "favorite" ? emojiText(row.favorite_note ?? "") : "";
  const body = row.kind === "status" ? timelineBody(row.body ?? "", emojis)
    : row.kind === "comment" ? timelineBody(mentionText(row.source_body ?? ""), emojis, 180)
    : row.kind === "catalog" && row.catalog_description ? [{ type: "text" as const, text: row.catalog_description }]
    : sourceText ? [{ type: "text" as const, text: sourceText.slice(0, 180) + (sourceText.length > 180 ? "…" : "") }] : [];
  const text = row.kind === "status" ? row.body ?? "" : body.map((segment) => segment.type === "text" ? segment.text : "[表情]").join("");
  return { id: row.id, kind: row.kind, action: row.action, createdAt: row.created_at, updatedAt: row.updated_at,
    actor: { id: row.user_id, displayName: row.display_name, avatarBlobSha256: row.avatar_blob_sha256 }, text,
    body, images: [], nameChange: row.kind === "rename" ? { previousName: row.previous_name!, newName: row.new_name! } : null,
    likeCount: row.like_count, replyCount: row.reply_count, likedByMe: row.liked_by_me === 1,
    canLike: row.kind === "status" && hasPermission(viewer, "timeline.status.like"),
    canReply: row.kind === "status" && hasPermission(viewer, "timeline.reply.create"),
    target: href && title ? { title, href } : null,
    work: row.preview_work_id && row.preview_work_title ? {
      id: row.preview_work_id, title: row.preview_work_title, originalTitle: row.preview_work_original_title ?? row.preview_work_title,
      coverBlobSha256: row.preview_work_cover, genre: row.preview_work_genre, engineFamily: row.preview_work_engine ?? "other",
    } : null,
    sourceReplyCount: row.source_reply_count,
    canDelete: row.kind !== "join" && row.kind !== "rename" && ((viewer?.id === row.user_id && hasPermission(viewer, row.kind === "status" ? "timeline.status.delete_own" : "timeline.event.delete_own")) ||
      hasPermission(viewer, row.kind === "status" ? "timeline.status.moderate_any" : "timeline.event.moderate_any")) };
}
export async function listTimeline(runtime: AppRuntime, input: {
  viewerId?: number | null; actorUserId?: number; eventId?: number; following?: boolean; cursor?: string | null; kind?: TimelineKind; limit?: number;
} = {}): Promise<TimelinePage> {
  if (input.actorUserId !== undefined && (!Number.isSafeInteger(input.actorUserId) || input.actorUserId < 1)) throw new HttpError(400, "用户编号无效");
  if (input.eventId !== undefined && (!Number.isSafeInteger(input.eventId) || input.eventId < 1)) throw new HttpError(400, "动态编号无效");
  if (input.kind !== undefined && !isTimelineKind(input.kind)) throw new HttpError(400, "动态类型无效");
  const limit = Number.isSafeInteger(input.limit) ? Math.min(50, Math.max(1, input.limit!)) : 30;
  const actor = input.actorUserId ?? null, kind = input.kind ?? null;
  const viewer = input.viewerId ? await getCurrentUser(runtime) : null;
  const verifiedViewer = viewer?.id === input.viewerId ? viewer : null;
  if (input.following && (!verifiedViewer || actor !== null)) throw new HttpError(verifiedViewer ? 400 : 401, "好友时间线需要登录，且不能指定其他用户");
  const followingUserId = input.following ? verifiedViewer!.id : null;
  const followingRevision = followingUserId === null ? null : (await getD1(runtime)
    .prepare("SELECT following_revision FROM users WHERE id=? AND status='active'").bind(followingUserId)
    .first<{ following_revision: number }>())?.following_revision;
  if (followingUserId !== null && followingRevision === undefined) throw new HttpError(401, "账户不可用");
  const cursor = input.cursor ? readCursor(input.cursor, actor, kind, followingUserId) : null;
  if (cursor && followingUserId !== null && cursor.followingRevision !== followingRevision) throw new HttpError(409, "好友关系已变化，请返回最新动态", "timeline_cursor_changed");
  const args: Bind[] = [];
  let filter = "";
  if (input.eventId !== undefined) { filter += " AND e.id=?"; args.push(input.eventId); }
  if (actor !== null) { filter += " AND e.user_id=?"; args.push(actor); }
  if (followingUserId !== null) {
    filter += " AND e.user_id IN (SELECT followed_user_id FROM user_follows WHERE follower_user_id=? UNION ALL SELECT ?)";
    args.push(followingUserId, followingUserId);
  }
  if (kind !== null) { filter += " AND e.kind=?"; args.push(kind); }
  if (cursor) { filter += " AND (e.created_at,e.id)<(?,?)"; args.push(cursor.at, cursor.id); }
  const result = await getD1(runtime).prepare(`SELECT ${COLUMNS},
    (SELECT COUNT(*) FROM timeline_status_likes l JOIN users lu ON lu.id=l.user_id WHERE l.event_id=e.id AND lu.status='active') AS like_count,
    (SELECT COUNT(*) FROM timeline_status_replies r JOIN users ru ON ru.id=r.user_id WHERE r.event_id=e.id AND r.hidden_at IS NULL AND ru.status='active') AS reply_count,
    EXISTS(SELECT 1 FROM timeline_status_likes l WHERE l.event_id=e.id AND l.user_id=?) AS liked_by_me ${FROM} ${filter} ORDER BY e.created_at DESC,e.id DESC LIMIT ?`)
    .bind(verifiedViewer?.id ?? 0, ...args, limit + 1).all<TimelineRow>();
  const rows = result.results.slice(0, limit), last = rows.at(-1);
  const emojis = await timelineEmojiMap(getD1(runtime), rows.flatMap((row) => row.kind === "status" ? [row.body] : row.kind === "comment" ? [row.source_body] : []));
  const statusImages = await timelineImagesById(getD1(runtime), "timeline_event_id", rows.filter((row) => row.kind === "status").map((row) => row.id));
  const commentImages = await commentImagesById(getD1(runtime), rows.flatMap((row) => row.kind === "comment" && row.comment_id ? [row.comment_id] : []));
  return { items: rows.map((row) => ({ ...mapItem(row, verifiedViewer, emojis), images: row.kind === "status" ? statusImages.get(row.id) ?? [] : row.kind === "comment" ? commentImages.get(row.comment_id!) ?? [] : [] })),
    nextCursor: result.results.length > limit && last ? btoa(JSON.stringify({ at: last.created_at, id: last.id, actor, kind, followingUserId, followingRevision })) : null };
}

export async function assertTimelinePermission(runtime: AppRuntime, userId: number, permissions: readonly PermissionKey[]) {
  const allowed = await getD1(runtime).prepare(`SELECT 1 FROM users WHERE id=? AND status='active' AND ${permissions.map((key) => userPermissionSql("users.id", key)).join(" AND ")}`)
    .bind(userId).first();
  if (!allowed) throw new HttpError(403, "没有执行此时间线操作的权限");
}

export async function createTimelineStatus(runtime: AppRuntime, userId: number, input: Record<string, unknown>) {
  await assertTimelinePermission(runtime, userId, ["timeline.use", "timeline.status.create"]);
  const body = statusBody(input);
  const ids = parseCommentImageIds(input.imageIds);
  if (typeof input.requestKey !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestKey)) throw new HttpError(400, "发布标识无效");
  const key = `status:${userId}:${input.requestKey}`;
  const hash = await sha256Hex(new TextEncoder().encode(ids.length ? JSON.stringify({ body, ids }) : body).buffer);
  const db = getD1(runtime);
  const previous = await db.prepare("SELECT id,request_hash FROM timeline_events WHERE event_key=? AND user_id=?").bind(key, userId).first<{ id: number; request_hash: string }>();
  if (previous) {
    if (previous.request_hash !== hash) throw new HttpError(409, "发布标识对应的内容已改变，请重新发布");
    return previous.id;
  }
  await validateBodyEmojis(db, body);
  const guard = timelineImageGuard(ids, userId);
  const source = "SELECT id FROM timeline_events WHERE event_key=? AND user_id=? AND request_hash=? AND hidden_at IS NULL";
  await db.batch([db.prepare(`INSERT INTO timeline_events(user_id,kind,action,event_key,body,request_hash)
    SELECT id,'status','发表了吐槽',?,?,? FROM users WHERE id=? AND status='active' AND timeline_enabled=1
    AND ${userPermissionSql("users.id", "timeline.use")} AND ${userPermissionSql("users.id", "timeline.status.create")}
    AND ${guard.sql}
    AND (SELECT COUNT(*) FROM timeline_events WHERE user_id=? AND kind='status' AND created_at>=datetime('now','-1 minute'))<5
    ON CONFLICT(event_key) DO NOTHING`).bind(key, body, hash, userId, ...guard.args, userId),
    ...contentEmojiStatements(db, "timelineStatus", "SELECT id FROM timeline_events WHERE event_key=? AND user_id=? AND body=? AND hidden_at IS NULL", [key, userId, body], body, userId, true),
    timelineImageStatement(db, "timeline_event_id", ids, userId, source, [key, userId, hash]),
  ]);
  const saved = await db.prepare("SELECT id,request_hash FROM timeline_events WHERE event_key=? AND user_id=?").bind(key, userId).first<{ id: number; request_hash: string }>();
  if (!saved) {
    await assertTimelinePermission(runtime, userId, ["timeline.use", "timeline.status.create"]);
    const settings = await readTimelineSettings(runtime, userId);
    if (!settings.enabled) throw new HttpError(409, "请先在时间线设置中开启时间线");
    if (!await db.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.args).first()) throw new HttpError(400, "配图不可用，请移除后重新上传");
    throw new HttpError(429, "发布过于频繁，请稍后再试");
  }
  if (saved.request_hash !== hash) throw new HttpError(409, "发布标识对应的内容已改变，请重新发布");
  return saved.id;
}
function moderatePermissionSql(userId: string, kind: string) {
  return `(CASE WHEN ${kind}='status' THEN ${userPermissionSql(userId, "timeline.status.moderate_any")}
    ELSE ${userPermissionSql(userId, "timeline.event.moderate_any")} END)`;
}
export async function deleteTimelineEvent(runtime: AppRuntime, eventId: number, userId: number) {
  const db = getD1(runtime);
  const [, result] = await db.batch([
    db.prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
      SELECT actor.id,actor.email,'timeline_moderation',json_object('eventId',e.id,'targetUserId',e.user_id,'action','remove')
      FROM users actor JOIN timeline_events e ON e.id=? WHERE actor.id=? AND actor.status='active'
        AND e.user_id<>actor.id AND e.hidden_at IS NULL AND e.kind NOT IN ('join','rename') AND ${moderatePermissionSql("actor.id", "e.kind")}`)
      .bind(eventId, userId),
    db.prepare(`UPDATE timeline_events SET hidden_at=COALESCE(hidden_at,CURRENT_TIMESTAMP),
      body=CASE WHEN kind='status' THEN NULL ELSE body END,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND kind NOT IN ('join','rename') AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=? AND actor.status='active'
        AND ((timeline_events.user_id=actor.id AND CASE WHEN kind='status' THEN ${userPermissionSql("actor.id", "timeline.status.delete_own")}
          ELSE ${userPermissionSql("actor.id", "timeline.event.delete_own")} END)
          OR ${moderatePermissionSql("actor.id", "timeline_events.kind")}))`).bind(eventId, userId),
    db.prepare("DELETE FROM timeline_event_face_emojis WHERE content_id=? AND EXISTS(SELECT 1 FROM timeline_events WHERE id=? AND hidden_at IS NOT NULL)").bind(eventId, eventId),
  ]);
  if (!result.meta.changes) throw new HttpError(404, "动态不存在或无权移除");
}
