import { translate } from "@/lib/i18n/core";
import type { UiLocale } from "@/lib/i18n/locale";
import { json as jsonResponse, HttpError, jsonError } from "@/lib/http";
import { sha256Hex } from "@/lib/sha256";
import { type StoredForumImage, storedImageColumns, writeForumImage } from "@/app/.server/forum/image-storage";

import { forumActorSql, forumTarget } from "@/app/.server/forum/mutations";
import { contentIdentity, rawTopic } from "@/app/.server/forum/queries";
import { type ForumImage, FORUM_IMAGE_BYTES } from "@/lib/forum";

import {
  ForumImageValidationError,
  inspectForumImage,
} from "@/lib/forum-image-format";

import { type ForumRequestRuntime, readForumBody, requireForumUser } from "./request";


async function boundedForm(request: Request, locale: UiLocale) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    throw new HttpError(400, translate(locale, "image.choose"));
  try {
    return await new Response(
      await readForumBody(request, FORUM_IMAGE_BYTES + 16384),
      {
        headers: { "Content-Type": request.headers.get("content-type")! },
      },
    ).formData();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, translate(locale, "forum.image.invalid"));
  }
}
export async function POST(ctx: ForumRequestRuntime, request: Request, locale: UiLocale) {
  try {
    const auth = await requireForumUser(ctx, request, undefined, locale);
    const recent = await ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM forum_images WHERE user_id=? AND datetime(updated_at)>=datetime('now','-1 minute')`,
      )
      .bind(auth.user.id)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= 12)
      throw new HttpError(
        429,
        translate(locale, "forum.image.rate"),
        "forum_image_rate_limit",
      );
    const form = await boundedForm(request, locale),
      file = form.get("image"),
      clientId = form.get("clientId");
    if (
      !(file instanceof File) ||
      typeof clientId !== "string" ||
      !/^[a-zA-Z0-9-]{16,100}$/.test(clientId)
    )
      throw new HttpError(400, translate(locale, "forum.image.uploadId"));
    if (file.size > FORUM_IMAGE_BYTES)
      throw new HttpError(413, translate(locale, "image.size"));
    const mode = form.get("mode");
    if (mode !== "topic" && mode !== "post")
      throw new HttpError(400, translate(locale, "forum.image.unsupportedMode"));
    let capabilitySql = "1",
      capabilityArgs: number[] = [];
    if (form.has("targetId")) {
      const target = forumTarget({
          kind: mode,
          id: Number(form.get("targetId")),
        }, locale),
        row = await contentIdentity(ctx, target),
        topic = await rawTopic(ctx, row.topic_id);
      if (!row.public || row.user_id !== auth.user.id || topic.locked)
        throw new HttpError(403, translate(locale, "forum.image.cannotEdit"));
      capabilitySql =
        "EXISTS(SELECT 1 FROM forum_public_posts p JOIN forum_topics t ON t.id=p.topic_id WHERE p.id=? AND p.user_id=? AND t.locked=0)";
      capabilityArgs = [row.id, auth.user.id];
    } else if (mode === "post") {
      const topicId = Number(form.get("topicId"));
      if (!Number.isSafeInteger(topicId) || topicId < 1)
        throw new HttpError(400, translate(locale, "forum.image.invalidTopic"));
      capabilitySql =
        "EXISTS(SELECT 1 FROM forum_public_topics WHERE id=? AND locked=0)";
      capabilityArgs = [topicId];
    }
    const buffer = await file.arrayBuffer(),
      meta = inspectForumImage(buffer, FORUM_IMAGE_BYTES, locale);
    if (file.type && file.type !== `image/${meta.format}`)
      throw new HttpError(400, translate(locale, "forum.image.typeMismatch"));
    const fingerprint = await sha256Hex(buffer),
      db = ctx.db;
    // Recheck target capability even when returning an earlier successful upload.
    const allowed = await db
      .prepare(`SELECT 1 AS ok WHERE ${forumActorSql()} AND ${capabilitySql}`)
      .bind(auth.user.id, ...capabilityArgs)
      .first();
    if (!allowed) throw new HttpError(403, translate(locale, "forum.image.cannotUpload"));
    const existing = await db
      .prepare(
        `SELECT ${storedImageColumns} FROM forum_images WHERE user_id=? AND client_id=?`,
      )
      .bind(auth.user.id, clientId)
      .first<StoredForumImage>();
    const respond = (image: ForumImage) =>
      jsonResponse(
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
        throw new HttpError(409, translate(locale, "forum.image.changed"));
      if (existing.status === "ready") return respond(existing);
      if (existing.status === "cleanup" || existing.status === "cleaned")
        throw new HttpError(409, translate(locale, "forum.image.cleaning"));
    }
    const id = existing?.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const gate = `${forumActorSql()} AND ${capabilitySql} AND
      (SELECT COUNT(*) FROM forum_images WHERE user_id=? AND datetime(updated_at)>=datetime('now','-1 minute'))<12`;
    const args = [auth.user.id, ...capabilityArgs, auth.user.id];
    const claimed = existing
      ? await db
          .prepare(
            `UPDATE forum_images SET status='uploading',updated_at=?
          WHERE id=? AND status IN('failed','uploading','uncertain') AND updated_at=?
          AND datetime(updated_at)<=datetime('now','-1 minute') AND ${gate}
          RETURNING ${storedImageColumns}`,
          )
          .bind(stamp, id, existing.updated_at, ...args)
          .first<StoredForumImage>()
      : await db
          .prepare(
            `INSERT INTO forum_images(id,user_id,client_id,fingerprint,status,object_key,format,size,width,height,updated_at)
          SELECT ?,?,?,?,'uploading',?,?,?,?,?,? WHERE ${gate}
          ON CONFLICT(user_id,client_id) DO NOTHING RETURNING ${storedImageColumns}`,
          )
          .bind(
            id,
            auth.user.id,
            clientId,
            fingerprint,
            `forum-images/${id}`,
            meta.format,
            meta.size,
            meta.width,
            meta.height,
            stamp,
            ...args,
          )
          .first<StoredForumImage>();
    if (!claimed)
      throw new HttpError(
        429,
        translate(locale, "forum.image.retryMinute"),
        "forum_image_rate_limit",
      );
    return respond(await writeForumImage(ctx, claimed, buffer, locale));
  } catch (e) {
    return jsonError(
      translate(locale, "image.uploadFailed"),
      e instanceof ForumImageValidationError
        ? new HttpError(e.status, e.message)
        : e,
    );
  }
}
