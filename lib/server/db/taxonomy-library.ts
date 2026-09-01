import { getD1 } from "@/lib/server/db/d1";
import type {
  CharacterAliasSuggestion,
  CharacterSuggestion,
} from "@/lib/character-names";
import { characterNameKey } from "@/lib/character-names";
import { normalizeEntityName } from "@/lib/entity-name";
import {
  CHARACTER_PORTRAIT_COLUMNS,
  DEFAULT_CHARACTER_PORTRAIT_JOINS,
  mapCharacterPortrait,
  type CharacterPortraitRow,
} from "@/lib/server/db/character-portrait-library";

export type PublicCharacterSummary = {
  id: number;
  primaryName: string;
  originalName: string;
  defaultPortrait: ReturnType<typeof mapCharacterPortrait>;
  description: string | null;
  workCount: number;
  updatedAt: string;
};
export type AdminCharacterEdit = PublicCharacterSummary & {
  aliases: CharacterAliasSuggestion[];
  extra: Record<string, unknown>;
};
export type PublicTagSummary = {
  id: number;
  name: string;
  namespace: string;
  description: string | null;
  workCount: number;
  updatedAt: string;
};
export type AdminTagEdit = PublicTagSummary;
type CharacterRow = CharacterPortraitRow & {
  id: number;
  primary_name: string;
  original_name: string;
  description: string | null;
  extra_json: string;
  work_count: number;
  updated_at: string;
};
type TagRow = {
  id: number;
  name: string;
  namespace: string;
  description: string | null;
  work_count: number;
  updated_at: string;
};

export async function listPublicCharacters(
  input: { query?: string; limit?: number } = {},
): Promise<PublicCharacterSummary[]> {
  const binds: Array<string | number> = [];
  const where = [
    `EXISTS(SELECT 1 FROM work_characters wc JOIN works w ON w.id=wc.work_id WHERE wc.character_id=ch.id AND w.status='published')`,
  ];
  if (input.query?.trim()) {
    const q = `%${input.query.trim()}%`;
    where.push("(ch.primary_name LIKE ? OR ch.original_name LIKE ? OR EXISTS(SELECT 1 FROM character_aliases ca WHERE ca.character_id=ch.id AND ca.name LIKE ?))");
    binds.push(q, q, q);
  }
  const rows = await getD1()
    .prepare(
      `${characterSql()} WHERE ${where.join(" AND ")} ORDER BY work_count DESC,ch.primary_name ASC LIMIT ?`,
    )
    .bind(...binds, limitValue(input.limit ?? 120, 300))
    .all<CharacterRow>();
  return (rows.results ?? []).map(mapCharacter);
}
export async function getPublicCharacterSummary(
  id: number,
): Promise<PublicCharacterSummary | null> {
  return getCharacter(id, false);
}
export async function listCharactersForAdmin(
  limit = 1000,
): Promise<PublicCharacterSummary[]> {
  const rows = await getD1()
    .prepare(
      `${characterSql()} ORDER BY ch.updated_at DESC,ch.primary_name ASC LIMIT ?`,
    )
    .bind(limitValue(limit, 2000))
    .all<CharacterRow>();
  return (rows.results ?? []).map(mapCharacter);
}

export async function listCharacterSuggestions(): Promise<CharacterSuggestion[]> {
  const database = getD1();
  const [namesResult, sheetsResult] = await database.batch([
    database.prepare(
      `${characterSql(
        ",ca.name AS alias_name,ca.language AS alias_language",
        "LEFT JOIN character_aliases ca ON ca.character_id=ch.id",
      )}
       ORDER BY work_count DESC,ch.primary_name ASC,ca.language,ca.name
       LIMIT 5000`,
    ),
    database.prepare(
      `SELECT cfsb.character_id,fs.id,fs.blob_sha256,fs.width_px,fs.height_px,
              fs.source_page_title,fs.source_section_title
       FROM character_face_sheet_bindings cfsb
       JOIN face_sheets fs ON fs.id=cfsb.face_sheet_id
       WHERE fs.library_status='approved'
       ORDER BY cfsb.character_id,fs.id`,
    ),
  ]);
  const rows = (namesResult.results ?? []) as Array<CharacterRow & {
      alias_name: string | null;
      alias_language: "ja" | "zh" | null;
    }>;
  const suggestions = new Map<number, CharacterSuggestion>();
  for (const row of rows) {
    let suggestion = suggestions.get(row.id);
    if (!suggestion) {
      suggestion = {
        id: row.id,
        originalName: row.original_name,
        primaryName: row.primary_name,
        defaultPortrait: mapCharacterPortrait(row),
        faceSheets: [],
        aliases: [],
        workCount: row.work_count,
      };
      suggestions.set(row.id, suggestion);
    }
    if (row.alias_name && row.alias_language) {
      suggestion.aliases.push({
        name: row.alias_name,
        language: row.alias_language,
      });
    }
  }
  for (const row of (sheetsResult.results ?? []) as Array<{
    character_id: number;
    id: number;
    blob_sha256: string;
    width_px: number;
    height_px: number;
    source_page_title: string | null;
    source_section_title: string | null;
  }>) {
    suggestions.get(row.character_id)?.faceSheets.push({
      id: row.id,
      blobSha256: row.blob_sha256,
      width: row.width_px,
      height: row.height_px,
      sourcePageTitle: row.source_page_title,
      sourceSectionTitle: row.source_section_title,
    });
  }
  return [...suggestions.values()];
}
export async function searchCharactersForAdmin(input: {
  query?: string;
  sort?: "default" | "name" | "works";
  page?: number;
  pageSize?: number;
}): Promise<{ items: PublicCharacterSummary[]; total: number; page: number; pageSize: number }> {
  const pageSize = limitValue(input.pageSize ?? 50, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const binds: Array<string | number> = [];
  const clauses: string[] = [];
  if (input.query?.trim()) {
    const value = `%${input.query.trim()}%`;
    clauses.push("(ch.primary_name LIKE ? OR ch.original_name LIKE ? OR EXISTS(SELECT 1 FROM character_aliases ca WHERE ca.character_id=ch.id AND ca.name LIKE ?))");
    binds.push(value, value, value);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = input.sort === "name" ? "ch.primary_name ASC,ch.id DESC" : input.sort === "works" ? "work_count DESC,ch.id DESC" : "ch.updated_at DESC,ch.id DESC";
  const database = getD1();
  const [rowsResult, countResult] = await database.batch([
    database.prepare(`${characterSql()} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, pageSize, (page - 1) * pageSize),
    database.prepare(`SELECT COUNT(*) AS count FROM characters ch ${where}`).bind(...binds),
  ]);
  return {
    items: ((rowsResult.results ?? []) as CharacterRow[]).map(mapCharacter),
    total: Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    page,
    pageSize,
  };
}
export async function getCharacterForAdminEdit(
  id: number,
): Promise<AdminCharacterEdit | null> {
  const database = getD1();
  const [characterResult, aliasesResult] = await database.batch([
    database.prepare(
      `${characterSql()} WHERE ch.id=? LIMIT 1`,
    ).bind(id),
    database.prepare(
      `SELECT name,language FROM character_aliases
       WHERE character_id=? ORDER BY language,name`,
    ).bind(id),
  ]);
  const row = (characterResult.results?.[0] ?? null) as CharacterRow | null;
  return row
    ? {
        ...mapCharacter(row),
        aliases: (aliasesResult.results ?? []).map((alias) => ({
          name: String((alias as { name: string }).name),
          language: (alias as { language: "ja" | "zh" }).language,
        })),
        extra: parseExtra(row.extra_json),
      }
    : null;
}
export async function updateCharacterForAdmin(input: {
  characterId: number;
  primaryName: string;
  originalName: string;
  description: string | null;
  japaneseAliases: string[];
  chineseAliases: string[];
  mergeTargetId: number | null;
}): Promise<AdminCharacterEdit> {
  const primaryName = normalizeEntityName(input.primaryName);
  if (!primaryName) throw new Error("角色名不能为空");
  const originalName = normalizeEntityName(input.originalName);
  if (!originalName) throw new Error("角色日语名不能为空");
  if (input.mergeTargetId) {
    await mergeCharacter(input.characterId, input.mergeTargetId);
    const target = await getCharacterById(input.mergeTargetId, true);
    if (!target) throw new Error("合并目标不存在");
    return target;
  }
  const aliases = [
    ...normalizeCharacterAliases(input.japaneseAliases, "ja", originalName),
    ...normalizeCharacterAliases(input.chineseAliases, "zh", primaryName),
  ];
  const database = getD1();
  await database.batch([
    database.prepare(`DELETE FROM character_aliases WHERE character_id=?`).bind(input.characterId),
    database.prepare(
      `UPDATE characters
       SET primary_name=?,primary_name_key=?,original_name=?,original_name_key=?,description=?,
             updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
    )
    .bind(
      primaryName,
      characterNameKey(primaryName),
      originalName,
      characterNameKey(originalName),
      input.description,
      input.characterId,
    ),
    ...aliases.map((alias) => database.prepare(
      `INSERT INTO character_aliases(character_id,name,name_key,language,source)
       VALUES(?,?,?,?,'admin')`,
    ).bind(
      input.characterId,
      alias.name,
      characterNameKey(alias.name),
      alias.language,
    )),
  ]);
  const updated = await getCharacterForAdminEdit(input.characterId);
  if (!updated) throw new Error("角色更新后不可读取");
  return updated;
}
export function parseCharacterEditForm(
  form: FormData,
): Parameters<typeof updateCharacterForAdmin>[0] {
  const id = positive(form.get("character_id"));
  return {
    characterId: id,
    primaryName: String(form.get("primary_name") ?? ""),
    originalName: String(form.get("original_name") ?? ""),
    description: clean(form.get("description")),
    japaneseAliases: lines(form.get("japanese_aliases")),
    chineseAliases: lines(form.get("chinese_aliases")),
    mergeTargetId: nullablePositive(form.get("merge_target_id")),
  };
}

export async function listPublicTags(
  input: { query?: string; limit?: number } = {},
): Promise<PublicTagSummary[]> {
  const binds: Array<string | number> = [];
  const where = [
    `EXISTS(SELECT 1 FROM work_tags wt JOIN works w ON w.id=wt.work_id WHERE wt.tag_id=t.id AND w.status='published')`,
  ];
  if (input.query?.trim()) {
    const q = `%${input.query.trim()}%`;
    where.push("t.name LIKE ?");
    binds.push(q);
  }
  const rows = await getD1()
    .prepare(
      `${tagSql()} FROM tags t WHERE ${where.join(" AND ")} ORDER BY work_count DESC,t.name ASC LIMIT ?`,
    )
    .bind(...binds, limitValue(input.limit ?? 120, 300))
    .all<TagRow>();
  return (rows.results ?? []).map(mapTag);
}
export async function getPublicTagSummary(
  id: number,
): Promise<PublicTagSummary | null> {
  const tag = await getTagById(id, false);
  return tag && tag.workCount > 0 ? tag : null;
}
export async function listTagsForAdmin(
  limit = 300,
): Promise<PublicTagSummary[]> {
  const rows = await getD1()
    .prepare(
      `${tagSql()} FROM tags t ORDER BY t.updated_at DESC,t.name ASC LIMIT ?`,
    )
    .bind(limitValue(limit, 500))
    .all<TagRow>();
  return (rows.results ?? []).map(mapTag);
}
export async function searchTagsForAdmin(input: {
  query?: string;
  namespace?: string;
  sort?: "default" | "name" | "works";
  page?: number;
  pageSize?: number;
}): Promise<{ items: PublicTagSummary[]; total: number; page: number; pageSize: number }> {
  const pageSize = limitValue(input.pageSize ?? 50, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const binds: Array<string | number> = [];
  const clauses: string[] = [];
  if (input.query?.trim()) { clauses.push("t.name LIKE ?"); binds.push(`%${input.query.trim()}%`); }
  if (input.namespace && input.namespace !== "all") { clauses.push("t.namespace=?"); binds.push(input.namespace); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = input.sort === "name" ? "t.name ASC,t.id DESC" : input.sort === "works" ? "work_count DESC,t.id DESC" : "t.updated_at DESC,t.id DESC";
  const database = getD1();
  const [rowsResult, countResult] = await database.batch([
    database.prepare(`${tagSql()} FROM tags t ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, pageSize, (page - 1) * pageSize),
    database.prepare(`SELECT COUNT(*) AS count FROM tags t ${where}`).bind(...binds),
  ]);
  return {
    items: ((rowsResult.results ?? []) as TagRow[]).map(mapTag),
    total: Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    page,
    pageSize,
  };
}
export async function getTagForAdminEdit(
  id: number,
): Promise<AdminTagEdit | null> {
  const row = await getD1()
    .prepare(`${tagSql()} FROM tags t WHERE t.id=? LIMIT 1`)
    .bind(id)
    .first<TagRow>();
  return row ? mapTag(row) : null;
}
export async function updateTagForAdmin(input: {
  tagId: number;
  name: string;
  namespace: string;
  description: string | null;
  mergeTargetId: number | null;
}): Promise<AdminTagEdit> {
  const name = normalizeEntityName(input.name);
  if (!name) throw new Error("标签名不能为空");
  if (
    !["genre", "theme", "character", "technical", "content", "other"].includes(
      input.namespace,
    )
  )
    throw new Error("标签命名空间不合法");
  if (input.mergeTargetId) {
    await mergeTag(input.tagId, input.mergeTargetId);
    const target = await getTagById(input.mergeTargetId, true);
    if (!target) throw new Error("合并目标不存在");
    return target;
  }
  await getD1()
    .prepare(
      `UPDATE tags SET name=?,namespace=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(name, input.namespace, input.description, input.tagId)
    .run();
  const updated = await getTagForAdminEdit(input.tagId);
  if (!updated) throw new Error("标签更新后不可读取");
  return updated;
}
export function parseTagEditForm(
  form: FormData,
): Parameters<typeof updateTagForAdmin>[0] {
  return {
    tagId: positive(form.get("tag_id")),
    name: String(form.get("name") ?? ""),
    namespace: String(form.get("namespace") ?? "other"),
    description: clean(form.get("description")),
    mergeTargetId: nullablePositive(form.get("merge_target_id")),
  };
}

async function getCharacter(
  id: number,
  includeNonPublic: boolean,
): Promise<PublicCharacterSummary | null> {
  const row = await getD1()
    .prepare(`${characterSql()} WHERE ch.id=? LIMIT 1`)
    .bind(id)
    .first<CharacterRow>();
  if (!row) return null;
  if (!includeNonPublic && row.work_count === 0) return null;
  return mapCharacter(row);
}
async function getCharacterById(
  id: number,
  includeNonPublic: boolean,
): Promise<AdminCharacterEdit | null> {
  const character = await getCharacterForAdminEdit(id);
  if (!character || (!includeNonPublic && character.workCount === 0)) return null;
  return character;
}
async function getTagById(
  id: number,
  includeNonPublic: boolean,
): Promise<PublicTagSummary | null> {
  const row = await getD1()
    .prepare(`${tagSql()} FROM tags t WHERE t.id=? LIMIT 1`)
    .bind(id)
    .first<TagRow>();
  if (!row || (!includeNonPublic && row.work_count === 0)) return null;
  return mapTag(row);
}
async function mergeCharacter(id: number, targetId: number): Promise<void> {
  const database = getD1();
  const [source, target] = await database.batch([
    database
      .prepare(`SELECT id,primary_name,primary_name_key,original_name,original_name_key FROM characters WHERE id=? LIMIT 1`)
      .bind(id),
    database
      .prepare(`SELECT id,primary_name_key,original_name_key FROM characters WHERE id=? LIMIT 1`)
      .bind(targetId),
  ]);
  const sourceRow = source.results?.[0] as {
    id: number;
    primary_name: string;
    primary_name_key: string;
    original_name: string;
    original_name_key: string;
  } | undefined;
  const targetRow = target.results?.[0] as {
    id: number;
    primary_name_key: string;
    original_name_key: string;
  } | undefined;
  if (!sourceRow || !targetRow || targetRow.id === sourceRow.id) {
    throw new Error("角色合并目标不合法");
  }
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO character_face_sheet_bindings(character_id,face_sheet_id,sort_order)
         SELECT ?,face_sheet_id,sort_order FROM character_face_sheet_bindings WHERE character_id=?`,
      )
      .bind(targetRow.id, sourceRow.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_portrait_refs(character_id,face_sheet_id,cell_row,cell_column,created_by_user_id)
         SELECT ?,face_sheet_id,cell_row,cell_column,created_by_user_id
         FROM character_portrait_refs WHERE character_id=?`,
      )
      .bind(targetRow.id, sourceRow.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_default_portraits(character_id,portrait_ref_id)
         SELECT ?,target_ref.id
         FROM character_default_portraits source_default
         JOIN character_portrait_refs source_ref ON source_ref.id=source_default.portrait_ref_id
         JOIN character_portrait_refs target_ref
           ON target_ref.character_id=?
          AND target_ref.face_sheet_id=source_ref.face_sheet_id
          AND target_ref.cell_row=source_ref.cell_row
          AND target_ref.cell_column=source_ref.cell_column
         WHERE source_default.character_id=?`,
      )
      .bind(targetRow.id, targetRow.id, sourceRow.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO work_characters(work_id,character_id,portrait_ref_id,display_name,role_key,spoiler_level,sort_order,notes)
         SELECT wc.work_id,?,target_ref.id,wc.display_name,wc.role_key,wc.spoiler_level,wc.sort_order,wc.notes
         FROM work_characters wc
         LEFT JOIN character_portrait_refs source_ref ON source_ref.id=wc.portrait_ref_id
         LEFT JOIN character_portrait_refs target_ref
           ON target_ref.character_id=?
          AND target_ref.face_sheet_id=source_ref.face_sheet_id
          AND target_ref.cell_row=source_ref.cell_row
          AND target_ref.cell_column=source_ref.cell_column
         WHERE wc.character_id=?`,
      )
      .bind(targetRow.id, targetRow.id, sourceRow.id),
    database
      .prepare(`DELETE FROM work_characters WHERE character_id=?`)
      .bind(sourceRow.id),
    database
      .prepare(
        `DELETE FROM character_aliases
         WHERE character_id=? AND (
           name_key IN (SELECT name_key FROM character_aliases WHERE character_id=?)
           OR name_key=? OR name_key=?
         )`,
      )
      .bind(
        sourceRow.id,
        targetRow.id,
        targetRow.primary_name_key,
        targetRow.original_name_key,
      ),
    database
      .prepare(`UPDATE character_aliases SET character_id=? WHERE character_id=?`)
      .bind(targetRow.id, sourceRow.id),
    database.prepare(`DELETE FROM characters WHERE id=?`).bind(sourceRow.id),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_aliases(character_id,name,name_key,language,source)
         SELECT ?,?,?,'ja','admin'
         WHERE ?<>? AND ?<>?
           AND NOT EXISTS(SELECT 1 FROM character_aliases WHERE character_id=? AND name_key=?)`,
      )
      .bind(
        targetRow.id,
        sourceRow.original_name,
        sourceRow.original_name_key,
        sourceRow.original_name_key,
        targetRow.original_name_key,
        sourceRow.original_name_key,
        targetRow.primary_name_key,
        targetRow.id,
        sourceRow.original_name_key,
      ),
    database
      .prepare(
        `INSERT OR IGNORE INTO character_aliases(character_id,name,name_key,language,source)
         SELECT ?,?,?,'zh','admin'
         WHERE ?<>? AND ?<>?
           AND NOT EXISTS(SELECT 1 FROM character_aliases WHERE character_id=? AND name_key=?)`,
      )
      .bind(
        targetRow.id,
        sourceRow.primary_name,
        sourceRow.primary_name_key,
        sourceRow.primary_name_key,
        targetRow.primary_name_key,
        sourceRow.primary_name_key,
        targetRow.original_name_key,
        targetRow.id,
        sourceRow.primary_name_key,
      ),
  ]);
}
async function mergeTag(id: number, targetId: number): Promise<void> {
  const target = await getD1()
    .prepare(`SELECT id FROM tags WHERE id=? LIMIT 1`)
    .bind(targetId)
    .first<{ id: number }>();
  if (!target || target.id === id) throw new Error("标签合并目标不合法");
  const database = getD1();
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO work_tags(work_id,tag_id,source) SELECT work_id,?,source FROM work_tags WHERE tag_id=?`,
      )
      .bind(target.id, id),
    database.prepare(`DELETE FROM work_tags WHERE tag_id=?`).bind(id),
    database.prepare(`DELETE FROM tags WHERE id=?`).bind(id),
  ]);
}
function characterSql(extraColumns = "", extraJoins = ""): string {
  return `SELECT ch.id,ch.primary_name,ch.original_name,ch.description,ch.extra_json,${CHARACTER_PORTRAIT_COLUMNS},(SELECT COUNT(DISTINCT wc.work_id) FROM work_characters wc JOIN works w ON w.id=wc.work_id WHERE wc.character_id=ch.id AND w.status='published') AS work_count,ch.updated_at${extraColumns} FROM characters ch ${DEFAULT_CHARACTER_PORTRAIT_JOINS} ${extraJoins}`;
}
function tagSql(): string {
  return `SELECT t.id,t.name,t.namespace,t.description,(SELECT COUNT(DISTINCT wt.work_id) FROM work_tags wt JOIN works w ON w.id=wt.work_id WHERE wt.tag_id=t.id AND w.status='published') AS work_count,t.updated_at`;
}
function mapCharacter(row: CharacterRow): PublicCharacterSummary {
  return {
    id: row.id,
    primaryName: row.primary_name,
    originalName: row.original_name,
    defaultPortrait: mapCharacterPortrait(row),
    description: row.description,
    workCount: row.work_count,
    updatedAt: row.updated_at,
  };
}

function normalizeCharacterAliases(
  values: string[],
  language: "ja" | "zh",
  canonicalName: string,
): CharacterAliasSuggestion[] {
  const canonicalKey = characterNameKey(canonicalName);
  const seen = new Set<string>();
  const result: CharacterAliasSuggestion[] = [];
  for (const value of values) {
    const name = normalizeEntityName(value);
    const key = characterNameKey(name);
    if (!key || key === canonicalKey || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, language });
  }
  return result;
}
function mapTag(row: TagRow): PublicTagSummary {
  return {
    id: row.id,
    name: row.name,
    namespace: row.namespace,
    description: row.description,
    workCount: row.work_count,
    updatedAt: row.updated_at,
  };
}
function parseExtra(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {}
  return {};
}
function clean(value: FormDataEntryValue | null): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}
function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,，\r\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
function positive(value: FormDataEntryValue | null): number {
  const id = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid id");
  return id;
}
function nullablePositive(value: FormDataEntryValue | null): number | null {
  if (!String(value ?? "").trim()) return null;
  return positive(value);
}
function limitValue(value: number, max: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(max, Math.floor(value)))
    : 1;
}
