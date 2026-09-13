import { requireUser } from "@/lib/server/auth/guards";
import { getD1 } from "@/lib/server/db/d1";
import { HttpError, jsonError } from "@/lib/server/http/json";
import { FORUM_IMAGE_BYTES, type ForumImage } from "@/lib/forum";
import {
  inspectForumImage,
  ForumImageValidationError,
} from "@/lib/forum-image-format";
import { storedImageColumns, writeForumImage, type StoredForumImage } from "@/lib/server/forum/image-storage";
import { rawContent, rawTopic } from "@/lib/server/forum/queries";
import { forumActorSql, forumTarget } from "@/lib/server/forum/mutations";
import { sha256Hex } from "@/lib/server/crypto/sha256";
export const dynamic = "force-dynamic";

async function boundedForm(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    throw new HttpError(400, "请选择图片文件。");
  const max = FORUM_IMAGE_BYTES + 16384,
    reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "图片请求为空。");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel();
        throw new HttpError(413, "图片请求过大。");
      }
      chunks.push(value);
    }
    return await new Response(new Blob(chunks), {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "图片请求无效。");
  }
}
export async function POST(request: Request) {
  try {
    const auth = await requireUser(request);
    if ("response" in auth) return auth.response;
    const form = await boundedForm(request),
      file = form.get("image"),
      clientId = form.get("clientId");
    if (
      !(file instanceof File) ||
      typeof clientId !== "string" ||
      !/^[a-zA-Z0-9-]{16,100}$/.test(clientId)
    )
      throw new HttpError(400, "图片或上传标识无效。");
    const mode = form.get("mode");
    if (mode !== "topic" && mode !== "post")
      throw new HttpError(400, "此发布器不支持图片。");
    let capabilitySql = "1",
      capabilityArgs: number[] = [];
    if (form.has("targetId")) {
      const target = forumTarget({
          kind: mode,
          id: Number(form.get("targetId")),
        }),
        row = await rawContent(target),
        topic = await rawTopic(row.topic_id);
      if (!row.public || row.user_id !== auth.user.id || topic.locked)
        throw new HttpError(403, "当前内容不能编辑。");
      capabilitySql =
        "EXISTS(SELECT 1 FROM forum_public_posts p JOIN forum_topics t ON t.id=p.topic_id WHERE p.id=? AND p.user_id=? AND t.locked=0)";
      capabilityArgs = [row.id, auth.user.id];
    } else if (mode === "post") {
      const topicId = Number(form.get("topicId"));
      if (!Number.isSafeInteger(topicId) || topicId < 1)
        throw new HttpError(400, "主题无效。");
      capabilitySql =
        "EXISTS(SELECT 1 FROM forum_public_topics WHERE id=? AND locked=0)";
      capabilityArgs = [topicId];
    }
    const buffer = await file.arrayBuffer(),
      meta = inspectForumImage(buffer);
    if (file.type && file.type !== `image/${meta.format}`)
      throw new HttpError(400, "文件类型与图片内容不一致。");
    const fingerprint = await sha256Hex(buffer),
      db = getD1();
    // Recheck target capability even when returning an earlier successful upload.
    const allowed = await db.prepare(`SELECT 1 AS ok WHERE ${forumActorSql()} AND ${capabilitySql}`)
      .bind(auth.user.id, ...capabilityArgs).first();
    if (!allowed) throw new HttpError(403, "当前不能上传或编辑图片。");
    const existing = await db.prepare(`SELECT ${storedImageColumns} FROM forum_images WHERE user_id=? AND client_id=?`)
      .bind(auth.user.id, clientId).first<StoredForumImage>();
    const respond = (image: ForumImage) =>
      Response.json(
        {
          ok: true,
          image: {
            id: image.id,
            url: image.url,
            thumb: image.thumb,
            width: image.width,
            height: image.height,
            size: image.size,
            format: image.format,
            offset: image.offset,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new HttpError(409, "上传标识对应的图片已变化。");
      if (existing.status === "ready") return respond(existing);
      if (existing.status === "cleanup" || existing.status === "cleaned")
        throw new HttpError(409, "此图片已进入清理，请重新选择。");
    }
    const id = existing?.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const gate = `${forumActorSql()} AND ${capabilitySql} AND
      (SELECT COUNT(*) FROM forum_images WHERE user_id=? AND datetime(updated_at)>=datetime('now','-1 minute'))<12`;
    const args = [auth.user.id, ...capabilityArgs, auth.user.id];
    const claimed = existing
      ? await db.prepare(`UPDATE forum_images SET status='uploading',updated_at=?
          WHERE id=? AND status IN('failed','uploading','uncertain') AND updated_at=?
          AND datetime(updated_at)<=datetime('now','-1 minute') AND ${gate}
          RETURNING ${storedImageColumns}`)
        .bind(stamp, id, existing.updated_at, ...args).first<StoredForumImage>()
      : await db.prepare(`INSERT INTO forum_images(id,user_id,client_id,fingerprint,status,object_key,format,size,width,height,updated_at)
          SELECT ?,?,?,?,'uploading',?,?,?,?,?,? WHERE ${gate}
          ON CONFLICT(user_id,client_id) DO NOTHING RETURNING ${storedImageColumns}`)
        .bind(id, auth.user.id, clientId, fingerprint, `forum-images/${id}`, meta.format,
          meta.size, meta.width, meta.height, stamp, ...args).first<StoredForumImage>();
    if (!claimed) throw new HttpError(429, "上传过于频繁或仍在处理中，请一分钟后重试。", "forum_image_rate_limit");
    return respond(await writeForumImage(claimed, buffer));
  } catch (e) {
    return jsonError(
      "图片上传失败。",
      e instanceof ForumImageValidationError
        ? new HttpError(e.status, e.message)
        : e,
    );
  }
}
