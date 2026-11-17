import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locale";
import { putImmutableImage } from "@/app/.server/storage/immutable-image";
import type { ForumImage } from "@/lib/forum";
import type { ForumRuntime } from "./runtime";

import { HttpError } from "@/lib/http";

import { imageColumns } from "./images";

export type StoredForumImage = ForumImage & {
  user_id: number;
  client_id: string;
  object_key: string;
  fingerprint: string;
  status:
    | "uploading"
    | "ready"
    | "failed"
    | "uncertain"
    | "cleanup"
    | "cleaned";
  updated_at: string;
};
export const storedImageColumns = `${imageColumns},user_id,client_id,object_key,fingerprint,status,updated_at`;

// Account suspension alone must never make a published post's image disposable.
// Both the queue and the atomic cleanup claim use the forum_images alias i.
export const forumImageCleanupSql = `(i.post_id IS NULL OR EXISTS(
  SELECT 1 FROM forum_posts post JOIN forum_topics topic ON topic.id=post.topic_id
  WHERE post.id=i.post_id AND (post.status IN('hidden','deleted') OR topic.status IN('hidden','deleted'))
))`;

export function imageUploadPending(locale: UiLocale = DEFAULT_UI_LOCALE) {
  return new HttpError(
    409,
    translate(locale, "forum.image.pending"),
    "forum_image_pending",
  );
}

function verifyObject(row: StoredForumImage, object: R2Object, locale: UiLocale) {
  if (
    object.key !== row.object_key ||
    object.size !== row.size ||
    object.customMetadata?.sha256 !== row.fingerprint ||
    object.httpMetadata?.contentType !== `image/${row.format}`
  )
    throw new HttpError(409, translate(locale, "forum.image.storageMismatch"));
}

async function finishUpload(
  ctx: ForumRuntime,
  row: StoredForumImage,
  locale: UiLocale,
): Promise<ForumImage> {
  const db = ctx.db;
  const ready = await db
    .prepare(
      `UPDATE forum_images SET status='ready',updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='uploading' AND updated_at=? RETURNING ${imageColumns}`,
    )
    .bind(row.id, row.updated_at)
    .first<ForumImage>();
  if (ready) return ready;
  const current = await db
    .prepare(`SELECT ${storedImageColumns} FROM forum_images WHERE id=?`)
    .bind(row.id)
    .first<StoredForumImage>();
  if (current?.status === "ready") return current;
  // A late upload must not leave an object behind after an explicit cleanup.
  if (current?.status === "cleanup" || current?.status === "cleaned")
    await ctx.bucket.delete(row.object_key);
  throw imageUploadPending(locale);
}

export async function writeForumImage(
  ctx: ForumRuntime,
  row: StoredForumImage,
  bytes: ArrayBuffer,
  locale: UiLocale = DEFAULT_UI_LOCALE,
): Promise<ForumImage> {
  const bucket = ctx.bucket;
  try {
    await putImmutableImage(bucket, row, bytes);
    return await finishUpload(ctx, row, locale);
  } catch (error) {
    await ctx.db
      .prepare(
        `UPDATE forum_images SET status='uncertain',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='uploading' AND updated_at=?`,
      )
      .bind(row.id, row.updated_at)
      .run();
    if (error instanceof HttpError) throw error;
    throw imageUploadPending(locale);
  }
}

// Administrative reconciliation never writes image bytes. It must first acquire
// the same expired upload state used by the uploader's retry.
export async function reconcileForumImage(ctx: ForumRuntime, id: string, locale: UiLocale = DEFAULT_UI_LOCALE) {
  const db = ctx.db;
  const stamp = new Date().toISOString();
  const row = await db
    .prepare(
      `UPDATE forum_images SET status='uploading',updated_at=?
    WHERE id=? AND status IN('uploading','uncertain')
      AND datetime(updated_at)<=datetime('now','-1 minute') RETURNING ${storedImageColumns}`,
    )
    .bind(stamp, id)
    .first<StoredForumImage>();
  if (!row) throw imageUploadPending(locale);
  try {
    const object = await ctx.bucket.head(row.object_key);
    if (object) {
      verifyObject(row, object, locale);
      await finishUpload(ctx, row, locale);
    } else {
      await db
        .prepare(
          `UPDATE forum_images SET status='failed',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='uploading' AND updated_at=?`,
        )
        .bind(id, stamp)
        .run();
    }
  } catch (error) {
    await db
      .prepare(
        `UPDATE forum_images SET status='uncertain',updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='uploading' AND updated_at=?`,
      )
      .bind(id, stamp)
      .run();
    throw error;
  }
}
