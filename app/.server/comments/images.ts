import { getCurrentUser } from "@/app/.server/auth/current-user";
import { requireUser } from "@/app/.server/auth/guards";
import { sha256Hex } from "@/lib/sha256";
import { assertReadableCommentTarget } from "@/app/.server/db/work-community";
import { commentTargetReadCondition } from "@/app/.server/db/comment-visibility";
import { readForumBody } from "@/app/.server/forum/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { putImmutableImage } from "@/app/.server/storage/immutable-image";
import { hasPermission } from "@/lib/authz/permissions";
import { COMMENT_IMAGE_BYTES, COMMENT_IMAGE_COUNT, type CommentImage } from "@/lib/comment-images";
import { inspectImage, ImageValidationError } from "@/lib/image-format";
import { HttpError, json, jsonError } from "@/lib/http";
import { UiHttpError } from "@/lib/i18n/feedback";
import { userPermissionSql } from "@/app/.server/auth/permission-sql";
import { PUBLIC_STATUS } from "@/app/.server/timeline/content";

const columns = "id,('/api/comments/images/' || id) AS url,width,height,size,format";
type StoredImage = CommentImage & {
  user_id: number; object_key: string; fingerprint: string;
  status: "uploading" | "ready" | "uncertain" | "cleanup" | "cleaned";
  updated_at: string; comment_id: number | null; timeline_event_id: number | null; timeline_reply_id: number | null;
};
const storedColumns = `${columns},user_id,object_key,fingerprint,status,updated_at,comment_id,timeline_event_id,timeline_reply_id`;
const pending = () => new UiHttpError(409, "image.error.pendingConfirmation");

export function parseCommentImageIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > COMMENT_IMAGE_COUNT ||
      value.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(id)) ||
      new Set(value).size !== value.length)
    throw new UiHttpError(400, "image.error.invalidList");
  return value;
}

export function commentImageGuard(ids: string[], userId: number, commentId = 0) {
  return {
    sql: `(SELECT COUNT(*) FROM comment_images WHERE id IN(SELECT value FROM json_each(?)) AND user_id=? AND status='ready' AND timeline_event_id IS NULL AND timeline_reply_id IS NULL AND (comment_id IS NULL OR comment_id=?))=?`,
    args: [JSON.stringify(ids), userId, commentId, ids.length],
  };
}

export function commentImageStatements(db: D1Database, ids: string[], userId: number, source: string, args: (number | string)[]) {
  return [
    db.prepare(`UPDATE comment_images SET comment_id=NULL,position=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE comment_id IN(${source})`).bind(...args),
    db.prepare(`UPDATE comment_images SET comment_id=(${source}),
      position=(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=comment_images.id),updated_at=CURRENT_TIMESTAMP
      WHERE id IN(SELECT value FROM json_each(?)) AND user_id=? AND status='ready'
        AND comment_id IS NULL AND timeline_event_id IS NULL AND timeline_reply_id IS NULL AND EXISTS(${source})`)
      .bind(...args, JSON.stringify(ids), JSON.stringify(ids), userId, ...args),
  ];
}

export async function commentImagesById(db: D1Database, ids: number[]) {
  const map = new Map<number, CommentImage[]>();
  if (!ids.length) return map;
  const rows = await db.prepare(`SELECT ${columns},comment_id FROM comment_images
    WHERE comment_id IN(SELECT value FROM json_each(?)) AND status='ready' ORDER BY comment_id,position`)
    .bind(JSON.stringify(ids)).all<CommentImage & { comment_id: number }>();
  for (const { comment_id, ...image } of rows.results) {
    const items = map.get(comment_id) ?? [];
    items.push(image);
    map.set(comment_id, items);
  }
  return map;
}

export function timelineImageGuard(ids: string[], userId: number) {
  return {
    sql: `(SELECT COUNT(*) FROM comment_images WHERE id IN(SELECT value FROM json_each(?)) AND user_id=? AND status='ready' AND comment_id IS NULL AND timeline_event_id IS NULL AND timeline_reply_id IS NULL)=?`,
    args: [JSON.stringify(ids), userId, ids.length],
  };
}

export function timelineImageStatement(db: D1Database, field: "timeline_event_id" | "timeline_reply_id", ids: string[], userId: number, source: string, args: (number | string)[]) {
  return db.prepare(`UPDATE comment_images SET ${field}=(${source}),
    position=(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=comment_images.id),updated_at=CURRENT_TIMESTAMP
    WHERE id IN(SELECT value FROM json_each(?)) AND user_id=? AND status='ready'
      AND comment_id IS NULL AND timeline_event_id IS NULL AND timeline_reply_id IS NULL AND EXISTS(${source})`)
    .bind(...args, JSON.stringify(ids), JSON.stringify(ids), userId, ...args);
}

export async function timelineImagesById(db: D1Database, field: "timeline_event_id" | "timeline_reply_id", ids: number[]) {
  const map = new Map<number, CommentImage[]>();
  if (!ids.length) return map;
  const rows = await db.prepare(`SELECT ${columns},${field} AS content_id FROM comment_images
    WHERE ${field} IN(SELECT value FROM json_each(?)) AND status='ready' ORDER BY ${field},position`)
    .bind(JSON.stringify(ids)).all<CommentImage & { content_id: number }>();
  for (const { content_id, ...image } of rows.results) {
    const images = map.get(content_id) ?? [];
    images.push(image);
    map.set(content_id, images);
  }
  return map;
}

export async function uploadCommentImage(runtime: AppRuntime, request: Request) {
  try {
    const auth = await requireUser(runtime, request);
    if ("response" in auth) return auth.response;
    const contentType = request.headers.get("content-type");
    if (!contentType?.startsWith("multipart/form-data;")) throw new UiHttpError(400, "image.error.chooseFile");
    const bytes = await readForumBody(request, COMMENT_IMAGE_BYTES + 16384);
    let form: FormData;
    try { form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
    catch { throw new UiHttpError(400, "forum.image.invalid"); }
    const file = form.get("image"), clientId = form.get("clientId");
    const kind = form.get("targetKind"), id = Number(form.get("targetId"));
    let permissionGate = "1";
    if (kind === "timelineStatus" || kind === "timelineReply") {
      permissionGate = kind === "timelineStatus"
        ? `timeline_enabled=1 AND ${userPermissionSql("users.id", "timeline.use")} AND ${userPermissionSql("users.id", "timeline.status.create")}`
        : userPermissionSql("users.id", "timeline.reply.create");
      if (!await runtime.db.prepare(`SELECT id FROM users WHERE id=? AND status='active' AND ${permissionGate}`).bind(auth.user.id).first())
        throw new UiHttpError(403, "image.error.timelineForbidden");
      if (kind === "timelineReply" && (!Number.isSafeInteger(id) || id <= 0 || !await runtime.db.prepare(PUBLIC_STATUS).bind(id).first()))
        throw new UiHttpError(404, "image.error.timelineUnavailable");
      if (kind === "timelineReply") permissionGate += ` AND EXISTS(${PUBLIC_STATUS.replace("e.id=?", `e.id=${id}`)})`;
    } else {
      if ((kind !== "work" && kind !== "creator" && kind !== "character" && kind !== "catalog") || !Number.isSafeInteger(id) || id <= 0)
        throw new UiHttpError(400, "image.error.invalidTarget");
      await assertReadableCommentTarget(runtime, { kind, id });
    }
    if (!(file instanceof File) || typeof clientId !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(clientId))
      throw new UiHttpError(400, "forum.image.uploadId");
    const buffer = await file.arrayBuffer();
    const meta = inspectImage(buffer, COMMENT_IMAGE_BYTES);
    if (meta.format === "bmp") throw new UiHttpError(400, "image.error.format");
    if (file.type && file.type !== `image/${meta.format}`) throw new UiHttpError(400, "forum.image.typeMismatch");
    const fingerprint = await sha256Hex(buffer), db = runtime.db;
    const existing = await db.prepare(`SELECT ${storedColumns} FROM comment_images WHERE user_id=? AND client_id=?`)
      .bind(auth.user.id, clientId).first<StoredImage>();
    const respond = (image: CommentImage) => json({ ok: true, image: {
      id: image.id, url: image.url, width: image.width, height: image.height, size: image.size, format: image.format,
    } });
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new UiHttpError(409, "forum.image.changed");
      if (existing.status === "ready") return respond(existing);
      if (existing.status === "cleanup" || existing.status === "cleaned") throw new UiHttpError(409, "image.error.expired");
    }
    const imageId = existing?.id ?? crypto.randomUUID(), stamp = new Date().toISOString();
    const gate = `EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND ${permissionGate}) AND
      (SELECT COUNT(*) FROM comment_images WHERE user_id=? AND datetime(updated_at)>=datetime('now','-1 minute'))<12`;
    const row = existing
      ? await db.prepare(`UPDATE comment_images SET status='uploading',updated_at=? WHERE id=?
          AND status IN('uploading','uncertain') AND updated_at=? AND datetime(updated_at)<=datetime('now','-1 minute')
          AND ${gate} RETURNING ${storedColumns}`)
          .bind(stamp, imageId, existing.updated_at, auth.user.id, auth.user.id).first<StoredImage>()
      : await db.prepare(`INSERT INTO comment_images(id,user_id,client_id,fingerprint,status,object_key,format,size,width,height,updated_at)
          SELECT ?,?,?,?,'uploading',?,?,?,?,?,? WHERE ${gate} ON CONFLICT(user_id,client_id) DO NOTHING RETURNING ${storedColumns}`)
          .bind(imageId, auth.user.id, clientId, fingerprint, `comment-images/${imageId}`, meta.format, meta.size, meta.width, meta.height, stamp,
            auth.user.id, auth.user.id).first<StoredImage>();
    if (!row) throw new UiHttpError(429, "image.error.busy");
    try {
      await putImmutableImage(runtime.bucket, row, buffer);
      const ready = await db.prepare(`UPDATE comment_images SET status='ready',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='uploading' AND updated_at=? RETURNING ${columns}`).bind(imageId, stamp).first<CommentImage>();
      if (!ready) {
        const state = await db.prepare("SELECT status FROM comment_images WHERE id=?").bind(imageId).first<{ status: string }>();
        if (state?.status === "cleanup" || state?.status === "cleaned") await runtime.bucket.delete(row.object_key);
        throw pending();
      }
      return respond(ready);
    } catch (error) {
      await db.prepare("UPDATE comment_images SET status='uncertain',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='uploading' AND updated_at=?")
        .bind(imageId, stamp).run();
      if (error instanceof HttpError) throw error;
      throw pending();
    }
  } catch (error) {
    return jsonError(
      "评论图片上传失败。",
      error instanceof ImageValidationError
        ? new HttpError(error.status, error.message, undefined, error.status === 413 ? "image.size" : "forum.image.invalidFormat")
        : error,
    );
  }
}

export async function readCommentImage(runtime: AppRuntime, id: string) {
  try {
    const row = await runtime.db.prepare(`SELECT ${storedColumns},
      (EXISTS(SELECT 1 FROM public_comments c WHERE c.id=comment_images.comment_id)
       OR EXISTS(SELECT 1 FROM timeline_events e JOIN users u ON u.id=e.user_id
         WHERE e.id=comment_images.timeline_event_id AND e.kind='status' AND e.hidden_at IS NULL AND u.status='active')
       OR EXISTS(SELECT 1 FROM timeline_status_replies r JOIN users ru ON ru.id=r.user_id
         JOIN timeline_events e ON e.id=r.event_id JOIN users u ON u.id=e.user_id
         WHERE r.id=comment_images.timeline_reply_id AND r.hidden_at IS NULL AND ru.status='active'
           AND e.kind='status' AND e.hidden_at IS NULL AND u.status='active')) AS public
      FROM comment_images WHERE id=? AND status='ready'`).bind(id).first<StoredImage & { public: number }>();
    if (!row) throw new UiHttpError(404, "image.error.unavailable");
    if (!row.public) {
      const user = await getCurrentUser(runtime);
      const draft = row.comment_id === null && row.timeline_event_id === null && row.timeline_reply_id === null;
      const canManage = row.timeline_event_id === null && row.timeline_reply_id === null && hasPermission(user, "comment.manage_any");
      const access = commentTargetReadCondition(user);
      const canRead = user && row.comment_id !== null && await runtime.db.prepare(
        `SELECT c.id FROM published_comments c WHERE c.id=? AND ${access.sql}`,
      ).bind(row.comment_id, ...access.binds).first();
      if (!user || !(canRead || canManage || (draft && row.user_id === user.id)))
        throw new UiHttpError(404, "image.error.unavailable");
    }
    const object = await runtime.bucket.get(row.object_key);
    if (!object) throw new UiHttpError(404, "image.error.unavailable");
    return new Response(object.body, { headers: {
      "Content-Type": `image/${row.format}`, "Content-Length": String(object.size), "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    } });
  } catch (error) { return jsonError("评论图片读取失败。", error); }
}
