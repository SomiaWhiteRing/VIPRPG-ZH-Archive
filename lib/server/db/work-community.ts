import { cache } from "react";
import type { ArchiveUser } from "@/lib/server/db/users";
import { getD1 } from "@/lib/server/db/d1";
import { HttpError } from "@/lib/server/http/json";

const MAX_COMMENT_LENGTH = 2000;
const SHORTCODE_RE = /:([A-Za-z0-9_+\-]{1,64}):/g;

export type CommentBodySegment =
  | { type: "text"; text: string }
  | { type: "emoji"; shortcode: string; imageUrl: string; alt: string };

export type CustomEmojiDto = {
  id: number;
  shortcode: string;
  name: string;
  category: string;
  imageUrl: string;
  visibleInPicker: boolean;
  status: "active" | "retired";
};

export type CommentDto = {
  id: number;
  workId: number;
  rootCommentId: number | null;
  replyTo: { commentId: number; displayName: string | null } | null;
  author: { id: number; displayName: string; avatarBlobSha256: string | null } | null;
  body: CommentBodySegment[];
  bodySource?: string | null;
  status: "published" | "hidden" | "deleted";
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  likeCount: number;
  likedByMe: boolean;
  replyCount?: number;
  rootDeleted?: boolean;
};

export type CommentPage = {
  items: CommentDto[];
  nextCursor: string | null;
};

export type UserCommentSummary = {
  id: number;
  workId: number;
  workTitle: string;
  body: string;
  status: "published" | "hidden" | "deleted";
  likeCount: number;
  updatedAt: string;
};

type EmojiRow = {
  id: number;
  shortcode: string;
  name: string;
  category: string;
  image_blob_sha256: string;
  visible_in_picker: number;
  status: "active" | "retired";
};

type CommentRow = {
  id: number;
  work_id: number;
  root_comment_id: number | null;
  reply_to_comment_id: number | null;
  reply_to_display_name: string | null;
  user_id: number;
  author_name: string | null;
  author_avatar_blob_sha256: string | null;
  body: string | null;
  status: "published" | "hidden" | "deleted";
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  reply_count?: number;
  like_count?: number;
  liked_by_me?: number;
  root_status?: "published" | "hidden" | "deleted" | null;
};

export async function recordWorkView(workId: number): Promise<void> {
  const result = await getD1()
    .prepare(
      `INSERT INTO work_engagement_stats(work_id, view_count, updated_at)
       SELECT id,1,CURRENT_TIMESTAMP FROM works WHERE id=? AND status='published'
       ON CONFLICT(work_id) DO UPDATE SET
         view_count = work_engagement_stats.view_count + 1,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(workId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, "作品不存在");
}

export async function recordWorkPlayed(workId: number, userId: number): Promise<void> {
  const result = await getD1()
    .prepare(
      `INSERT INTO user_work_entries(work_id, user_id, last_played_at, updated_at)
       SELECT id,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
       FROM works WHERE id=? AND status='published'
       ON CONFLICT(work_id, user_id) DO UPDATE SET
         last_played_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(userId, workId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, "作品不存在");
}

export async function setWorkFavorite(
  workId: number,
  userId: number,
  favorited: boolean,
): Promise<void> {
  const database = getD1();
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO user_work_entries(work_id, user_id, favorited_at, updated_at)
         SELECT id,?,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP
         FROM works WHERE id=? AND status='published'
         ON CONFLICT(work_id, user_id) DO UPDATE SET
           favorited_at = excluded.favorited_at,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(userId, favorited ? 1 : 0, workId),
    database
      .prepare(
        `DELETE FROM user_work_entries
         WHERE work_id = ? AND user_id = ?
           AND last_played_at IS NULL AND favorited_at IS NULL
           AND changes()=1`,
      )
      .bind(workId, userId),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1) throw new HttpError(404, "作品不存在");
}

export async function getWorkCommunitySummary(workId: number, userId: number | null): Promise<{
  viewCount: number;
  playerCount: number;
  commentCount: number;
  favoritedByMe: boolean;
}> {
  const row = await getD1()
    .prepare(
      `SELECT
         COALESCE((SELECT view_count FROM work_engagement_stats WHERE work_id = w.id), 0) AS view_count,
         (SELECT COUNT(*) FROM user_work_entries WHERE work_id = w.id AND last_played_at IS NOT NULL) AS player_count,
         (SELECT COUNT(*) FROM work_comments c JOIN users cu ON cu.id = c.user_id
          LEFT JOIN work_comments root ON root.id = COALESCE(c.root_comment_id, c.id)
          WHERE c.work_id = w.id AND c.status = 'published' AND cu.status = 'active' AND root.status = 'published') AS comment_count,
         EXISTS(SELECT 1 FROM user_work_entries ue
          WHERE ue.work_id = w.id AND ue.user_id = ? AND ue.favorited_at IS NOT NULL) AS favorited_by_me
       FROM works w WHERE w.id = ? AND w.status = 'published' LIMIT 1`,
    )
    .bind(userId ?? 0, workId)
    .first<{ view_count: number; player_count: number; comment_count: number; favorited_by_me: number }>();
  if (!row) throw new HttpError(404, "作品不存在");
  return {
    viewCount: row.view_count,
    playerCount: row.player_count,
    commentCount: row.comment_count,
    favoritedByMe: row.favorited_by_me === 1,
  };
}

export async function listPickerEmojis(): Promise<CustomEmojiDto[]> {
  return (await listAllRenderEmojis())
    .filter((row) => row.status === "active" && row.visible_in_picker === 1)
    .map(mapEmoji);
}

export async function listAdminEmojis(): Promise<CustomEmojiDto[]> {
  return (await listAllRenderEmojis()).map(mapEmoji);
}

export const listAllRenderEmojis = cache(async (): Promise<EmojiRow[]> => {
  const rows = await getD1()
    .prepare(
      `SELECT id,shortcode,name,category,image_blob_sha256,visible_in_picker,status
       FROM custom_emojis
       WHERE status IN ('active','retired')
       ORDER BY shortcode`,
    )
    .all<EmojiRow>();
  return rows.results ?? [];
});

export async function createCustomEmoji(input: {
  shortcode: string;
  name: string;
  category?: string;
  visibleInPicker?: boolean;
  imageBlobSha256: string;
}): Promise<CustomEmojiDto> {
  const shortcode = normalizeShortcode(input.shortcode);
  const name = requiredText(input.name, "表情名称", 80);
  const category = requiredText(input.category ?? "站点", "表情分类", 40);
  const existingBlob = await getD1()
    .prepare(`SELECT status FROM blobs WHERE sha256 = ? LIMIT 1`)
    .bind(input.imageBlobSha256)
    .first<{ status: string }>();
  if (!existingBlob || existingBlob.status !== "active")
    throw new HttpError(400, "表情图片不存在或不可用");
  try {
    await getD1()
      .prepare(
        `INSERT INTO custom_emojis(shortcode,name,category,visible_in_picker,image_blob_sha256)
         VALUES(?,?,?,?,?)`,
      )
      .bind(shortcode, name, category, input.visibleInPicker === false ? 0 : 1, input.imageBlobSha256)
      .run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new HttpError(409, "shortcode 已存在");
    throw error;
  }
  const emoji = await getD1()
    .prepare(
      `SELECT id,shortcode,name,category,image_blob_sha256,visible_in_picker,status FROM custom_emojis WHERE shortcode=? LIMIT 1`,
    )
    .bind(shortcode)
    .first<EmojiRow>();
  if (!emoji) throw new Error("表情创建后不可读取");
  return mapEmoji(emoji);
}

export async function updateCustomEmoji(
  id: number,
  input: { name?: string; category?: string; visibleInPicker?: boolean; status?: "active" | "retired" },
): Promise<CustomEmojiDto> {
  const current = await getD1()
    .prepare(`SELECT id,shortcode,name,category,visible_in_picker,image_blob_sha256,status FROM custom_emojis WHERE id=? LIMIT 1`)
    .bind(id)
    .first<EmojiRow & { id: number }>();
  if (!current) throw new HttpError(404, "表情不存在");
  await getD1()
    .prepare(
      `UPDATE custom_emojis SET name=?,category=?,visible_in_picker=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(
      input.name === undefined ? current.name : requiredText(input.name, "表情名称", 80),
      input.category === undefined ? current.category : requiredText(input.category, "表情分类", 40),
      input.visibleInPicker === undefined ? current.visible_in_picker : input.visibleInPicker ? 1 : 0,
      input.status ?? current.status,
      id,
    )
    .run();
  const updated = await getD1()
    .prepare(`SELECT id,shortcode,name,category,image_blob_sha256,visible_in_picker,status FROM custom_emojis WHERE id=? LIMIT 1`)
    .bind(id)
    .first<EmojiRow>();
  if (!updated) throw new Error("表情更新后不可读取");
  return mapEmoji(updated);
}

export async function listRootComments(
  workId: number,
  currentUserId: number | null,
  cursor: string | null,
  limit = 20,
): Promise<CommentPage> {
  const parsed = decodeCursor(cursor);
  const size = clampPageSize(limit);
  const clauses = ["c.work_id = ?", "c.root_comment_id IS NULL", "c.status = 'published'", "u.status = 'active'"];
  const binds: Array<string | number> = [workId];
  if (parsed) {
    clauses.push("(c.created_at > ? OR (c.created_at = ? AND c.id > ?))");
    binds.push(parsed.createdAt, parsed.createdAt, parsed.id);
  }
  const database = getD1();
  const [workResult, rowsResult] = await database.batch([
    database.prepare(`SELECT id FROM works WHERE id=? AND status='published' LIMIT 1`).bind(workId),
    database.prepare(
      `SELECT c.id,c.work_id,c.root_comment_id,c.reply_to_comment_id,
          NULL AS reply_to_display_name,c.user_id,u.display_name AS author_name,u.avatar_blob_sha256 AS author_avatar_blob_sha256,c.body,c.status,
          c.created_at,c.updated_at,c.edited_at,
          (SELECT COUNT(*) FROM work_comments r WHERE r.root_comment_id=c.id AND r.status <> 'hidden') AS reply_count,
          (SELECT COUNT(*) FROM work_comment_likes l WHERE l.comment_id=c.id) AS like_count,
          ${currentUserId ? "EXISTS(SELECT 1 FROM work_comment_likes ml WHERE ml.comment_id=c.id AND ml.user_id=?)" : "0"} AS liked_by_me
       FROM work_comments c JOIN users u ON u.id=c.user_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY c.created_at ASC,c.id ASC LIMIT ?`,
    ).bind(...(currentUserId ? [currentUserId, ...binds, size + 1] : [...binds, size + 1])),
  ]);
  if (!workResult.results?.length) throw new HttpError(404, "作品不存在");
  return pageFromRows((rowsResult.results ?? []) as CommentRow[], size, currentUserId);
}

export async function listReplies(
  rootCommentId: number,
  currentUserId: number | null,
  cursor: string | null,
  limit = 20,
): Promise<CommentPage> {
  const parsed = decodeCursor(cursor);
  const size = clampPageSize(limit);
  const clauses = ["c.root_comment_id = ?", "c.status IN ('published','deleted')"];
  const binds: Array<string | number> = [rootCommentId];
  if (parsed) {
    clauses.push("(c.created_at > ? OR (c.created_at = ? AND c.id > ?))");
    binds.push(parsed.createdAt, parsed.createdAt, parsed.id);
  }
  const database = getD1();
  const [rootResult, rowsResult] = await database.batch([
    database
      .prepare(
        `SELECT c.id
         FROM work_comments c JOIN works w ON w.id=c.work_id
         WHERE c.id=? AND c.root_comment_id IS NULL
           AND c.status='published' AND w.status='published'
         LIMIT 1`,
      )
      .bind(rootCommentId),
    database.prepare(
      `SELECT c.id,c.work_id,c.root_comment_id,c.reply_to_comment_id,
          target.display_name AS reply_to_display_name,c.user_id,u.display_name AS author_name,u.avatar_blob_sha256 AS author_avatar_blob_sha256,c.body,c.status,
          c.created_at,c.updated_at,c.edited_at,
          0 AS reply_count,
          (SELECT COUNT(*) FROM work_comment_likes l WHERE l.comment_id=c.id) AS like_count,
          ${currentUserId ? "EXISTS(SELECT 1 FROM work_comment_likes ml WHERE ml.comment_id=c.id AND ml.user_id=?)" : "0"} AS liked_by_me
       FROM work_comments c
       LEFT JOIN users u ON u.id=c.user_id AND u.status='active'
       LEFT JOIN work_comments target_comment ON target_comment.id=c.reply_to_comment_id
       LEFT JOIN users target ON target.id=target_comment.user_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY c.created_at ASC,c.id ASC LIMIT ?`,
    ).bind(...(currentUserId ? [currentUserId, ...binds, size + 1] : [...binds, size + 1])),
  ]);
  if (!rootResult.results?.length) throw new HttpError(404, "主楼不存在");
  return pageFromRows((rowsResult.results ?? []) as CommentRow[], size, currentUserId);
}

export async function searchUserComments(input: {
  userId: number;
  publicOnly?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{ items: UserCommentSummary[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize ?? 20)));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const publicClause = input.publicOnly
    ? "AND c.status='published' AND root.status='published' AND u.status='active'"
    : "";
  const from = `FROM work_comments c JOIN works w ON w.id=c.work_id JOIN users u ON u.id=c.user_id LEFT JOIN work_comments root ON root.id=COALESCE(c.root_comment_id,c.id) WHERE c.user_id=? AND w.status='published' ${publicClause}`;
  const database = getD1();
  const [countResult, rowsResult] = await database.batch([
    database.prepare(`SELECT COUNT(*) AS count ${from}`).bind(input.userId),
    database
      .prepare(`SELECT c.id,c.work_id,COALESCE(w.chinese_title,w.original_title) AS work_title,COALESCE(c.body,'') AS body,c.status,c.updated_at,(SELECT COUNT(*) FROM work_comment_likes l WHERE l.comment_id=c.id) AS like_count ${from} ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?`)
      .bind(input.userId, pageSize, (page - 1) * pageSize),
  ]);
  const rows = (rowsResult.results ?? []) as Array<{ id: number; work_id: number; work_title: string; body: string; status: "published" | "hidden" | "deleted"; updated_at: string; like_count: number }>;
  return {
    items: rows.map((row) => ({ id: row.id, workId: row.work_id, workTitle: row.work_title, body: row.body, status: row.status, likeCount: row.like_count, updatedAt: row.updated_at })),
    total: Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    page,
    pageSize,
  };
}

export async function createComment(
  workId: number,
  userId: number,
  bodyInput: unknown,
  replyToCommentId?: number,
): Promise<CommentDto> {
  await assertPublishedWork(workId);
  const body = normalizeCommentBody(bodyInput);
  let rootCommentId: number | null = null;
  let replyToId: number | null = null;
  if (replyToCommentId !== undefined) {
    const target = await getD1()
      .prepare(`SELECT id,work_id,root_comment_id,status FROM work_comments WHERE id=? LIMIT 1`)
      .bind(replyToCommentId)
      .first<{ id: number; work_id: number; root_comment_id: number | null; status: string }>();
    if (!target || target.work_id !== workId || target.status !== "published")
      throw new HttpError(409, "回复目标不可用");
    rootCommentId = target.root_comment_id ?? target.id;
    replyToId = target.root_comment_id === null ? null : target.id;
  }
  const result = await getD1()
    .prepare(
      `INSERT INTO work_comments(work_id,user_id,root_comment_id,reply_to_comment_id,body,status)
       VALUES(?,?,?,?,?,'published')`,
    )
    .bind(workId, userId, rootCommentId, replyToId, body)
    .run();
  const id = Number(result.meta.last_row_id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("评论创建失败");
  return requiredComment(id, userId);
}

export async function updateComment(id: number, userId: number, bodyInput: unknown): Promise<CommentDto> {
  const body = normalizeCommentBody(bodyInput);
  const result = await getD1()
    .prepare(
      `UPDATE work_comments SET body=?,updated_at=CURRENT_TIMESTAMP,edited_at=CURRENT_TIMESTAMP
       WHERE id=? AND user_id=? AND status IN ('published','hidden')`,
    )
    .bind(body, id, userId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, "评论不存在或不可编辑");
  return requiredComment(id, userId);
}

export async function deleteComment(id: number, userId: number): Promise<void> {
  const result = await getD1()
    .prepare(
      `UPDATE work_comments SET body=NULL,status='deleted',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
       WHERE id=? AND user_id=? AND status <> 'deleted'`,
    )
    .bind(id, userId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, "评论不存在或不可删除");
}

export async function moderateComment(
  id: number,
  actor: ArchiveUser,
  status: "published" | "hidden",
): Promise<CommentDto> {
  const current = await getD1()
    .prepare(`SELECT id,user_id,status FROM work_comments WHERE id=? LIMIT 1`)
    .bind(id)
    .first<{ id: number; user_id: number; status: string }>();
  if (!current || current.status === "deleted") throw new HttpError(404, "评论不存在或不可恢复");
  const database = getD1();
  await database.batch([
    database
      .prepare(`UPDATE work_comments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('published','hidden')`)
      .bind(status, id),
    database
      .prepare(
         `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
         VALUES(?,?,?,?)`,
      )
      .bind(actor.id, actor.email, "work_comment_moderation", JSON.stringify({ commentId: id, from: current.status, to: status })),
  ]);
  return requiredComment(id, actor.id);
}

export async function likeComment(id: number, userId: number): Promise<void> {
  const comment = await publicCommentIdentity(id);
  await getD1()
    .prepare(`INSERT OR IGNORE INTO work_comment_likes(comment_id,user_id) VALUES(?,?)`)
    .bind(comment.id, userId)
    .run();
}

export async function unlikeComment(id: number, userId: number): Promise<void> {
  await getD1().prepare(`DELETE FROM work_comment_likes WHERE comment_id=? AND user_id=?`).bind(id, userId).run();
}

async function publicCommentIdentity(id: number): Promise<{ id: number }> {
  const row = await getD1()
    .prepare(
      `SELECT c.id FROM work_comments c JOIN works w ON w.id=c.work_id
       JOIN users u ON u.id=c.user_id
       LEFT JOIN work_comments root ON root.id=COALESCE(c.root_comment_id,c.id)
       WHERE c.id=? AND c.status='published' AND w.status='published' AND u.status='active' AND root.status='published' LIMIT 1`,
    )
    .bind(id)
    .first<{ id: number }>();
  if (!row) throw new HttpError(404, "评论不存在");
  return row;
}

async function requiredComment(id: number, viewerId: number | null): Promise<CommentDto> {
  const row = await getD1()
    .prepare(
      `SELECT c.id,c.work_id,c.root_comment_id,c.reply_to_comment_id,
          target.display_name AS reply_to_display_name,c.user_id,u.display_name AS author_name,u.avatar_blob_sha256 AS author_avatar_blob_sha256,c.body,c.status,
          c.created_at,c.updated_at,c.edited_at,
          (SELECT COUNT(*) FROM work_comment_likes l WHERE l.comment_id=c.id) AS like_count,
          ${viewerId ? "EXISTS(SELECT 1 FROM work_comment_likes ml WHERE ml.comment_id=c.id AND ml.user_id=?)" : "0"} AS liked_by_me
       FROM work_comments c
       LEFT JOIN users u ON u.id=c.user_id
       LEFT JOIN work_comments target_comment ON target_comment.id=c.reply_to_comment_id
       LEFT JOIN users target ON target.id=target_comment.user_id
       WHERE c.id=? LIMIT 1`,
    )
    .bind(...(viewerId ? [viewerId, id] : [id]))
    .first<CommentRow>();
  if (!row) throw new HttpError(404, "评论不存在");
  return mapComment(row, viewerId, await emojiMap());
}

async function assertPublishedWork(workId: number): Promise<void> {
  const row = await getD1().prepare(`SELECT id FROM works WHERE id=? AND status='published' LIMIT 1`).bind(workId).first<{ id: number }>();
  if (!row) throw new HttpError(404, "作品不存在");
}

async function emojiMap(): Promise<Map<string, EmojiRow>> {
  const rows = await listAllRenderEmojis();
  return new Map(rows.map((row) => [row.shortcode.toLowerCase(), row]));
}

function mapEmoji(row: EmojiRow): CustomEmojiDto {
  return {
    id: row.id,
    shortcode: row.shortcode,
    name: row.name,
    category: row.category,
    imageUrl: `/api/media/blobs/${row.image_blob_sha256}`,
    visibleInPicker: row.visible_in_picker === 1,
    status: row.status,
  };
}

function mapComment(row: CommentRow, viewerId: number | null, emojis: Map<string, EmojiRow>): CommentDto {
  const deleted = row.status === "deleted";
  return {
    id: row.id,
    workId: row.work_id,
    rootCommentId: row.root_comment_id,
    replyTo: row.reply_to_comment_id
      ? { commentId: row.reply_to_comment_id, displayName: row.reply_to_display_name }
      : null,
    author: row.author_name ? { id: row.user_id, displayName: row.author_name, avatarBlobSha256: row.author_avatar_blob_sha256 } : null,
    body: deleted ? [{ type: "text", text: "该评论已删除" }] : tokenizeBody(row.body ?? "", emojis),
    ...(viewerId !== null && row.user_id === viewerId ? { bodySource: row.body } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at,
    likeCount: row.like_count ?? 0,
    likedByMe: row.liked_by_me === 1,
    ...(row.reply_count === undefined ? {} : { replyCount: row.reply_count }),
    ...(row.root_status && row.root_status !== "published" ? { rootDeleted: row.root_status === "deleted" } : {}),
  };
}

function tokenizeBody(value: string, emojis: Map<string, EmojiRow>): CommentBodySegment[] {
  const result: CommentBodySegment[] = [];
  let cursor = 0;
  SHORTCODE_RE.lastIndex = 0;
  for (const match of value.matchAll(SHORTCODE_RE)) {
    const index = match.index ?? 0;
    if (index > cursor) result.push({ type: "text", text: value.slice(cursor, index) });
    const shortcode = match[1];
    const emoji = emojis.get(shortcode.toLowerCase());
    if (!emoji) result.push({ type: "text", text: match[0] });
    else result.push({ type: "emoji", shortcode: emoji.shortcode, imageUrl: `/api/media/blobs/${emoji.image_blob_sha256}`, alt: `:${emoji.shortcode}:` });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) result.push({ type: "text", text: value.slice(cursor) });
  return result.length ? result : [{ type: "text", text: "" }];
}

function normalizeCommentBody(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "评论正文必须是文本");
  const body = value.replace(/\r\n?/g, "\n").trim();
  if (!body) throw new HttpError(400, "评论正文不能为空");
  if ([...body].length > MAX_COMMENT_LENGTH) throw new HttpError(400, "评论正文过长");
  return body;
}

function normalizeShortcode(value: string): string {
  const shortcode = value.trim().toLowerCase();
  if (!/^[a-z0-9_+\-]{1,64}$/.test(shortcode)) throw new HttpError(400, "shortcode 格式不合法");
  return shortcode;
}

function requiredText(value: string, label: string, maxLength: number): string {
  const text = value.trim();
  if (!text || [...text].length > maxLength) throw new HttpError(400, `${label}不合法`);
  return text;
}

async function pageFromRows(
  rows: CommentRow[],
  size: number,
  viewerId: number | null,
  cursorField: "created_at" | "updated_at" = "created_at",
): Promise<CommentPage> {
  const hasMore = rows.length > size;
  const items = rows.slice(0, size);
  const emojis = await emojiMap();
  return {
    items: items.map((row) => mapComment(row, viewerId, emojis)),
    nextCursor:
      hasMore && items.length
        ? encodeCursor(items[items.length - 1][cursorField], items[items.length - 1].id)
        : null,
  };
}

function clampPageSize(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(20, Math.floor(value))) : 20;
}

function encodeCursor(createdAt: string, id: number): string {
  return encodeURIComponent(`${createdAt}|${id}`);
}

function decodeCursor(value: string | null): { createdAt: string; id: number } | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value);
  const split = decoded.lastIndexOf("|");
  const id = Number(decoded.slice(split + 1));
  if (split <= 0 || !Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "cursor 不合法");
  return { createdAt: decoded.slice(0, split), id };
}
