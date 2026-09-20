import { getD1 } from "@/app/.server/db/d1";
import {
  CHARACTER_PORTRAIT_COLUMNS,
  DEFAULT_CHARACTER_PORTRAIT_JOINS,
  PUBLIC_CHARACTER_PORTRAIT_CONDITION,
  mapCharacterPortrait,
  type CharacterPortraitRow,
} from "@/app/.server/db/character-portrait-library";
import type { AppRuntime } from "@/app/.server/runtime";
import {
  bodyEmojis,
  contentEmojiStatements,
  validateBodyEmojis,
} from "@/app/.server/emojis/service";
import { bodyLength, emojiText, FACE_EMOJI_PATTERN } from "@/lib/face-emojis";
import {
  COMMENT_REPLY_PAGE_SIZE,
  COMMENT_REPLY_PREVIEW_SIZE,
} from "@/lib/comment-pagination";
import type { CommentTarget } from "@/lib/comment-target";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type {
  CommentBodySegment,
  CommentDto,
  CommentPage,
  CommentReplyPage,
  FaceEmoji,
  UserCommentSummary,
} from "@/lib/dto/db/work-community";
import { hasPermission } from "@/lib/authz/permissions";
import { HttpError } from "@/lib/http";

export type { CommentTarget } from "@/lib/comment-target";

const MAX_COMMENT_LENGTH = 2000;
type CommentRow = {
  id: number;
  floor_number?: number | null;
  pinned_at?: string | null;
  work_id: number | null;
  creator_id: number | null;
  character_id: number | null;
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

export async function recordWorkView(
  runtime: AppRuntime,
  workId: number,
): Promise<void> {
  const result = await getD1(runtime)
    .prepare(
      `INSERT INTO work_engagement_stats(work_id, view_count, updated_at)
       SELECT id,1,CURRENT_TIMESTAMP FROM public_works WHERE id=?
       ON CONFLICT(work_id) DO UPDATE SET
         view_count = work_engagement_stats.view_count + 1,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(workId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, "作品不存在");
}

export async function recordWorkPlayed(
  runtime: AppRuntime,
  workId: number,
  userId: number,
): Promise<void> {
  const result = await getD1(runtime)
    .prepare(
      `INSERT INTO user_work_entries(work_id, user_id, last_played_at, updated_at)
       SELECT id,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
       FROM public_works WHERE id=?
       ON CONFLICT(work_id, user_id) DO UPDATE SET
         last_played_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(userId, workId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, "作品不存在");
}

export async function setWorkFavorite(
  runtime: AppRuntime,
  workId: number,
  userId: number,
  favorited: boolean,
): Promise<void> {
  const database = getD1(runtime);
  const results = await database.batch([
    database
      .prepare(
        `INSERT INTO user_work_entries(work_id, user_id, favorited_at, updated_at)
         SELECT id,?,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP
         FROM public_works WHERE id=?
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
  if ((results[0].meta.changes ?? 0) !== 1)
    throw new HttpError(404, "作品不存在");
}

export async function getWorkCommunitySummary(
  runtime: AppRuntime,
  workId: number,
  userId: number | null,
): Promise<{
  viewCount: number;
  playerCount: number;
  commentCount: number;
  favoritedByMe: boolean;
}> {
  const row = await getD1(runtime)
    .prepare(
      `SELECT
         COALESCE((SELECT view_count FROM work_engagement_stats WHERE work_id = w.id), 0) AS view_count,
         (SELECT COUNT(*) FROM user_work_entries WHERE work_id = w.id AND last_played_at IS NOT NULL) AS player_count,
         (SELECT COUNT(*) FROM public_comments c WHERE c.work_id=w.id) AS comment_count,
         EXISTS(SELECT 1 FROM user_work_entries ue
          WHERE ue.work_id = w.id AND ue.user_id = ? AND ue.favorited_at IS NOT NULL) AS favorited_by_me
       FROM works w WHERE w.id = ? AND w.id IN (SELECT id FROM public_works) LIMIT 1`,
    )
    .bind(userId ?? 0, workId)
    .first<{
      view_count: number;
      player_count: number;
      comment_count: number;
      favorited_by_me: number;
    }>();
  if (!row) throw new HttpError(404, "作品不存在");
  return {
    viewCount: row.view_count,
    playerCount: row.player_count,
    commentCount: row.comment_count,
    favoritedByMe: row.favorited_by_me === 1,
  };
}

export async function canPinWorkComments(
  runtime: AppRuntime,
  workId: number,
  user: ArchiveUser | null,
): Promise<boolean> {
  if (!user) return false;
  if (hasPermission(user, "comment.manage_any")) return true;
  return !!(await getD1(runtime)
    .prepare("SELECT 1 FROM work_uploaders WHERE work_id=? AND user_id=?")
    .bind(workId, user.id)
    .first());
}

export async function pinComment(
  runtime: AppRuntime,
  id: number,
  user: ArchiveUser,
  pinned: unknown,
): Promise<CommentDto> {
  if (typeof pinned !== "boolean") throw new HttpError(400, "置顶状态无效");
  const comment = await requiredComment(runtime, id, user.id);
  if (comment.target.kind !== "work" || comment.rootCommentId !== null)
    throw new HttpError(400, "只能置顶游戏主楼评论");
  if (!(await canPinWorkComments(runtime, comment.target.id, user)))
    throw new HttpError(403, "只有游戏上传者和管理员可以置顶评论");
  const result = await getD1(runtime).prepare(`UPDATE comments SET pinned_at=CASE WHEN ?=1 THEN COALESCE(pinned_at,CURRENT_TIMESTAMP) ELSE NULL END
    WHERE id=? AND id IN (SELECT id FROM public_comments)
      AND (?=1 OR EXISTS(SELECT 1 FROM work_uploaders WHERE work_id=comments.work_id AND user_id=?))`)
    .bind(pinned ? 1 : 0, id, hasPermission(user, "comment.manage_any") ? 1 : 0, user.id).run();
  if (result.meta.changes !== 1) throw new HttpError(404, "评论不可用");
  return requiredComment(runtime, id, user.id);
}

export async function listRootComments(
  runtime: AppRuntime,
  target: CommentTarget,
  currentUserId: number | null,
  cursor: string | null,
  limit = 20,
): Promise<CommentPage> {
  const parsed = decodeCursor(cursor);
  const size = clampPageSize(limit);
  const targetColumn = `${target.kind}_id`;
  const descending = target.kind === "work";
  const direction = descending ? "DESC" : "ASC";
  const comparison = descending ? "<" : ">";
  const clauses = [
    `c.${targetColumn} = ?`,
    "c.root_comment_id IS NULL",
    "c.id IN (SELECT id FROM public_comments)",
  ];
  const binds: Array<string | number> = [target.id];
  if (parsed) {
    clauses.push(`(c.created_at ${comparison} ? OR (c.created_at = ? AND c.id ${comparison} ?))`);
    binds.push(parsed.createdAt, parsed.createdAt, parsed.id);
  }
  const database = getD1(runtime);
  // Pins are an extra first-page group; only ordinary roots advance the cursor.
  const rootStatement = (pinned: boolean) =>
    database
      .prepare(
        `SELECT c.id,c.pinned_at,c.work_id,c.creator_id,c.character_id,c.root_comment_id,c.reply_to_comment_id,
          ${commentFloorSql()} AS floor_number,
          NULL AS reply_to_display_name,c.user_id,u.display_name AS author_name,u.avatar_blob_sha256 AS author_avatar_blob_sha256,c.body,c.status,
          c.created_at,c.updated_at,c.edited_at,
          (SELECT COUNT(*) FROM comments r LEFT JOIN users ru ON ru.id=r.user_id
           WHERE r.root_comment_id=c.id AND ${visibleReplySql("r", "ru")}) AS reply_count,
          (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id=c.id) AS like_count,
          ${currentUserId ? "EXISTS(SELECT 1 FROM comment_likes ml WHERE ml.comment_id=c.id AND ml.user_id=?)" : "0"} AS liked_by_me
       FROM comments c JOIN users u ON u.id=c.user_id
       WHERE ${[...clauses, pinned ? "c.pinned_at IS NOT NULL" : "c.pinned_at IS NULL"].join(" AND ")}
       ORDER BY ${pinned ? "c.pinned_at DESC," : ""} c.created_at ${direction},c.id ${direction} LIMIT ?`,
      )
      .bind(
        ...(currentUserId
          ? [currentUserId, ...binds, pinned ? -1 : size + 1]
          : [...binds, pinned ? -1 : size + 1]),
      );
  const [targetResult, rowsResult] = await database.batch([
    publicTargetStatement(database, target),
    rootStatement(false),
  ]);
  if (!targetResult.results?.length)
    throw new HttpError(
      404,
      target.kind === "work"
        ? "作品不存在"
        : target.kind === "creator"
          ? "作者不存在"
          : "角色不存在",
    );
  const page = await pageFromRows(
    runtime,
    (rowsResult.results ?? []) as CommentRow[],
    size,
    currentUserId,
  );
  if (!parsed && target.kind === "work") {
    const pinnedRows = (await rootStatement(true).all<CommentRow>()).results;
    const emojis = await emojiMap(runtime, pinnedRows);
    page.items.unshift(...pinnedRows.map((row) => mapComment(row, currentUserId, emojis)));
  }
  const rootsWithReplies = page.items.filter((comment) => comment.replyCount);
  if (rootsWithReplies.length) {
    const previews = await database.batch(
      rootsWithReplies.map((comment) =>
        replyRowsStatement(
          database,
          comment.id,
          currentUserId,
          COMMENT_REPLY_PREVIEW_SIZE,
        ),
      ),
    );
    const emojis = await emojiMap(
      runtime,
      previews.flatMap((result) => result.results as CommentRow[]),
    );
    rootsWithReplies.forEach((comment, index) => {
      comment.replyPreview = (previews[index].results as CommentRow[]).map(
        (row) => mapComment(row, currentUserId, emojis),
      );
    });
  }
  return page;
}

export async function listReplies(
  runtime: AppRuntime,
  rootCommentId: number,
  currentUserId: number | null,
  requestedPage = 1,
  commentId?: number,
): Promise<CommentReplyPage> {
  const database = getD1(runtime);
  const [rootResult, countResult, positionResult] = await database.batch([
    database
      .prepare(
        `SELECT c.id
         FROM comments c
         WHERE c.id=? AND c.root_comment_id IS NULL
           AND c.id IN (SELECT id FROM public_comments)
           AND EXISTS (SELECT 1 FROM users root_user WHERE root_user.id=c.user_id AND root_user.status IN ('active','deleted'))
         LIMIT 1`,
      )
      .bind(rootCommentId),
    database
      .prepare(
        `SELECT COUNT(*) AS total FROM comments c LEFT JOIN users u ON u.id=c.user_id
         WHERE c.root_comment_id=? AND ${visibleReplySql("c", "u")}`,
      )
      .bind(rootCommentId),
    database
      .prepare(
        `SELECT COUNT(*) AS position FROM comments c LEFT JOIN users u ON u.id=c.user_id
         JOIN comments selected ON selected.id=? AND selected.root_comment_id=c.root_comment_id
         WHERE c.root_comment_id=? AND ${visibleReplySql("c", "u")}
           AND (c.created_at < selected.created_at OR (c.created_at=selected.created_at AND c.id <= selected.id))`,
      )
      .bind(commentId ?? 0, rootCommentId),
  ]);
  if (!rootResult.results?.length) throw new HttpError(404, "主楼不存在");
  const total = (countResult.results as { total: number }[])[0]?.total ?? 0;
  const position =
    (positionResult.results as { position: number }[])[0]?.position ?? 0;
  const desiredPage =
    position > 0
      ? Math.ceil(position / COMMENT_REPLY_PAGE_SIZE)
      : Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;
  const page = Math.min(
    desiredPage,
    Math.max(1, Math.ceil(total / COMMENT_REPLY_PAGE_SIZE)),
  );
  const statements = [
    replyRowsStatement(
      database,
      rootCommentId,
      currentUserId,
      COMMENT_REPLY_PAGE_SIZE,
      (page - 1) * COMMENT_REPLY_PAGE_SIZE,
    ),
  ];
  if (page > 1)
    statements.push(
      replyRowsStatement(
        database,
        rootCommentId,
        currentUserId,
        COMMENT_REPLY_PREVIEW_SIZE,
      ),
    );
  const results = await database.batch(statements);
  const emojis = await emojiMap(
    runtime,
    results.flatMap((result) => result.results as CommentRow[]),
  );
  const items = (results[0].results as CommentRow[]).map((row) =>
    mapComment(row, currentUserId, emojis),
  );
  const preview =
    page === 1
      ? items.slice(0, COMMENT_REPLY_PREVIEW_SIZE)
      : (results[1].results as CommentRow[]).map((row) =>
          mapComment(row, currentUserId, emojis),
        );
  return { items, preview, total, page, pageSize: COMMENT_REPLY_PAGE_SIZE };
}

function visibleReplySql(comment: string, user: string): string {
  return `${comment}.status='published' AND ${user}.status IN ('active','deleted')`;
}

function replyRowsStatement(
  database: D1Database,
  rootCommentId: number,
  currentUserId: number | null,
  limit: number,
  offset = 0,
): D1PreparedStatement {
  return database
    .prepare(
      `SELECT c.id,c.pinned_at,c.work_id,c.creator_id,c.character_id,c.root_comment_id,c.reply_to_comment_id,
          target.display_name AS reply_to_display_name,c.user_id,u.display_name AS author_name,u.avatar_blob_sha256 AS author_avatar_blob_sha256,c.body,c.status,
          c.created_at,c.updated_at,c.edited_at,
          0 AS reply_count,
          (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id=c.id) AS like_count,
          ${currentUserId ? "EXISTS(SELECT 1 FROM comment_likes ml WHERE ml.comment_id=c.id AND ml.user_id=?)" : "0"} AS liked_by_me
       FROM comments c
       LEFT JOIN users u ON u.id=c.user_id AND u.status IN ('active','deleted')
       LEFT JOIN comments target_comment ON target_comment.id=c.reply_to_comment_id
       LEFT JOIN users target ON target.id=target_comment.user_id
       WHERE c.root_comment_id=? AND ${visibleReplySql("c", "u")}
       ORDER BY c.created_at ASC,c.id ASC LIMIT ? OFFSET ?`,
    )
    .bind(
      ...(currentUserId
        ? [currentUserId, rootCommentId, limit, offset]
        : [rootCommentId, limit, offset]),
    );
}

export async function searchUserComments(
  runtime: AppRuntime,
  input: {
    userId: number;
    publicOnly?: boolean;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  items: UserCommentSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize ?? 20)));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const publicClause = input.publicOnly
    ? "AND c.id IN (SELECT id FROM public_comments)"
    : "";
  const from = `FROM comments c JOIN users u ON u.id=c.user_id LEFT JOIN comments root ON root.id=COALESCE(c.root_comment_id,c.id) LEFT JOIN works w ON w.id=c.work_id LEFT JOIN creators cr ON cr.id=c.creator_id LEFT JOIN characters ch ON ch.id=c.character_id
    ${DEFAULT_CHARACTER_PORTRAIT_JOINS} AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}
    WHERE c.user_id=? AND c.status<>'deleted' AND root.status<>'deleted' AND ${publicCommentTargetSql("c")} ${publicClause}`;
  const database = getD1(runtime);
  const [countResult, rowsResult] = await database.batch([
    database.prepare(`SELECT COUNT(*) AS count ${from}`).bind(input.userId),
    database
      .prepare(
        `SELECT c.id,c.work_id,c.creator_id,c.character_id,CASE WHEN c.work_id IS NOT NULL THEN COALESCE(w.chinese_title,w.original_title) WHEN c.creator_id IS NOT NULL THEN cr.name ELSE ch.primary_name END AS target_title,
        (SELECT ma.blob_sha256 FROM work_media_assets wma JOIN media_assets ma ON ma.id=wma.media_asset_id WHERE wma.work_id=w.id AND wma.role='cover' ORDER BY wma.sort_order LIMIT 1) AS cover_blob_sha256,
        cr.avatar_blob_sha256,${CHARACTER_PORTRAIT_COLUMNS},
        COALESCE(c.body,'') AS body,c.status,c.updated_at,(SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id=c.id) AS like_count ${from} ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(input.userId, pageSize, (page - 1) * pageSize),
  ]);
  const rows = (rowsResult.results ?? []) as Array<{
    id: number;
    work_id: number | null;
    creator_id: number | null;
    character_id: number | null;
    target_title: string;
    cover_blob_sha256: string | null;
    avatar_blob_sha256: string | null;
    body: string;
    status: "published" | "hidden" | "deleted";
    updated_at: string;
    like_count: number;
  } & CharacterPortraitRow>;
  return {
    items: rows.map((row) => ({
      id: row.id,
      target: commentTarget(row),
      targetTitle: row.target_title,
      coverBlobSha256: row.cover_blob_sha256,
      avatarBlobSha256: row.avatar_blob_sha256,
      portrait: mapCharacterPortrait(row),
      body: emojiText(row.body),
      status: row.status,
      likeCount: row.like_count,
      updatedAt: row.updated_at,
    })),
    total: Number(
      (countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    page,
    pageSize,
  };
}

export async function createComment(
  runtime: AppRuntime,
  target: CommentTarget,
  userId: number,
  bodyInput: unknown,
  replyToCommentId?: number,
): Promise<CommentDto> {
  await assertPublicCommentTarget(runtime, target);
  const body = normalizeCommentBody(bodyInput);
  let rootCommentId: number | null = null;
  let replyToId: number | null = null;
  if (replyToCommentId !== undefined) {
    const replyTarget = await getD1(runtime)
      .prepare(
        `SELECT c.id,c.work_id,c.creator_id,c.character_id,c.root_comment_id,c.status,
        COALESCE(root.status,c.status) AS root_status
        FROM comments c LEFT JOIN comments root ON root.id=c.root_comment_id
        JOIN users author ON author.id=c.user_id
        JOIN users root_author ON root_author.id=COALESCE(root.user_id,c.user_id)
        WHERE c.id=? AND author.status IN ('active','deleted')
          AND root_author.status IN ('active','deleted') LIMIT 1`,
      )
      .bind(replyToCommentId)
      .first<{
        id: number;
        work_id: number | null;
        creator_id: number | null;
        character_id: number | null;
        root_comment_id: number | null;
        status: string;
        root_status: string;
      }>();
    if (
      !replyTarget ||
      !targetMatchesRow(target, replyTarget) ||
      replyTarget.status !== "published" ||
      replyTarget.root_status !== "published"
    )
      throw new HttpError(409, "回复目标不可用");
    rootCommentId = replyTarget.root_comment_id ?? replyTarget.id;
    replyToId = replyTarget.root_comment_id === null ? null : replyTarget.id;
  }
  const db = getD1(runtime);
  await validateBodyEmojis(db, body);
  // The batch holds the write transaction; MAX(id) below is this user's just-inserted row.
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO comments(work_id,creator_id,character_id,user_id,root_comment_id,reply_to_comment_id,body,status)
      VALUES(?,?,?,?,?,?,?,'published') RETURNING id`,
      )
      .bind(
        target.kind === "work" ? target.id : null,
        target.kind === "creator" ? target.id : null,
        target.kind === "character" ? target.id : null,
        userId,
        rootCommentId,
        replyToId,
        body,
      ),
    ...contentEmojiStatements(
      db,
      "comment",
      "SELECT MAX(id) AS id FROM comments WHERE user_id=?",
      [userId],
      body,
      userId,
      true,
    ),
  ]);
  const id = Number((results[0].results[0] as { id: number }).id);
  return requiredComment(runtime, id, userId);
}

export async function updateComment(
  runtime: AppRuntime,
  id: number,
  userId: number,
  bodyInput: unknown,
): Promise<CommentDto> {
  const body = normalizeCommentBody(bodyInput);
  const db = getD1(runtime);
  const previous = await db
    .prepare(
      "SELECT body FROM comments WHERE id=? AND user_id=? AND status IN('published','hidden')",
    )
    .bind(id, userId)
    .first<{ body: string }>();
  if (!previous) throw new HttpError(404, "评论不存在或不可编辑");
  await validateBodyEmojis(db, body, previous.body);
  const source =
    "SELECT id FROM comments WHERE id=? AND user_id=? AND status IN('published','hidden')";
  const results = await db.batch([
    db
      .prepare(
        `UPDATE comments SET body=?,updated_at=CURRENT_TIMESTAMP,edited_at=CURRENT_TIMESTAMP
      WHERE id=? AND user_id=? AND status IN('published','hidden')`,
      )
      .bind(body, id, userId),
    ...contentEmojiStatements(
      db,
      "comment",
      source,
      [id, userId],
      body,
      userId,
      false,
    ),
  ]);
  if ((results[0].meta.changes ?? 0) !== 1)
    throw new HttpError(404, "评论不存在或不可编辑");
  return requiredComment(runtime, id, userId);
}

export async function deleteComment(
  runtime: AppRuntime,
  id: number,
  userId: number,
): Promise<void> {
  const db = getD1(runtime);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE comments SET body=NULL,status='deleted',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND user_id=? AND status<>'deleted'`,
      )
      .bind(id, userId),
    ...contentEmojiStatements(
      db,
      "comment",
      "SELECT id FROM comments WHERE id=? AND user_id=? AND status='deleted'",
      [id, userId],
      "",
      userId,
      false,
    ),
  ]);
  const result = results[0];
  if ((result.meta.changes ?? 0) !== 1)
    throw new HttpError(404, "评论不存在或不可删除");
}

export async function moderateComment(
  runtime: AppRuntime,
  id: number,
  actor: ArchiveUser,
  status: "published" | "hidden",
): Promise<CommentDto> {
  const current = await getD1(runtime)
    .prepare(`SELECT id,user_id,status FROM comments WHERE id=? LIMIT 1`)
    .bind(id)
    .first<{ id: number; user_id: number; status: string }>();
  if (!current || current.status === "deleted")
    throw new HttpError(404, "评论不存在或不可恢复");
  const database = getD1(runtime);
  await database.batch([
    database
      .prepare(
        `UPDATE comments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('published','hidden')`,
      )
      .bind(status, id),
    database
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
         VALUES(?,?,?,?)`,
      )
      .bind(
        actor.id,
        actor.email,
        "comment_moderation",
        JSON.stringify({ commentId: id, from: current.status, to: status }),
      ),
  ]);
  return requiredComment(runtime, id, actor.id);
}

export async function likeComment(
  runtime: AppRuntime,
  id: number,
  userId: number,
): Promise<void> {
  const comment = await publicCommentIdentity(runtime, id);
  await getD1(runtime)
    .prepare(
      `INSERT OR IGNORE INTO comment_likes(comment_id,user_id) VALUES(?,?)`,
    )
    .bind(comment.id, userId)
    .run();
}

export async function unlikeComment(
  runtime: AppRuntime,
  id: number,
  userId: number,
): Promise<void> {
  await getD1(runtime)
    .prepare(`DELETE FROM comment_likes WHERE comment_id=? AND user_id=?`)
    .bind(id, userId)
    .run();
}

async function publicCommentIdentity(
  runtime: AppRuntime,
  id: number,
): Promise<{ id: number }> {
  const row = await getD1(runtime)
    .prepare(
      `SELECT c.id FROM comments c JOIN users u ON u.id=c.user_id
       LEFT JOIN comments root ON root.id=COALESCE(c.root_comment_id,c.id)
       JOIN users root_user ON root_user.id=root.user_id
       WHERE c.id=? AND c.id IN (SELECT id FROM public_comments)
         AND u.status IN ('active','deleted') AND root_user.status IN ('active','deleted')
         AND root.status='published' LIMIT 1`,
    )
    .bind(id)
    .first<{ id: number }>();
  if (!row) throw new HttpError(404, "评论不存在");
  return row;
}

async function requiredComment(
  runtime: AppRuntime,
  id: number,
  viewerId: number | null,
): Promise<CommentDto> {
  const row = await getD1(runtime)
    .prepare(
      `SELECT c.id,c.pinned_at,c.work_id,c.creator_id,c.character_id,c.root_comment_id,c.reply_to_comment_id,
          ${commentFloorSql()} AS floor_number,
          target.display_name AS reply_to_display_name,c.user_id,u.display_name AS author_name,u.avatar_blob_sha256 AS author_avatar_blob_sha256,c.body,c.status,
          c.created_at,c.updated_at,c.edited_at,
          (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id=c.id) AS like_count,
          ${viewerId ? "EXISTS(SELECT 1 FROM comment_likes ml WHERE ml.comment_id=c.id AND ml.user_id=?)" : "0"} AS liked_by_me
       FROM comments c
       LEFT JOIN users u ON u.id=c.user_id
       LEFT JOIN comments target_comment ON target_comment.id=c.reply_to_comment_id
       LEFT JOIN users target ON target.id=target_comment.user_id
       WHERE c.id=? LIMIT 1`,
    )
    .bind(...(viewerId ? [viewerId, id] : [id]))
    .first<CommentRow>();
  if (!row) throw new HttpError(404, "评论不存在");
  return mapComment(row, viewerId, await emojiMap(runtime, [row]));
}

async function assertPublicCommentTarget(
  runtime: AppRuntime,
  target: CommentTarget,
): Promise<void> {
  const row = await publicTargetStatement(getD1(runtime), target).first<{
    id: number;
  }>();
  if (!row)
    throw new HttpError(
      404,
      target.kind === "work"
        ? "作品不存在"
        : target.kind === "creator"
          ? "作者不存在"
          : "角色不存在",
    );
}

function publicTargetStatement(
  database: D1Database,
  target: CommentTarget,
): D1PreparedStatement {
  if (target.kind === "character")
    return database
      .prepare("SELECT id FROM characters WHERE id=? LIMIT 1")
      .bind(target.id);
  return target.kind === "work"
    ? database
        .prepare(
          `SELECT id FROM public_works WHERE id=? LIMIT 1`,
        )
        .bind(target.id)
    : database
        .prepare(
          `SELECT c.id FROM creators c
           WHERE c.id=? AND EXISTS (
             SELECT 1 FROM work_staff ws JOIN works w ON w.id=ws.work_id
             WHERE ws.creator_id=c.id AND w.id IN (SELECT id FROM public_works)
           ) LIMIT 1`,
        )
        .bind(target.id);
}

function publicCommentTargetSql(alias: string): string {
  return `(
    EXISTS (SELECT 1 FROM works public_work WHERE public_work.id=${alias}.work_id AND public_work.id IN (SELECT id FROM public_works))
    OR EXISTS (
      SELECT 1 FROM work_staff public_staff
      JOIN works public_creator_work ON public_creator_work.id=public_staff.work_id
      WHERE public_staff.creator_id=${alias}.creator_id AND public_creator_work.id IN (SELECT id FROM public_works)
    )
    OR EXISTS (SELECT 1 FROM characters public_character WHERE public_character.id=${alias}.character_id)
  )`;
}

function targetMatchesRow(
  target: CommentTarget,
  row: Pick<CommentRow, "work_id" | "creator_id" | "character_id">,
): boolean {
  const actual = commentTarget(row);
  return actual.kind === target.kind && actual.id === target.id;
}

function commentTarget(
  row: Pick<CommentRow, "work_id" | "creator_id" | "character_id">,
): CommentTarget {
  if (
    row.work_id !== null &&
    row.creator_id === null &&
    row.character_id === null
  )
    return { kind: "work", id: row.work_id };
  if (
    row.creator_id !== null &&
    row.work_id === null &&
    row.character_id === null
  )
    return { kind: "creator", id: row.creator_id };
  if (
    row.character_id !== null &&
    row.work_id === null &&
    row.creator_id === null
  )
    return { kind: "character", id: row.character_id };
  throw new Error("评论目标不合法");
}

async function emojiMap(
  runtime: AppRuntime,
  rows: CommentRow[],
): Promise<Map<number, FaceEmoji>> {
  return new Map(
    (
      await bodyEmojis(
        getD1(runtime),
        rows.map((row) => row.body),
      )
    ).map((emoji) => [emoji.id, emoji]),
  );
}

// Number all roots, including hidden/deleted ones, so moderation never renumbers a floor.
function commentFloorSql(): string {
  return `CASE WHEN c.root_comment_id IS NULL THEN (
    SELECT COUNT(*) FROM comments floor
    WHERE floor.root_comment_id IS NULL
      AND (floor.work_id=c.work_id OR floor.creator_id=c.creator_id OR floor.character_id=c.character_id)
      AND (floor.created_at<c.created_at OR (floor.created_at=c.created_at AND floor.id<=c.id))
  ) ELSE NULL END`;
}

function mapComment(
  row: CommentRow,
  viewerId: number | null,
  emojis: Map<number, FaceEmoji>,
): CommentDto {
  const deleted = row.status === "deleted";
  return {
    id: row.id,
    floorNumber: row.floor_number ?? null,
    pinned: !!row.pinned_at,
    target: commentTarget(row),
    rootCommentId: row.root_comment_id,
    replyTo: row.reply_to_comment_id
      ? {
          commentId: row.reply_to_comment_id,
          displayName: row.reply_to_display_name,
        }
      : null,
    author: row.author_name
      ? {
          id: row.user_id,
          displayName: row.author_name,
          avatarBlobSha256: row.author_avatar_blob_sha256,
        }
      : null,
    body: deleted
      ? [{ type: "text", text: "该评论已删除" }]
      : tokenizeBody(row.body ?? "", emojis),
    ...(viewerId !== null && row.user_id === viewerId
      ? { bodySource: row.body }
      : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at,
    likeCount: row.like_count ?? 0,
    likedByMe: row.liked_by_me === 1,
    ...(row.reply_count === undefined ? {} : { replyCount: row.reply_count }),
    ...(row.root_status && row.root_status !== "published"
      ? { rootDeleted: row.root_status === "deleted" }
      : {}),
  };
}

function tokenizeBody(
  value: string,
  emojis: Map<number, FaceEmoji>,
): CommentBodySegment[] {
  const result: CommentBodySegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(FACE_EMOJI_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor)
      result.push({ type: "text", text: value.slice(cursor, index) });
    result.push({ type: "emoji", emoji: emojis.get(Number(match[1])) ?? null });
    cursor = index + match[0].length;
  }
  if (cursor < value.length)
    result.push({ type: "text", text: value.slice(cursor) });
  return result.length ? result : [{ type: "text", text: "" }];
}

function normalizeCommentBody(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "评论正文必须是文本");
  const body = value.replace(/\r\n?/g, "\n").trim();
  if (!body) throw new HttpError(400, "评论正文不能为空");
  if (bodyLength(body) > MAX_COMMENT_LENGTH)
    throw new HttpError(400, "评论正文过长");
  return body;
}

async function pageFromRows(
  runtime: AppRuntime,
  rows: CommentRow[],
  size: number,
  viewerId: number | null,
  cursorField: "created_at" | "updated_at" = "created_at",
): Promise<CommentPage> {
  const hasMore = rows.length > size;
  const items = rows.slice(0, size);
  const emojis = await emojiMap(runtime, items);
  return {
    items: items.map((row) => mapComment(row, viewerId, emojis)),
    nextCursor:
      hasMore && items.length
        ? encodeCursor(
            items[items.length - 1][cursorField],
            items[items.length - 1].id,
          )
        : null,
  };
}

function clampPageSize(value: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(20, Math.floor(value)))
    : 20;
}

function encodeCursor(createdAt: string, id: number): string {
  return encodeURIComponent(`${createdAt}|${id}`);
}

function decodeCursor(
  value: string | null,
): { createdAt: string; id: number } | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value);
  const split = decoded.lastIndexOf("|");
  const id = Number(decoded.slice(split + 1));
  if (split <= 0 || !Number.isSafeInteger(id) || id <= 0)
    throw new HttpError(400, "cursor 不合法");
  return { createdAt: decoded.slice(0, split), id };
}
