import type { ForumRuntime } from "./runtime";

import { FORUM_IMAGE_COUNT } from "@/lib/forum";
import { HttpError } from "@/lib/http";

export const imageColumns =
  "id,('/api/discussions/images/' || id) AS url,('/api/discussions/images/' || id) AS thumb,width,height,size,format,body_offset AS offset";
export const imageJsonSql = `(SELECT COALESCE(json_group_array(json_object('id',id,'url',url,'thumb',thumb,'width',width,'height',height,'size',size,'format',format,'offset',offset)),'[]') FROM (SELECT ${imageColumns} FROM forum_images WHERE post_id=p.id AND status='ready' ORDER BY position))`;
export function imageIds(value: unknown, comment = false): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > FORUM_IMAGE_COUNT ||
    (comment && value.length > 0) ||
    value.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{16,100}$/.test(id),
    ) ||
    new Set(value).size !== value.length
  )
    throw new HttpError(
      400,
      comment ? "楼内回复不支持图片。" : "图片列表无效。",
    );
  return value;
}
export function imageGuard(ids: string[], userId: number, postId = 0) {
  return {
    sql: `(SELECT COUNT(*) FROM forum_images WHERE id IN(SELECT value FROM json_each(?)) AND user_id=? AND status='ready' AND (post_id IS NULL OR post_id=?))=?`,
    args: [JSON.stringify(ids), userId, postId, ids.length],
  };
}
export function imageOffsets(
  value: unknown,
  ids: string[],
  body: string,
): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== ids.length ||
    value.some(
      (offset, index) =>
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > body.length ||
        (index > 0 && offset < value[index - 1]) ||
        (offset > 0 &&
          /[\uD800-\uDBFF]/.test(body[offset - 1]) &&
          /[\uDC00-\uDFFF]/.test(body[offset] ?? "")),
    )
  )
    throw new HttpError(400, "图片在正文中的位置无效。");
  return value;
}
// The post revision is written by the existing guarded transaction. A failed
// topic/content guard cannot detach or claim any attachment.
export function imageStatements(
  ctx: ForumRuntime,
  ids: string[],
  userId: number,
  revision: string,
  offsets: number[],
) {
  const db = ctx.db,
    target = "SELECT id FROM forum_posts WHERE user_id=? AND revision=?";
  return [
    db
      .prepare(
        `UPDATE forum_images SET post_id=NULL,position=NULL,updated_at=CURRENT_TIMESTAMP WHERE post_id IN(${target}) AND status='ready'`,
      )
      .bind(userId, revision),
    db
      .prepare(
        `WITH selected AS (
      SELECT json_extract(value,'$.id') AS id, CAST(key AS INTEGER) AS position,
             json_extract(value,'$.offset') AS body_offset FROM json_each(?)
    ) UPDATE forum_images SET post_id=(${target}),
      position=(SELECT position FROM selected WHERE selected.id=forum_images.id),
      body_offset=(SELECT body_offset FROM selected WHERE selected.id=forum_images.id),
      updated_at=CURRENT_TIMESTAMP
      WHERE id IN(SELECT id FROM selected) AND user_id=? AND status='ready'
        AND post_id IS NULL AND EXISTS(${target})`,
      )
      .bind(
        JSON.stringify(
          ids.map((id, index) => ({ id, offset: offsets[index] })),
        ),
        userId,
        revision,
        userId,
        userId,
        revision,
      ),
  ];
}
