import { getCurrentUser } from "@/app/.server/auth/current-user";
import { userPermissionSql } from "@/app/.server/auth/permission-sql";
import { sha256Hex } from "@/lib/sha256";
import { getD1 } from "./d1";
import { assertTimelinePermission } from "./timeline";
import { contentEmojiStatements, validateBodyEmojis } from "@/app/.server/emojis/service";
import type { AppRuntime } from "@/app/.server/runtime";
import { PUBLIC_STATUS, statusBody, timelineBody, timelineEmojiMap } from "@/app/.server/timeline/content";
import { hasPermission } from "@/lib/authz/permissions";
import type { TimelineReplyPage } from "@/lib/dto/db/timeline";
import { HttpError } from "@/lib/http";
import { parseCommentImageIds, timelineImageGuard, timelineImageStatement, timelineImagesById } from "@/app/.server/comments/images";

async function requirePublicStatus(db: D1Database, eventId: number) {
  if (!await db.prepare(PUBLIC_STATUS).bind(eventId).first()) throw new HttpError(404, "吐槽不存在或已隐藏");
}

export async function setTimelineLike(runtime: AppRuntime, eventId: number, userId: number, liked: boolean) {
  const db = getD1(runtime);
  await assertTimelinePermission(runtime, userId, ["timeline.status.like"]);
  if (liked) {
    await requirePublicStatus(db, eventId);
    await db.batch([
      db.prepare(`INSERT INTO timeline_status_likes(event_id,user_id)
      SELECT ?,id FROM users WHERE id=? AND status='active' AND ${userPermissionSql("users.id", "timeline.status.like")}
      AND EXISTS(${PUBLIC_STATUS}) ON CONFLICT(event_id,user_id) DO NOTHING`).bind(eventId, userId, eventId),
      // Immediately follow the relationship INSERT; unlike/re-like preserves the original event.
      db.prepare(`INSERT INTO inbox_items(type,sender_user_id,recipient_user_id,title,body,event_key,timeline_event_id)
        SELECT 'system_notice',?,e.user_id,'','','timeline:like:'||?||':'||e.id||':'||e.user_id,e.id
        FROM timeline_events e WHERE e.id=? AND e.user_id<>? AND EXISTS(${PUBLIC_STATUS})
        AND changes()=1 ON CONFLICT(event_key) DO NOTHING`).bind(userId, userId, eventId, userId, eventId),
    ]);
  } else {
    await db.prepare(`DELETE FROM timeline_status_likes WHERE event_id=? AND user_id=?
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND ${userPermissionSql("users.id", "timeline.status.like")})`)
      .bind(eventId, userId, userId).run();
  }
}

export async function listTimelineReplies(runtime: AppRuntime, eventId: number, cursor: string | null = null): Promise<TimelineReplyPage> {
  const db = getD1(runtime);
  await requirePublicStatus(db, eventId);
  const after = cursor === null ? 0 : Number(cursor);
  if (cursor !== null && (!/^[1-9]\d{0,15}$/.test(cursor) || !Number.isSafeInteger(after))) throw new HttpError(400, "回复分页位置无效");
  const viewer = await getCurrentUser(runtime);
  const rows = await db.prepare(`SELECT r.id,r.user_id,r.body,r.created_at,u.display_name,u.avatar_blob_sha256
    FROM timeline_status_replies r JOIN users u ON u.id=r.user_id
    WHERE r.event_id=? AND r.id>? AND r.hidden_at IS NULL AND u.status='active' AND EXISTS(${PUBLIC_STATUS})
    ORDER BY r.id LIMIT 31`).bind(eventId, after, eventId)
    .all<{ id: number; user_id: number; body: string; created_at: string; display_name: string; avatar_blob_sha256: string | null }>();
  const visible = rows.results.slice(0, 30), emojis = await timelineEmojiMap(db, visible.map((row) => row.body));
  const images = await timelineImagesById(db, "timeline_reply_id", visible.map((row) => row.id));
  return {
    items: visible.map((row) => ({ id: row.id, actor: { id: row.user_id, displayName: row.display_name, avatarBlobSha256: row.avatar_blob_sha256 },
      body: timelineBody(row.body, emojis), images: images.get(row.id) ?? [], createdAt: row.created_at,
      canDelete: (viewer?.id === row.user_id && hasPermission(viewer, "timeline.reply.delete_own")) || hasPermission(viewer, "timeline.reply.moderate_any") })),
    nextCursor: rows.results.length > 30 ? visible.at(-1)!.id : null,
  };
}

export async function createTimelineReply(runtime: AppRuntime, eventId: number, userId: number, input: Record<string, unknown>) {
  await assertTimelinePermission(runtime, userId, ["timeline.reply.create"]);
  const body = statusBody(input), db = getD1(runtime);
  const ids = parseCommentImageIds(input.imageIds);
  if (typeof input.requestKey !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestKey)) throw new HttpError(400, "回复发布标识无效");
  const key = input.requestKey, hash = await sha256Hex(new TextEncoder().encode(ids.length ? JSON.stringify({ body, ids }) : body).buffer);
  await requirePublicStatus(db, eventId);
  const previous = await db.prepare("SELECT id,request_hash FROM timeline_status_replies WHERE event_id=? AND user_id=? AND request_key=?")
    .bind(eventId, userId, key).first<{ id: number; request_hash: string }>();
  if (previous) {
    if (previous.request_hash !== hash) throw new HttpError(409, "回复发布标识对应的内容已改变");
    return previous.id;
  }
  await validateBodyEmojis(db, body);
  const guard = timelineImageGuard(ids, userId);
  const source = "SELECT id FROM timeline_status_replies WHERE event_id=? AND user_id=? AND request_key=? AND request_hash=? AND hidden_at IS NULL";
  await db.batch([
    db.prepare(`INSERT INTO timeline_status_replies(event_id,user_id,body,request_key,request_hash)
      SELECT ?,id,?,?,? FROM users WHERE id=? AND status='active' AND ${userPermissionSql("users.id", "timeline.reply.create")}
      AND ${guard.sql}
      AND EXISTS(${PUBLIC_STATUS})
      AND (SELECT COUNT(*) FROM timeline_status_replies WHERE user_id=? AND created_at>=datetime('now','-1 minute'))<10
      ON CONFLICT(event_id,user_id,request_key) DO NOTHING`).bind(eventId, body, key, hash, userId, ...guard.args, eventId, userId),
    db.prepare(`INSERT INTO inbox_items(type,sender_user_id,recipient_user_id,title,body,event_key,timeline_event_id,timeline_reply_id)
      SELECT 'system_notice',r.user_id,e.user_id,'','','timeline:reply:'||r.id||':'||e.user_id,e.id,r.id
      FROM timeline_status_replies r JOIN timeline_events e ON e.id=r.event_id
      WHERE r.event_id=? AND r.user_id=? AND r.request_key=? AND r.request_hash=?
        AND r.hidden_at IS NULL AND r.user_id<>e.user_id AND EXISTS(${PUBLIC_STATUS})
        AND changes()=1 ON CONFLICT(event_key) DO NOTHING`).bind(eventId, userId, key, hash, eventId),
    ...contentEmojiStatements(db, "timelineReply",
      "SELECT id FROM timeline_status_replies WHERE event_id=? AND user_id=? AND request_key=? AND body=? AND hidden_at IS NULL",
      [eventId, userId, key, body], body, userId, true),
    timelineImageStatement(db, "timeline_reply_id", ids, userId, source, [eventId, userId, key, hash]),
  ]);
  const saved = await db.prepare("SELECT id,request_hash FROM timeline_status_replies WHERE event_id=? AND user_id=? AND request_key=?")
    .bind(eventId, userId, key).first<{ id: number; request_hash: string }>();
  if (!saved) {
    await assertTimelinePermission(runtime, userId, ["timeline.reply.create"]);
    await requirePublicStatus(db, eventId);
    if (!await db.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.args).first()) throw new HttpError(400, "配图不可用，请移除后重新上传");
    throw new HttpError(429, "回复过于频繁，请稍后再试");
  }
  if (saved.request_hash !== hash) throw new HttpError(409, "回复发布标识对应的内容已改变");
  return saved.id;
}

export async function deleteTimelineReply(runtime: AppRuntime, replyId: number, userId: number) {
  const db = getD1(runtime);
  const [, result] = await db.batch([
    db.prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
      SELECT actor.id,actor.email,'timeline_reply_moderation',json_object('replyId',r.id,'eventId',r.event_id,'targetUserId',r.user_id,'action','remove')
      FROM users actor JOIN timeline_status_replies r ON r.id=? WHERE actor.id=? AND actor.status='active'
      AND r.user_id<>actor.id AND r.hidden_at IS NULL AND ${userPermissionSql("actor.id", "timeline.reply.moderate_any")}`).bind(replyId, userId),
    db.prepare(`UPDATE timeline_status_replies SET hidden_at=COALESCE(hidden_at,CURRENT_TIMESTAMP),body=NULL WHERE id=?
      AND EXISTS(SELECT 1 FROM users actor WHERE actor.id=? AND actor.status='active' AND
        ((timeline_status_replies.user_id=actor.id AND ${userPermissionSql("actor.id", "timeline.reply.delete_own")})
         OR ${userPermissionSql("actor.id", "timeline.reply.moderate_any")}))`).bind(replyId, userId),
    db.prepare("DELETE FROM timeline_reply_face_emojis WHERE content_id=? AND EXISTS(SELECT 1 FROM timeline_status_replies WHERE id=? AND hidden_at IS NOT NULL)").bind(replyId, replyId),
  ]);
  if (!result.meta.changes) throw new HttpError(404, "回复不存在或无权删除");
}
