import {
  FACE_EMOJI_PATTERN,
  emojiIds,
  type FaceEmoji,
  type FaceEmojiCell,
  type EmojiCharacter,
  type EmojiCategory,
  type EmojiSheet,
} from "@/lib/face-emojis";
import { HttpError } from "@/lib/http";
import {
  CHARACTER_PORTRAIT_COLUMNS,
  DEFAULT_CHARACTER_PORTRAIT_JOINS,
  PUBLIC_CHARACTER_PORTRAIT_CONDITION,
  mapCharacterPortrait,
  type CharacterPortraitRow,
} from "@/app/.server/db/character-portrait-library";

const columns = `e.id,e.blob_sha256 AS blobSha256,e.cell_row AS row,e.cell_column AS column,
 e.width_px AS width,e.height_px AS height,EXISTS(SELECT 1 FROM available_face_emojis a WHERE a.id=e.id) AS available`;
type Row = Omit<FaceEmoji, "available" | "sources"> & { available: number };
export async function readEmojis(
  db: D1Database,
  ids: number[],
): Promise<FaceEmoji[]> {
  if (!ids.length) return [];
  const [rows, sources] = await db.batch([
    db
      .prepare(
        `SELECT ${columns} FROM face_emoji_refs e WHERE e.id IN(SELECT value FROM json_each(?))`,
      )
      .bind(JSON.stringify(ids)),
    db
      .prepare(
        `SELECT DISTINCT e.id AS emojiId,ch.id,ch.primary_name AS name FROM face_emoji_refs e
      JOIN face_sheets fs ON fs.blob_sha256=e.blob_sha256
      JOIN character_face_sheet_bindings binding ON binding.face_sheet_id=fs.id
      JOIN characters ch ON ch.id=binding.character_id
      WHERE e.id IN(SELECT value FROM json_each(?)) ORDER BY ch.primary_name,ch.id`,
      )
      .bind(JSON.stringify(ids)),
  ]);
  const sourceMap = new Map<number, FaceEmoji["sources"]>();
  for (const row of sources.results as {
    emojiId: number;
    id: number;
    name: string;
  }[]) {
    const list = sourceMap.get(row.emojiId) ?? [];
    list.push({ id: row.id, name: row.name });
    sourceMap.set(row.emojiId, list);
  }
  const map = new Map(
    (rows.results as Row[]).map((row) => [
      row.id,
      {
        ...row,
        available: !!row.available,
        sources: sourceMap.get(row.id) ?? [],
      },
    ]),
  );
  return ids.flatMap((id) => (map.has(id) ? [map.get(id)!] : []));
}
export async function bodyEmojis(db: D1Database, bodies: (string | null)[]) {
  return readEmojis(db, [
    ...new Set(bodies.flatMap((body) => emojiIds(body ?? ""))),
  ]);
}
export async function validateBodyEmojis(
  db: D1Database,
  body: string,
  previous = "",
) {
  if (
    [...body.matchAll(FACE_EMOJI_PATTERN)].some(
      (match) => !Number.isSafeInteger(Number(match[1])),
    )
  )
    throw new HttpError(400, "表情引用无效。");
  const old = new Set(emojiIds(previous));
  const ids = emojiIds(body).filter((id) => !old.has(id));
  const rows = await readEmojis(db, ids);
  if (rows.length !== ids.length || rows.some((e) => !e.available))
    throw new HttpError(400, "正文包含不可用的表情，请移除后重试。");
}
export async function defaults(db: D1Database) {
  const rows = await db
    .prepare("SELECT emoji_id AS id FROM default_face_emojis ORDER BY position")
    .all<{ id: number }>();
  return readEmojis(
    db,
    rows.results.map((r) => r.id),
  );
}
export async function library(db: D1Database, userId: number) {
  const rows = await db
    .prepare(
      "SELECT emoji_id AS id FROM user_face_emojis WHERE user_id=? ORDER BY touched_at DESC,position,emoji_id",
    )
    .bind(userId)
    .all<{ id: number }>();
  return readEmojis(
    db,
    rows.results.map((r) => r.id),
  );
}
export async function initializeLibrary(
  db: D1Database,
  userId: number,
  replenish = false,
) {
  const token = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO user_emoji_library_state(user_id,initialization_token) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING",
      )
      .bind(userId, token),
    db
      .prepare(
        `UPDATE user_emoji_library_state SET activity=activity+1 WHERE user_id=? AND (?=1 OR initialization_token=?)`,
      )
      .bind(userId, replenish ? 1 : 0, token),
    db
      .prepare(
        `INSERT INTO user_face_emojis(user_id,emoji_id,touched_at,position)
      SELECT s.user_id,d.emoji_id,s.activity,d.position FROM user_emoji_library_state s,default_face_emojis d
      JOIN available_face_emojis a ON a.id=d.emoji_id
      WHERE s.user_id=? AND (?=1 OR s.initialization_token=?)
      AND NOT EXISTS(SELECT 1 FROM user_face_emojis mine WHERE mine.user_id=s.user_id AND mine.emoji_id=d.emoji_id)`,
      )
      .bind(userId, replenish ? 1 : 0, token),
  ]);
}
export function parseCells(value: unknown): FaceEmojiCell[] {
  if (!Array.isArray(value) || value.length > 256)
    throw new HttpError(400, "每次最多选择 256 个表情。");
  const cells = value as FaceEmojiCell[];
  if (
    cells.some(
      (c) =>
        !c ||
        !/^[a-f0-9]{64}$/.test(c.blobSha256) ||
        !Number.isInteger(c.row) ||
        !Number.isInteger(c.column) ||
        c.row < 0 ||
        c.row > 3 ||
        c.column < 0 ||
        c.column > 3,
    )
  )
    throw new HttpError(400, "脸图格子无效。");
  return [
    ...new Map(
      cells.map((c) => [`${c.blobSha256}:${c.row}:${c.column}`, c]),
    ).values(),
  ];
}
export function parseIds(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    value.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new HttpError(400, "表情集合无效。");
  return [...new Set(value as number[])];
}
async function registerCells(db: D1Database, cells: FaceEmojiCell[]) {
  if (!cells.length) return [];
  const input = JSON.stringify(cells);
  const valid = await db
    .prepare(
      `SELECT count(*) AS n FROM json_each(?) j JOIN face_sheets fs ON fs.blob_sha256=json_extract(j.value,'$.blobSha256')
    JOIN blobs b ON b.sha256=fs.blob_sha256 WHERE fs.library_status='approved' AND b.status='active'
    AND json_extract(j.value,'$.row')*48<fs.height_px AND json_extract(j.value,'$.column')*48<fs.width_px`,
    )
    .bind(input)
    .first<{ n: number }>();
  if (valid?.n !== cells.length)
    throw new HttpError(400, "部分脸图已不可用，请重新选择。");
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO face_emoji_refs(blob_sha256,cell_row,cell_column,width_px,height_px)
      SELECT fs.blob_sha256,json_extract(j.value,'$.row'),json_extract(j.value,'$.column'),fs.width_px,fs.height_px
      FROM json_each(?) j JOIN face_sheets fs ON fs.blob_sha256=json_extract(j.value,'$.blobSha256')
      WHERE 1 ON CONFLICT(blob_sha256,cell_row,cell_column) DO NOTHING`,
      )
      .bind(input),
    db
      .prepare(
        `SELECT e.id FROM json_each(?) j JOIN face_emoji_refs e ON e.blob_sha256=json_extract(j.value,'$.blobSha256')
      AND e.cell_row=json_extract(j.value,'$.row') AND e.cell_column=json_extract(j.value,'$.column') ORDER BY CAST(j.key AS INTEGER)`,
      )
      .bind(input),
  ]);
  return (result[1].results as { id: number }[]).map((row) => row.id);
}
export async function addEmojis(
  db: D1Database,
  userId: number,
  cells: FaceEmojiCell[],
) {
  const ids = await registerCells(db, cells);
  await initializeLibrary(db, userId);
  await db.batch([
    db
      .prepare(
        "UPDATE user_emoji_library_state SET activity=activity+1 WHERE user_id=?",
      )
      .bind(userId),
    db
      .prepare(
        `INSERT INTO user_face_emojis(user_id,emoji_id,touched_at,position)
      SELECT s.user_id,j.value,s.activity,CAST(j.key AS INTEGER) FROM user_emoji_library_state s,json_each(?) j
      WHERE s.user_id=? AND NOT EXISTS(SELECT 1 FROM user_face_emojis mine WHERE mine.user_id=s.user_id AND mine.emoji_id=j.value)`,
      )
      .bind(JSON.stringify(ids), userId),
  ]);
  return library(db, userId);
}
export async function removeEmojis(
  db: D1Database,
  userId: number,
  ids: number[],
) {
  await db
    .prepare(
      "DELETE FROM user_face_emojis WHERE user_id=? AND emoji_id IN(SELECT value FROM json_each(?))",
    )
    .bind(userId, JSON.stringify(ids))
    .run();
}
export async function reorderEmoji(
  db: D1Database,
  userId: number,
  emojiId: number,
  beforeId: number | null,
) {
  // Use the current library order inside the transaction, so another device's
  // additions/removals are preserved. Only the moved emoji changes its place.
  const owned = `EXISTS(SELECT 1 FROM user_face_emojis WHERE user_id=? AND emoji_id=?)
    AND (? IS NULL OR EXISTS(SELECT 1 FROM user_face_emojis WHERE user_id=? AND emoji_id=?))`;
  const ownershipArgs = [userId, emojiId, beforeId, userId, beforeId];
  const result = await db.batch([
    db
      .prepare(
        `UPDATE user_emoji_library_state SET activity=activity+1 WHERE user_id=? AND ${owned}`,
      )
      .bind(userId, ...ownershipArgs),
    db
      .prepare(
        `WITH ordered AS MATERIALIZED (
      SELECT emoji_id,ROW_NUMBER() OVER(ORDER BY touched_at DESC,position,emoji_id)-1 AS ordinal
      FROM user_face_emojis WHERE user_id=?
    ), destination AS (
      SELECT CASE WHEN ? IS NULL THEN (SELECT COUNT(*) FROM ordered)
        ELSE (SELECT ordinal FROM ordered WHERE emoji_id=?) END AS ordinal
    ), reordered AS MATERIALIZED (
      SELECT emoji_id,ROW_NUMBER() OVER(ORDER BY
        CASE WHEN emoji_id=? THEN (SELECT ordinal FROM destination) ELSE ordinal END,
        CASE WHEN emoji_id=? THEN 0 ELSE 1 END)-1 AS position FROM ordered
    ) UPDATE user_face_emojis
      SET touched_at=(SELECT activity FROM user_emoji_library_state WHERE user_id=?),
        position=(SELECT position FROM reordered WHERE reordered.emoji_id=user_face_emojis.emoji_id)
      WHERE user_id=? AND ${owned}`,
      )
      .bind(
        userId,
        beforeId,
        beforeId,
        emojiId,
        emojiId,
        userId,
        userId,
        ...ownershipArgs,
      ),
  ]);
  if (!result[1].meta.changes)
    throw new HttpError(409, "表情库已变化，请刷新后重试。");
}
export async function saveDefaults(
  db: D1Database,
  userId: number,
  cells: FaceEmojiCell[],
) {
  const ids = await registerCells(db, cells);
  await db.batch([
    db.prepare("DELETE FROM default_face_emojis"),
    db
      .prepare(
        "INSERT INTO default_face_emojis(emoji_id,position) SELECT value,CAST(key AS INTEGER) FROM json_each(?)",
      )
      .bind(JSON.stringify(ids)),
    db
      .prepare(
        "INSERT INTO auth_audit_logs(user_id,event_type,detail_json) VALUES(?,'emoji.defaults.update',?)",
      )
      .bind(userId, JSON.stringify({ ids })),
  ]);
}
export async function searchEmojiCharacters(
  db: D1Database,
  query: string,
  offset: number,
  categoryId: string | null = null,
) {
  const pattern = `%${query
    .trim()
    .slice(0, 100)
    .replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .prepare(
      `SELECT ch.id,COALESCE(cm.display_name,ch.primary_name) AS name,COALESCE(cm.original_name,ch.original_name) AS originalName,
      COALESCE(cm.sort_order,ch.id) AS sortOrder,
      (SELECT json_group_array(category_id) FROM character_category_memberships WHERE character_id=ch.id) AS categoryIds,
      ${CHARACTER_PORTRAIT_COLUMNS}
      FROM characters ch LEFT JOIN character_category_memberships cm ON cm.character_id=ch.id AND cm.category_id=?
      ${DEFAULT_CHARACTER_PORTRAIT_JOINS} AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}
    WHERE (ch.primary_name LIKE ? ESCAPE '\\' OR ch.original_name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM character_aliases ca WHERE ca.character_id=ch.id AND ca.name LIKE ? ESCAPE '\\'))
    AND (? IS NULL OR (?='' AND NOT EXISTS(SELECT 1 FROM character_category_memberships WHERE character_id=ch.id)) OR cm.category_id=?)
    AND EXISTS(SELECT 1 FROM character_face_sheet_bindings cb JOIN face_sheets fs ON fs.id=cb.face_sheet_id JOIN blobs b ON b.sha256=fs.blob_sha256 WHERE cb.character_id=ch.id AND fs.library_status='approved' AND b.status='active')
    ORDER BY CASE WHEN ? IS NOT NULL THEN cm.sort_order END,ch.primary_name,ch.id LIMIT 25 OFFSET ?`,
    )
    .bind(
      categoryId,
      pattern,
      pattern,
      pattern,
      categoryId,
      categoryId,
      categoryId,
      categoryId,
      offset,
    )
    .all<
      Omit<EmojiCharacter, "categoryIds"> &
        CharacterPortraitRow & { categoryIds: string }
    >();
  return {
    items: rows.results.slice(0, 24).map((row) => ({
      id: row.id,
      name: row.name,
      originalName: row.originalName,
      sortOrder: row.sortOrder,
      defaultPortrait: mapCharacterPortrait(row),
      categoryIds: JSON.parse(row.categoryIds) as string[],
    })),
    more: rows.results.length > 24,
  };
}
export async function emojiCategories(db: D1Database) {
  const result = await db
    .prepare(
      `WITH RECURSIVE used(id) AS (
    SELECT DISTINCT cm.category_id FROM character_category_memberships cm
    JOIN character_face_sheet_bindings cb ON cb.character_id=cm.character_id
    JOIN face_sheets fs ON fs.id=cb.face_sheet_id JOIN blobs b ON b.sha256=fs.blob_sha256
    WHERE fs.library_status='approved' AND b.status='active'
    UNION SELECT c.parent_id FROM character_categories c JOIN used ON used.id=c.id WHERE c.parent_id IS NOT NULL
  ) SELECT id,parent_id AS parentId,label,sort_order AS sortOrder FROM character_categories WHERE id IN(SELECT id FROM used) ORDER BY sort_order,id`,
    )
    .all<EmojiCategory>();
  return result.results;
}
export async function characterSheets(
  db: D1Database,
  characterId: number,
  offset: number,
  focus = "",
) {
  const order =
    "cb.sort_order IS NULL,cb.sort_order,fs.source_order IS NULL,fs.source_order,fs.id";
  const from = `FROM face_sheets fs JOIN character_face_sheet_bindings cb ON cb.face_sheet_id=fs.id JOIN blobs b ON b.sha256=fs.blob_sha256
    WHERE cb.character_id=? AND fs.library_status='approved' AND b.status='active' AND b.content_type_hint LIKE 'image/%'`;
  if (focus) {
    const target = await db
      .prepare(
        `SELECT position FROM (
      SELECT fs.blob_sha256,ROW_NUMBER() OVER(ORDER BY ${order})-1 AS position ${from}
    ) WHERE blob_sha256=?`,
      )
      .bind(characterId, focus)
      .first<{ position: number }>();
    if (target) offset = Math.floor(target.position / 24) * 24;
  }
  const rows = await db
    .prepare(
      `SELECT fs.id,fs.blob_sha256 AS blobSha256,fs.width_px AS width,fs.height_px AS height
    ${from} ORDER BY ${order} LIMIT 25 OFFSET ?`,
    )
    .bind(characterId, offset)
    .all<EmojiSheet>();
  return {
    items: rows.results.slice(0, 24),
    more: rows.results.length > 24,
    offset,
  };
}
export async function hotEmojis(db: D1Database, offset: number) {
  const rows = await db
    .prepare(
      `WITH uses AS (
    SELECT r.emoji_id,c.user_id,c.created_at FROM comment_face_emojis r JOIN comments c ON c.id=r.content_id
    JOIN comments root ON root.id=COALESCE(c.root_comment_id,c.id)
    JOIN users u ON u.id=c.user_id JOIN users ru ON ru.id=root.user_id
    WHERE c.status='published' AND root.status='published' AND u.status IN('active','deleted') AND ru.status IN('active','deleted')
      AND (EXISTS(SELECT 1 FROM works w WHERE w.id=c.work_id AND w.status='published')
      OR EXISTS(SELECT 1 FROM work_staff ws JOIN works w ON w.id=ws.work_id WHERE ws.creator_id=c.creator_id AND w.status='published')
      OR EXISTS(SELECT 1 FROM characters ch WHERE ch.id=c.character_id))
    UNION ALL SELECT r.emoji_id,p.user_id,p.created_at FROM forum_post_face_emojis r JOIN forum_public_posts p ON p.id=r.content_id
    UNION ALL SELECT r.emoji_id,c.user_id,c.created_at FROM forum_comment_face_emojis r JOIN forum_public_comments c ON c.id=r.content_id
  ) SELECT u.emoji_id AS id,COUNT(DISTINCT u.user_id) AS users FROM uses u JOIN available_face_emojis e ON e.id=u.emoji_id
    WHERE u.created_at>=datetime('now','-30 days') GROUP BY u.emoji_id
    ORDER BY users DESC,MAX(u.created_at) DESC,u.emoji_id LIMIT 49 OFFSET ?`,
    )
    .bind(offset)
    .all<{ id: number; users: number }>();
  const entries = rows.results.slice(0, 48);
  const emojis = await readEmojis(
    db,
    entries.map((r) => r.id),
  );
  return {
    items: emojis.map((e, i) => ({ ...e, users: entries[i].users })),
    more: rows.results.length > 48,
  };
}

/** Run in the content mutation's batch; source is gated by its write revision/owner. */
export function contentEmojiStatements(
  db: D1Database,
  kind: "comment" | "post" | "forumComment",
  source: string,
  args: (string | number)[],
  body: string,
  userId: number,
  publish: boolean,
) {
  const table = {
    comment: "comment_face_emojis",
    post: "forum_post_face_emojis",
    forumComment: "forum_comment_face_emojis",
  }[kind];
  const ids = JSON.stringify(emojiIds(body));
  const statements = [
    db
      .prepare(
        `DELETE FROM ${table} WHERE content_id IN(${source}) AND emoji_id NOT IN(SELECT value FROM json_each(?))`,
      )
      .bind(...args, ids),
    db
      .prepare(
        `INSERT INTO ${table}(content_id,emoji_id) SELECT s.id,j.value FROM (${source}) s,json_each(?) j
      WHERE NOT EXISTS(SELECT 1 FROM ${table} r WHERE r.content_id=s.id AND r.emoji_id=j.value)`,
      )
      .bind(...args, ids),
  ];
  if (publish && ids !== "[]")
    statements.push(
      db
        .prepare(
          `UPDATE user_emoji_library_state SET activity=activity+1 WHERE user_id=? AND EXISTS(${source})`,
        )
        .bind(userId, ...args),
      db
        .prepare(
          `UPDATE user_face_emojis SET touched_at=(SELECT activity FROM user_emoji_library_state WHERE user_id=?),
      position=(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=emoji_id)
      WHERE user_id=? AND emoji_id IN(SELECT value FROM json_each(?)) AND EXISTS(${source})`,
        )
        .bind(userId, ids, userId, ids, ...args),
    );
  return statements;
}
