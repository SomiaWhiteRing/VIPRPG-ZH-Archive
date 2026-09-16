import type {
  CharacterFaceSheet,
  CharacterPortrait,
  CharacterPortraitChoice,
} from "@/lib/character-names";
import { getD1 } from "@/lib/server/db/d1";
import { HttpError } from "@/lib/server/http/json";
import { CHARACTER_MATERIAL_CATEGORIES, type CharacterMaterialKind } from "@/lib/character-materials";

export type AdminFaceSheet = CharacterFaceSheet & {
  sourcePageUrl: string | null;
  sourceImageUrl: string | null;
  libraryStatus: "pending" | "approved" | "rejected";
};

export type AdminCharacterMaterial = {
  id: number;
  kind: CharacterMaterialKind;
  blobSha256: string;
  width: number;
  height: number;
  relatedNames: string;
  isPublic: number;
};

export type AdminCharacterMaterialPage = {
  sheets: AdminFaceSheet[];
  materials: AdminCharacterMaterial[];
  nextOffset: number | null;
};

const MATERIAL_PAGE_SIZE = 48;
const MATERIAL_RELATED_NAMES = `COALESCE((SELECT group_concat(ch.original_name || ' ' || ch.primary_name, ' · ')
  FROM character_material_bindings binding JOIN characters ch ON ch.id=binding.character_id
  WHERE binding.material_id=m.id), '')`;

type AdminFaceSheetRow = {
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

export type AdminCharacterPortraitLibrary = {
  sheets: AdminFaceSheet[];
  boundSheetIds: number[];
  defaultPortrait: CharacterPortrait | null;
  materials: AdminCharacterMaterial[];
  boundMaterialIds: number[];
};

export type CharacterPortraitConfiguration = Pick<
  AdminCharacterPortraitLibrary,
  "boundSheetIds" | "defaultPortrait"
>;

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

export const PUBLIC_CHARACTER_PORTRAIT_CONDITION = `
  EXISTS (SELECT 1 FROM blobs b WHERE b.sha256=portrait_sheet.blob_sha256 AND b.status='active' AND b.content_type_hint LIKE 'image/%')
  AND (portrait_sheet.library_status='approved' OR EXISTS (
    SELECT 1 FROM character_portrait_refs ref JOIN work_characters wc ON wc.portrait_ref_id=ref.id
    JOIN works w ON w.id=wc.work_id WHERE ref.face_sheet_id=portrait_sheet.id AND w.status='published'
  ))`;

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

export async function getCharacterPortraitConfigurationForAdmin(
  characterId: number,
): Promise<CharacterPortraitConfiguration> {
  const database = getD1();
  const [bindingsResult, defaultResult] = await database.batch([
    database.prepare(
      `SELECT face_sheet_id
       FROM character_face_sheet_bindings
       WHERE character_id=?
       ORDER BY sort_order IS NULL,sort_order,face_sheet_id`,
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
    boundSheetIds: (bindingsResult.results ?? []).map(
      (row) => Number((row as { face_sheet_id: number }).face_sheet_id),
    ),
    defaultPortrait: defaultRow ? mapCharacterPortrait(defaultRow) : null,
  };
}

export async function getCharacterPortraitLibraryForAdmin(
  characterId: number,
): Promise<AdminCharacterPortraitLibrary> {
  const database = getD1();
  const [sheetsResult, bindingsResult, materialsResult, materialBindingsResult, defaultResult] = await database.batch([
    database.prepare(
      `SELECT id,blob_sha256,width_px,height_px,source_page_url,source_image_url,
              source_page_title,source_section_title,library_status
       FROM face_sheets
       WHERE library_status!='rejected'
         AND id IN (SELECT face_sheet_id FROM character_face_sheet_bindings WHERE character_id=?)
       ORDER BY CASE library_status WHEN 'approved' THEN 0 ELSE 1 END,
                source_order IS NULL,source_order,id`,
    ).bind(characterId),
    database.prepare(
      `SELECT binding.face_sheet_id
       FROM character_face_sheet_bindings binding
       JOIN face_sheets fs ON fs.id=binding.face_sheet_id
       WHERE binding.character_id=?
       ORDER BY binding.sort_order IS NULL,binding.sort_order,
                fs.source_order IS NULL,fs.source_order,binding.face_sheet_id`,
    ).bind(characterId),
    database.prepare(`SELECT m.id,m.kind,m.blob_sha256 AS blobSha256,m.width_px AS width,m.height_px AS height,
      ${MATERIAL_RELATED_NAMES} AS relatedNames,1 AS isPublic
      FROM character_materials m JOIN blobs b ON b.sha256=m.blob_sha256
      WHERE b.status='active' AND m.id IN (SELECT material_id FROM character_material_bindings WHERE character_id=?)
      ORDER BY m.kind,m.id`).bind(characterId),
    database.prepare(`SELECT m.id FROM character_material_bindings b JOIN character_materials m ON m.id=b.material_id WHERE b.character_id=? ORDER BY b.sort_order IS NULL,b.sort_order,m.id`).bind(characterId),
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
    sheets: (sheetsResult.results ?? []).map((row) => mapAdminFaceSheet(row as AdminFaceSheetRow)),
    boundSheetIds: (bindingsResult.results ?? []).map(
      (row) => Number((row as { face_sheet_id: number }).face_sheet_id),
    ),
    defaultPortrait: defaultRow ? mapCharacterPortrait(defaultRow) : null,
    materials: (materialsResult.results ?? []) as AdminCharacterMaterial[],
    boundMaterialIds: (materialBindingsResult.results ?? []).map((row) => Number((row as { id: number }).id)),
  };
}

export async function searchCharacterMaterialsForAdmin(input: {
  kind: string;
  query: string;
  offset: number;
}): Promise<AdminCharacterMaterialPage> {
  if (!CHARACTER_MATERIAL_CATEGORIES.some((category) => category.kind === input.kind)) throw new HttpError(400, "请选择素材分类");
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new HttpError(400, "素材分页位置不合法");
  const query = input.query.normalize("NFKC").trim().toLocaleLowerCase("ja");
  const terms = query.split(/\s+/).filter(Boolean);
  if (query.length > 160 || terms.length > 16) throw new HttpError(400, "素材搜索内容过长");
  const faces = input.kind === "faceset";
  const alias = faces ? "fs" : "m";
  const clauses = faces ? ["fs.library_status!='rejected'"] : ["m.kind=?", "b.status='active'"];
  const binds: (string | number)[] = faces ? [] : [input.kind];
  for (const term of terms) {
    if (term.startsWith("#")) {
      clauses.push(`CAST(${alias}.id AS TEXT)=?`);
      binds.push(term.slice(1));
    } else if (faces) {
      clauses.push(`(instr(lower(COALESCE(fs.source_page_title,'') || ' ' || COALESCE(fs.source_section_title,'') || ' ' || fs.blob_sha256 || ' ' || fs.id),?)>0
        OR instr(lower(COALESCE(fs.source_image_url,'')),?)>0 OR instr(lower(COALESCE(fs.source_image_url,'')),?)>0)`);
      binds.push(term, term, encodeURIComponent(term).toLowerCase());
    } else {
      clauses.push(`(instr(m.blob_sha256 || ' ' || m.id,?)>0 OR EXISTS (
        SELECT 1 FROM character_material_bindings binding JOIN characters ch ON ch.id=binding.character_id
        WHERE binding.material_id=m.id AND instr(lower(ch.original_name || ' ' || ch.primary_name || ' ' || ch.original_name_key || ' ' || ch.primary_name_key),?)>0))`);
      binds.push(term, term);
    }
  }
  const database = getD1();
  if (faces) {
    const result = await database.prepare(`SELECT fs.id,fs.blob_sha256,fs.width_px,fs.height_px,fs.source_page_url,fs.source_image_url,
      fs.source_page_title,fs.source_section_title,fs.library_status FROM face_sheets fs
      WHERE ${clauses.join(" AND ")}
      ORDER BY CASE fs.library_status WHEN 'approved' THEN 0 ELSE 1 END,fs.source_order IS NULL,fs.source_order,fs.id
      LIMIT ? OFFSET ?`).bind(...binds, MATERIAL_PAGE_SIZE + 1, input.offset).all<AdminFaceSheetRow>();
    return { sheets: result.results.slice(0, MATERIAL_PAGE_SIZE).map(mapAdminFaceSheet), materials: [],
      nextOffset: result.results.length > MATERIAL_PAGE_SIZE ? input.offset + MATERIAL_PAGE_SIZE : null };
  }
  // Aggregate display names only for the selected page, after filtering and sorting.
  const result = await database.prepare(`WITH page AS MATERIALIZED (
    SELECT m.* FROM character_materials m JOIN blobs b ON b.sha256=m.blob_sha256
    WHERE ${clauses.join(" AND ")} ORDER BY m.id LIMIT ? OFFSET ?
  ) SELECT m.id,m.kind,m.blob_sha256 AS blobSha256,m.width_px AS width,m.height_px AS height,
    ${MATERIAL_RELATED_NAMES} AS relatedNames,
    EXISTS (SELECT 1 FROM character_material_bindings binding WHERE binding.material_id=m.id) AS isPublic
    FROM page m ORDER BY m.id`)
    .bind(...binds, MATERIAL_PAGE_SIZE + 1, input.offset).all<AdminCharacterMaterial>();
  return { sheets: [], materials: result.results.slice(0, MATERIAL_PAGE_SIZE),
    nextOffset: result.results.length > MATERIAL_PAGE_SIZE ? input.offset + MATERIAL_PAGE_SIZE : null };
}

export async function registerAdminFaceSheetForCharacter(input: {
  characterId: number;
  sha256: string;
  width: number;
  height: number;
  fileName: string;
  actorUserId: number;
}): Promise<AdminFaceSheet> {
  const database = getD1();
  const character = await database
    .prepare("SELECT id FROM characters WHERE id=? LIMIT 1")
    .bind(input.characterId)
    .first<{ id: number }>();
  if (!character) throw new HttpError(404, "角色不存在，请返回角色维护页重新进入。");

  const fileName = input.fileName.trim().slice(0, 255) || "上传的素材表";
  await database.batch([
    database
      .prepare(
        `INSERT INTO face_sheets(
           blob_sha256,width_px,height_px,source_kind,source_page_title,
           source_section_title,library_status,created_by_user_id
         ) VALUES(?,?,?,'admin_upload','管理员上传',?,'approved',?)
         ON CONFLICT(blob_sha256) DO UPDATE SET
           library_status='approved',
           updated_at=CURRENT_TIMESTAMP`,
      )
      .bind(
        input.sha256,
        input.width,
        input.height,
        fileName,
        input.actorUserId,
      ),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_face_sheet_bindings(character_id,face_sheet_id)
         SELECT ?,id FROM face_sheets WHERE blob_sha256=?`,
      )
      .bind(input.characterId, input.sha256),
  ]);

  const row = await database
    .prepare(
      `SELECT fs.id,fs.blob_sha256,fs.width_px,fs.height_px,fs.source_page_url,
              fs.source_image_url,fs.source_page_title,fs.source_section_title,
              fs.library_status
       FROM face_sheets fs
       JOIN character_face_sheet_bindings binding ON binding.face_sheet_id=fs.id
       WHERE binding.character_id=? AND fs.blob_sha256=?
       LIMIT 1`,
    )
    .bind(input.characterId, input.sha256)
    .first<AdminFaceSheetRow>();
  if (!row) throw new HttpError(500, "脸图素材表已上传，但未能绑定到当前角色。");
  return mapAdminFaceSheet(row);
}

export async function updateCharacterPortraitLibraryForAdmin(input: {
  characterId: number;
  faceSheetIds: number[];
  defaultPortrait: CharacterPortraitChoice | null;
  actorUserId: number;
}): Promise<void> {
  await getD1().batch(await prepareCharacterPortraitLibraryUpdate(input));
}

export async function prepareCharacterPortraitLibraryUpdate(input: {
  characterId: number;
  faceSheetIds: number[];
  defaultPortrait: CharacterPortraitChoice | null;
  actorUserId: number;
}): Promise<D1PreparedStatement[]> {
  const database = getD1();
  const faceSheetIds = [...new Set(input.faceSheetIds)];
  const selectedIds = JSON.stringify(faceSheetIds);
  const rows = faceSheetIds.length
    ? await database.prepare(
        `SELECT id,blob_sha256,width_px,height_px,(${PUBLIC_CHARACTER_PORTRAIT_CONDITION}) AS is_public
         FROM face_sheets portrait_sheet
         WHERE library_status!='rejected' AND id IN (SELECT value FROM json_each(?))`,
      ).bind(selectedIds).all<{
        id: number;
        blob_sha256: string;
        width_px: number;
        height_px: number;
        is_public: number;
      }>()
    : { results: [] };
  if ((rows.results ?? []).length !== faceSheetIds.length) {
    throw new HttpError(400, "脸图素材表选择不合法");
  }
  const selectedByHash = new Map((rows.results ?? []).map((row) => [row.blob_sha256, row]));
  if (input.defaultPortrait) {
    const sheet = selectedByHash.get(input.defaultPortrait.blobSha256);
    if (!sheet) throw new HttpError(400, "默认头像必须来自已绑定素材表");
    if (!sheet.is_public) throw new HttpError(400, "默认头像必须使用已批准或已公开作品使用的有效脸图");
    if (
      input.defaultPortrait.row >= sheet.height_px / 48 ||
      input.defaultPortrait.column >= sheet.width_px / 48
    ) {
      throw new HttpError(400, "默认头像坐标超出素材表范围");
    }
  }

  const statements: D1PreparedStatement[] = [
    database.prepare(
      `INSERT OR IGNORE INTO character_face_sheet_bindings(
         character_id,face_sheet_id
       ) SELECT ?,value FROM json_each(?)`,
    ).bind(input.characterId, selectedIds),
    database.prepare(
      `DELETE FROM character_face_sheet_bindings
       WHERE character_id=? AND face_sheet_id NOT IN (SELECT value FROM json_each(?))`,
    ).bind(input.characterId, selectedIds),
  ];
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
  return statements;
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

function mapAdminFaceSheet(value: AdminFaceSheetRow): AdminFaceSheet {
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
}
