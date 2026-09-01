import type {
  CharacterFaceSheet,
  CharacterPortrait,
  CharacterPortraitChoice,
} from "@/lib/character-names";
import { getD1 } from "@/lib/server/db/d1";
import { HttpError } from "@/lib/server/http/json";

export type AdminFaceSheet = CharacterFaceSheet & {
  sourcePageUrl: string | null;
  sourceImageUrl: string | null;
  libraryStatus: "pending" | "approved" | "rejected";
};

export type AdminCharacterPortraitLibrary = {
  sheets: AdminFaceSheet[];
  boundSheetIds: number[];
  defaultPortrait: CharacterPortrait | null;
};

export type CharacterPortraitRow = {
  portrait_face_sheet_id: number | null;
  portrait_blob_sha256: string | null;
  portrait_width_px: number | null;
  portrait_height_px: number | null;
  portrait_cell_row: number | null;
  portrait_cell_column: number | null;
};

export const DEFAULT_CHARACTER_PORTRAIT_JOINS = `
  LEFT JOIN character_default_portraits cdp ON cdp.character_id=ch.id
  LEFT JOIN character_portrait_refs portrait_ref ON portrait_ref.id=cdp.portrait_ref_id
  LEFT JOIN face_sheets portrait_sheet ON portrait_sheet.id=portrait_ref.face_sheet_id`;

export const WORK_CHARACTER_PORTRAIT_JOINS = `
  LEFT JOIN character_default_portraits cdp ON cdp.character_id=c.id
  LEFT JOIN character_portrait_refs portrait_ref
    ON portrait_ref.id=COALESCE(wc.portrait_ref_id,cdp.portrait_ref_id)
  LEFT JOIN face_sheets portrait_sheet ON portrait_sheet.id=portrait_ref.face_sheet_id`;

export const CHARACTER_PORTRAIT_COLUMNS = `
  portrait_sheet.id AS portrait_face_sheet_id,
  portrait_sheet.blob_sha256 AS portrait_blob_sha256,
  portrait_sheet.width_px AS portrait_width_px,
  portrait_sheet.height_px AS portrait_height_px,
  portrait_ref.cell_row AS portrait_cell_row,
  portrait_ref.cell_column AS portrait_cell_column`;

export function mapCharacterPortrait(row: CharacterPortraitRow): CharacterPortrait | null {
  if (
    row.portrait_face_sheet_id === null ||
    !row.portrait_blob_sha256 ||
    row.portrait_width_px === null ||
    row.portrait_height_px === null ||
    row.portrait_cell_row === null ||
    row.portrait_cell_column === null
  ) {
    return null;
  }
  return {
    faceSheetId: row.portrait_face_sheet_id,
    blobSha256: row.portrait_blob_sha256,
    width: row.portrait_width_px,
    height: row.portrait_height_px,
    row: row.portrait_cell_row,
    column: row.portrait_cell_column,
  };
}

export async function getCharacterPortraitLibraryForAdmin(
  characterId: number,
): Promise<AdminCharacterPortraitLibrary> {
  const database = getD1();
  const [sheetsResult, bindingsResult, defaultResult] = await database.batch([
    database.prepare(
      `SELECT id,blob_sha256,width_px,height_px,source_page_url,source_image_url,
              source_page_title,source_section_title,library_status
       FROM face_sheets
       WHERE library_status!='rejected'
       ORDER BY CASE library_status WHEN 'approved' THEN 0 ELSE 1 END,
                source_page_title,id`,
    ),
    database.prepare(
      `SELECT face_sheet_id FROM character_face_sheet_bindings
       WHERE character_id=? ORDER BY face_sheet_id`,
    ).bind(characterId),
    database.prepare(
      `SELECT fs.id AS portrait_face_sheet_id,fs.blob_sha256 AS portrait_blob_sha256,
              fs.width_px AS portrait_width_px,fs.height_px AS portrait_height_px,
              cpr.cell_row AS portrait_cell_row,cpr.cell_column AS portrait_cell_column
       FROM character_default_portraits cdp
       JOIN character_portrait_refs cpr ON cpr.id=cdp.portrait_ref_id
       JOIN face_sheets fs ON fs.id=cpr.face_sheet_id
       WHERE cdp.character_id=? LIMIT 1`,
    ).bind(characterId),
  ]);
  const defaultRow = (defaultResult.results?.[0] ?? null) as CharacterPortraitRow | null;
  return {
    sheets: (sheetsResult.results ?? []).map((row) => {
      const value = row as {
        id: number;
        blob_sha256: string;
        width_px: number;
        height_px: number;
        source_page_url: string | null;
        source_image_url: string | null;
        source_page_title: string | null;
        source_section_title: string | null;
        library_status: AdminFaceSheet["libraryStatus"];
      };
      return {
        id: value.id,
        blobSha256: value.blob_sha256,
        width: value.width_px,
        height: value.height_px,
        sourcePageUrl: value.source_page_url,
        sourceImageUrl: value.source_image_url,
        sourcePageTitle: value.source_page_title,
        sourceSectionTitle: value.source_section_title,
        libraryStatus: value.library_status,
      };
    }),
    boundSheetIds: (bindingsResult.results ?? []).map(
      (row) => Number((row as { face_sheet_id: number }).face_sheet_id),
    ),
    defaultPortrait: defaultRow ? mapCharacterPortrait(defaultRow) : null,
  };
}

export async function updateCharacterPortraitLibraryForAdmin(input: {
  characterId: number;
  faceSheetIds: number[];
  defaultPortrait: CharacterPortraitChoice | null;
  actorUserId: number;
}): Promise<void> {
  const database = getD1();
  const faceSheetIds = [...new Set(input.faceSheetIds)];
  const rows = faceSheetIds.length
    ? await database.prepare(
        `SELECT id,blob_sha256,width_px,height_px
         FROM face_sheets
         WHERE library_status!='rejected' AND id IN (${faceSheetIds.map(() => "?").join(",")})`,
      ).bind(...faceSheetIds).all<{
        id: number;
        blob_sha256: string;
        width_px: number;
        height_px: number;
      }>()
    : { results: [] };
  if ((rows.results ?? []).length !== faceSheetIds.length) {
    throw new HttpError(400, "脸图素材表选择不合法");
  }
  const selectedByHash = new Map((rows.results ?? []).map((row) => [row.blob_sha256, row]));
  if (input.defaultPortrait) {
    const sheet = selectedByHash.get(input.defaultPortrait.blobSha256);
    if (!sheet) throw new HttpError(400, "默认头像必须来自已绑定素材表");
    if (
      input.defaultPortrait.row >= sheet.height_px / 48 ||
      input.defaultPortrait.column >= sheet.width_px / 48
    ) {
      throw new HttpError(400, "默认头像坐标超出素材表范围");
    }
  }

  const statements: D1PreparedStatement[] = [];
  for (const faceSheetId of faceSheetIds) {
    statements.push(database.prepare(
      `INSERT OR IGNORE INTO character_face_sheet_bindings(
         character_id,face_sheet_id
       ) VALUES(?,?)`,
    ).bind(input.characterId, faceSheetId));
  }
  statements.push(
    faceSheetIds.length
      ? database.prepare(
          `DELETE FROM character_face_sheet_bindings
           WHERE character_id=? AND face_sheet_id NOT IN (${faceSheetIds.map(() => "?").join(",")})`,
        ).bind(input.characterId, ...faceSheetIds)
      : database.prepare(
          `DELETE FROM character_face_sheet_bindings WHERE character_id=?`,
        ).bind(input.characterId),
  );
  if (input.defaultPortrait) {
    statements.push(
      database.prepare(
        `INSERT OR IGNORE INTO character_portrait_refs(
           character_id,face_sheet_id,cell_row,cell_column,created_by_user_id
         ) SELECT ?,id,?,?,? FROM face_sheets WHERE blob_sha256=?`,
      ).bind(
        input.characterId,
        input.defaultPortrait.row,
        input.defaultPortrait.column,
        input.actorUserId,
        input.defaultPortrait.blobSha256,
      ),
      database.prepare(
        `INSERT INTO character_default_portraits(character_id,portrait_ref_id)
         SELECT ?,cpr.id FROM character_portrait_refs cpr
         JOIN face_sheets fs ON fs.id=cpr.face_sheet_id
         WHERE cpr.character_id=? AND fs.blob_sha256=?
           AND cpr.cell_row=? AND cpr.cell_column=?
         ON CONFLICT(character_id) DO UPDATE SET
           portrait_ref_id=excluded.portrait_ref_id`,
      ).bind(
        input.characterId,
        input.characterId,
        input.defaultPortrait.blobSha256,
        input.defaultPortrait.row,
        input.defaultPortrait.column,
      ),
    );
  } else {
    statements.push(database.prepare(
      `DELETE FROM character_default_portraits WHERE character_id=?`,
    ).bind(input.characterId));
  }
  await database.batch(statements);
}

export function parseCharacterPortraitLibraryForm(form: FormData): {
  faceSheetIds: number[];
  defaultPortrait: CharacterPortraitChoice | null;
} {
  const rawSheetIds = String(form.get("face_sheet_ids") ?? "[]");
  const rawDefault = String(form.get("default_portrait") ?? "").trim();
  let parsedSheetIds: unknown;
  let parsedDefault: unknown = null;
  try {
    parsedSheetIds = JSON.parse(rawSheetIds);
    if (rawDefault) parsedDefault = JSON.parse(rawDefault);
  } catch {
    throw new HttpError(400, "角色脸图配置格式不合法");
  }
  if (!Array.isArray(parsedSheetIds)) throw new HttpError(400, "角色脸图配置格式不合法");
  const faceSheetIds = parsedSheetIds.map((value) => Number(value));
  if (faceSheetIds.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new HttpError(400, "脸图素材表 ID 不合法");
  }
  if (parsedDefault === null) return { faceSheetIds, defaultPortrait: null };
  if (!isRecord(parsedDefault)) throw new HttpError(400, "默认头像格式不合法");
  const blobSha256 = String(parsedDefault.blobSha256 ?? "").toLowerCase();
  const row = Number(parsedDefault.row);
  const column = Number(parsedDefault.column);
  if (!/^[a-f0-9]{64}$/.test(blobSha256) || !Number.isSafeInteger(row) || row < 0 || !Number.isSafeInteger(column) || column < 0) {
    throw new HttpError(400, "默认头像格式不合法");
  }
  return { faceSheetIds, defaultPortrait: { blobSha256, row, column } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
