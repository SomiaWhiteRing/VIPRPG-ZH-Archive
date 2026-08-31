import { getD1 } from "@/lib/server/db/d1";
import { normalizeEntityName } from "@/lib/entity-name";

export type PublicCharacterSummary = {
  id: number;
  primaryName: string;
  originalName: string | null;
  description: string | null;
  workCount: number;
  updatedAt: string;
};
export type AdminCharacterEdit = PublicCharacterSummary & {
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
type CharacterRow = {
  id: number;
  primary_name: string;
  original_name: string | null;
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
    where.push("(ch.primary_name LIKE ? OR ch.original_name LIKE ?)");
    binds.push(q, q);
  }
  const rows = await getD1()
    .prepare(
      `${characterSql()} FROM characters ch WHERE ${where.join(" AND ")} ORDER BY work_count DESC,ch.primary_name ASC LIMIT ?`,
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
  limit = 300,
): Promise<PublicCharacterSummary[]> {
  const rows = await getD1()
    .prepare(
      `${characterSql()} FROM characters ch ORDER BY ch.updated_at DESC,ch.primary_name ASC LIMIT ?`,
    )
    .bind(limitValue(limit, 500))
    .all<CharacterRow>();
  return (rows.results ?? []).map(mapCharacter);
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
    clauses.push("(ch.primary_name LIKE ? OR ch.original_name LIKE ?)");
    binds.push(value, value);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = input.sort === "name" ? "ch.primary_name ASC,ch.id DESC" : input.sort === "works" ? "work_count DESC,ch.id DESC" : "ch.updated_at DESC,ch.id DESC";
  const database = getD1();
  const [rowsResult, countResult] = await database.batch([
    database.prepare(`${characterSql()} FROM characters ch ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, pageSize, (page - 1) * pageSize),
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
  const row = await getD1()
    .prepare(
      `${characterSql()},ch.extra_json FROM characters ch WHERE ch.id=? LIMIT 1`,
    )
    .bind(id)
    .first<CharacterRow>();
  return row
    ? { ...mapCharacter(row), extra: parseExtra(row.extra_json) }
    : null;
}
export async function updateCharacterForAdmin(input: {
  characterId: number;
  primaryName: string;
  originalName: string | null;
  description: string | null;
  mergeTargetId: number | null;
}): Promise<AdminCharacterEdit> {
  const primaryName = normalizeEntityName(input.primaryName);
  if (!primaryName) throw new Error("角色名不能为空");
  if (input.mergeTargetId) {
    await mergeCharacter(input.characterId, input.mergeTargetId);
    const target = await getCharacterById(input.mergeTargetId, true);
    if (!target) throw new Error("合并目标不存在");
    return target;
  }
  await getD1()
    .prepare(
      `UPDATE characters SET primary_name=?,original_name=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(
      primaryName,
      input.originalName,
      input.description,
      input.characterId,
    )
    .run();
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
    originalName: clean(form.get("original_name")),
    description: clean(form.get("description")),
    mergeTargetId: positive(form.get("merge_target_id")),
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
    mergeTargetId: positive(form.get("merge_target_id")),
  };
}

async function getCharacter(
  id: number,
  includeNonPublic: boolean,
): Promise<PublicCharacterSummary | null> {
  const row = await getD1()
    .prepare(`${characterSql()} FROM characters ch WHERE ch.id=? LIMIT 1`)
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
  const row = await getD1()
    .prepare(
      `${characterSql()},ch.extra_json FROM characters ch WHERE ch.id=? LIMIT 1`,
    )
    .bind(id)
    .first<CharacterRow>();
  if (!row) return null;
  if (!includeNonPublic && row.work_count === 0) return null;
  return { ...mapCharacter(row), extra: parseExtra(row.extra_json) };
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
  const target = await getD1()
    .prepare(`SELECT id FROM characters WHERE id=? LIMIT 1`)
    .bind(targetId)
    .first<{ id: number }>();
  if (!target || target.id === id) throw new Error("角色合并目标不合法");
  const database = getD1();
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO work_characters(work_id,character_id,role_key,spoiler_level,sort_order,notes) SELECT work_id,?,role_key,spoiler_level,sort_order,notes FROM work_characters WHERE character_id=?`,
      )
      .bind(target.id, id),
    database
      .prepare(`DELETE FROM work_characters WHERE character_id=?`)
      .bind(id),
    database.prepare(`DELETE FROM characters WHERE id=?`).bind(id),
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
function characterSql(): string {
  return `SELECT ch.id,ch.primary_name,ch.original_name,ch.description,ch.extra_json,(SELECT COUNT(DISTINCT wc.work_id) FROM work_characters wc JOIN works w ON w.id=wc.work_id WHERE wc.character_id=ch.id AND w.status='published') AS work_count,ch.updated_at`;
}
function tagSql(): string {
  return `SELECT t.id,t.name,t.namespace,t.description,(SELECT COUNT(DISTINCT wt.work_id) FROM work_tags wt JOIN works w ON w.id=wt.work_id WHERE wt.tag_id=t.id AND w.status='published') AS work_count,t.updated_at`;
}
function mapCharacter(row: CharacterRow): PublicCharacterSummary {
  return {
    id: row.id,
    primaryName: row.primary_name,
    originalName: row.original_name,
    description: row.description,
    workCount: row.work_count,
    updatedAt: row.updated_at,
  };
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
function positive(value: FormDataEntryValue | null): number {
  const id = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid id");
  return id;
}
function limitValue(value: number, max: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(max, Math.floor(value)))
    : 1;
}
