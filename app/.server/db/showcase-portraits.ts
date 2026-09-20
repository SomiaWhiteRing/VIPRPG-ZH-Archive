import type { CharacterPortraitChoice } from "@/lib/character-names";
import type { ShowcasePortraitPage } from "@/lib/showcase";
import { PUBLIC_CHARACTER_PORTRAIT_CONDITION } from "./character-portrait-library";

const portraitSource = `FROM face_sheets portrait_sheet
  JOIN character_face_sheet_bindings binding ON binding.face_sheet_id=portrait_sheet.id
  WHERE binding.character_id=? AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}`;

export async function readShowcasePortraitSheets(
  db: D1Database,
  characterId: number,
  offset: number,
) {
  const rows = await db
    .prepare(
      `SELECT portrait_sheet.id,portrait_sheet.blob_sha256 AS blobSha256,
    portrait_sheet.width_px AS width,portrait_sheet.height_px AS height
    ${portraitSource}
    ORDER BY binding.sort_order IS NULL,binding.sort_order,portrait_sheet.source_order IS NULL,portrait_sheet.source_order,portrait_sheet.id
    LIMIT 13 OFFSET ?`,
    )
    .bind(characterId, offset)
    .all<ShowcasePortraitPage["items"][number]>();
  return { items: rows.results.slice(0, 12), more: rows.results.length > 12 };
}

export async function showcasePortraitAvailable(
  db: D1Database,
  characterId: number,
  portrait: CharacterPortraitChoice,
) {
  return !!(await db
    .prepare(
      `SELECT portrait_sheet.id ${portraitSource}
    AND portrait_sheet.blob_sha256=? AND ?<portrait_sheet.height_px/48 AND ?<portrait_sheet.width_px/48`,
    )
    .bind(characterId, portrait.blobSha256, portrait.row, portrait.column)
    .first());
}

export function registerShowcasePortrait(
  db: D1Database,
  userId: number,
  characterId: number,
  portrait: CharacterPortraitChoice,
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO character_portrait_refs(character_id,face_sheet_id,cell_row,cell_column,created_by_user_id)
    SELECT ?,portrait_sheet.id,?,?,? ${portraitSource}
    AND portrait_sheet.blob_sha256=? AND ?<portrait_sheet.height_px/48 AND ?<portrait_sheet.width_px/48`,
    )
    .bind(
      characterId,
      portrait.row,
      portrait.column,
      userId,
      characterId,
      portrait.blobSha256,
      portrait.row,
      portrait.column,
    );
}

// A missing or newly hidden choice becomes an invalid FK, aborting the save batch.
export const SHOWCASE_PORTRAIT_REF_QUERY = `COALESCE((SELECT portrait_ref.id
  FROM character_portrait_refs portrait_ref
  JOIN face_sheets portrait_sheet ON portrait_sheet.id=portrait_ref.face_sheet_id
  JOIN character_face_sheet_bindings binding ON binding.face_sheet_id=portrait_sheet.id AND binding.character_id=portrait_ref.character_id
  WHERE portrait_ref.character_id=? AND portrait_sheet.blob_sha256=?
    AND portrait_ref.cell_row=? AND portrait_ref.cell_column=?
    AND portrait_ref.cell_row<portrait_sheet.height_px/48 AND portrait_ref.cell_column<portrait_sheet.width_px/48
    AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}),-1)`;
