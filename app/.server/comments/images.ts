import { getCurrentUser } from "@/app/.server/auth/current-user";
import { requireUser } from "@/app/.server/auth/guards";
import { sha256Hex } from "@/app/.server/crypto/sha256";
import { assertPublicCommentTarget } from "@/app/.server/db/work-community";
import { readForumBody } from "@/app/.server/forum/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { putImmutableImage } from "@/app/.server/storage/immutable-image";
import { hasPermission } from "@/lib/authz/permissions";
import { COMMENT_IMAGE_BYTES, COMMENT_IMAGE_COUNT, type CommentImage } from "@/lib/comment-images";
import { inspectImage, ImageValidationError } from "@/lib/image-format";
import { HttpError, json, jsonError } from "@/lib/http";

const columns = "id,('/api/comments/images/' || id) AS url,width,height,size,format";
type StoredImage = CommentImage & {
  user_id: number; object_key: string; fingerprint: string;
  status: "uploading" | "ready" | "uncertain" | "cleanup" | "cleaned";
  updated_at: string; comment_id: number | null;
};
const storedColumns = `${columns},user_id,object_key,fingerprint,status,updated_at,comment_id`;
const pending = () => new HttpError(409, "图片上传尚待确认，请一分钟后重试，已上传图片会被保留。");

export function parseCommentImageIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > COMMENT_IMAGE_COUNT ||
      value.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(id)) ||
      new Set(value).size !== value.length)
    throw new HttpError(400, "图片列表无效，最多上传 10 张图片。");
  return value;
}

export function commentImageGuard(ids: string[], userId: number, commentId = 0) {
  return {
    sql: `(SELECT COUNT(*) FROM comment_images WHERE id IN(SELECT value FROM json_each(?)) AND user_id=? AND status='ready' AND (comment_id IS NULL OR comment_id=?))=?`,
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
        AND comment_id IS NULL AND EXISTS(${source})`)
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

export async function uploadCommentImage(runtime: AppRuntime, request: Request) {
  try {
    const auth = await requireUser(runtime, request);
    if ("response" in auth) return auth.response;
    const contentType = request.headers.get("content-type");
    if (!contentType?.startsWith("multipart/form-data;")) throw new HttpError(400, "请选择图片文件。");
    const bytes = await readForumBody(request, COMMENT_IMAGE_BYTES + 16384);
    let form: FormData;
    try { form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
    catch { throw new HttpError(400, "图片请求无效。"); }
    const file = form.get("image"), clientId = form.get("clientId");
    const kind = form.get("targetKind"), id = Number(form.get("targetId"));
    if ((kind !== "work" && kind !== "creator" && kind !== "character") || !Number.isSafeInteger(id) || id <= 0)
      throw new HttpError(400, "评论目标无效。");
    await assertPublicCommentTarget(runtime, { kind, id });
    if (!(file instanceof File) || typeof clientId !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(clientId))
      throw new HttpError(400, "图片或上传标识无效。");
    const buffer = await file.arrayBuffer();
    const meta = inspectImage(buffer, COMMENT_IMAGE_BYTES);
    if (meta.format === "bmp") throw new HttpError(400, "评论图片仅支持 PNG、JPEG、WebP 或 GIF。");
    if (file.type && file.type !== `image/${meta.format}`) throw new HttpError(400, "文件类型与图片内容不一致。");
    const fingerprint = await sha256Hex(buffer), db = runtime.db;
    const existing = await db.prepare(`SELECT ${storedColumns} FROM comment_images WHERE user_id=? AND client_id=?`)
      .bind(auth.user.id, clientId).first<StoredImage>();
    const respond = (image: CommentImage) => json({ ok: true, image: {
      id: image.id, url: image.url, width: image.width, height: image.height, size: image.size, format: image.format,
    } });
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new HttpError(409, "上传标识对应的图片已变化。");
      if (existing.status === "ready") return respond(existing);
      if (existing.status === "cleanup" || existing.status === "cleaned") throw new HttpError(409, "图片已过期，请移除后重新选择。");
    }
    const imageId = existing?.id ?? crypto.randomUUID(), stamp = new Date().toISOString();
    const gate = `EXISTS(SELECT 1 FROM users WHERE id=? AND status='active') AND
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
    if (!row) throw new HttpError(429, "上传过于频繁或仍在处理中，请一分钟后重试。");
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
    return jsonError("评论图片上传失败。", error instanceof ImageValidationError ? new HttpError(error.status, error.message) : error);
  }
}

export async function readCommentImage(runtime: AppRuntime, id: string) {
  try {
    const row = await runtime.db.prepare(`SELECT ${storedColumns},
      EXISTS(SELECT 1 FROM public_comments c WHERE c.id=comment_images.comment_id) AS public
      FROM comment_images WHERE id=? AND status='ready'`).bind(id).first<StoredImage & { public: number }>();
    if (!row) throw new HttpError(404, "图片不可用。");
    if (!row.public) {
      const user = await getCurrentUser(runtime);
      if (!user || !(hasPermission(user, "comment.manage_any") || (row.comment_id === null && row.user_id === user.id)))
        throw new HttpError(404, "图片不可用。");
    }
    const object = await runtime.bucket.get(row.object_key);
    if (!object) throw new HttpError(404, "图片不可用。");
    return new Response(object.body, { headers: {
      "Content-Type": `image/${row.format}`, "Content-Length": String(object.size), "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    } });
  } catch (error) { return jsonError("评论图片读取失败。", error); }
}
