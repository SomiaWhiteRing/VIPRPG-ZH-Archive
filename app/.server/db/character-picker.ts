import type { EmojiCategory, EmojiCharacter } from "@/lib/face-emojis";
import {
  CHARACTER_PORTRAIT_COLUMNS,
  DEFAULT_CHARACTER_PORTRAIT_JOINS,
  PUBLIC_CHARACTER_PORTRAIT_CONDITION,
  mapCharacterPortrait,
  type CharacterPortraitRow,
} from "./character-portrait-library";

const availableFaces = `EXISTS(SELECT 1 FROM character_face_sheet_bindings cb
  JOIN face_sheets fs ON fs.id=cb.face_sheet_id JOIN blobs b ON b.sha256=fs.blob_sha256
  WHERE cb.character_id=ch.id AND fs.library_status='approved' AND b.status='active')`;

export async function readCharacterPickerPage(
  db: D1Database,
  query: string,
  offset: number,
  categoryId: string | null = null,
  requireFaces = false,
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
    ${requireFaces ? `AND ${availableFaces}` : ""}
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
        CharacterPortraitRow & { categoryIds: string; sortOrder: number }
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

export async function readCharacterPickerCategories(
  db: D1Database,
  requireFaces = false,
) {
  const result = await db
    .prepare(
      `WITH RECURSIVE used(id) AS (
      SELECT DISTINCT cm.category_id FROM character_category_memberships cm
      JOIN characters ch ON ch.id=cm.character_id
      ${requireFaces ? `WHERE ${availableFaces}` : ""}
      UNION SELECT c.parent_id FROM character_categories c JOIN used ON used.id=c.id WHERE c.parent_id IS NOT NULL
    ) SELECT id,parent_id AS parentId,label,sort_order AS sortOrder FROM character_categories WHERE id IN(SELECT id FROM used) ORDER BY sort_order,id`,
    )
    .all<EmojiCategory>();
  return result.results;
}
