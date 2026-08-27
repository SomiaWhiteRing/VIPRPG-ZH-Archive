import { getD1 } from "@/lib/server/db/d1";

export type PublicCharacterSummary = {
  id: number;
  slug: string;
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
  slug: string;
  name: string;
  namespace: string;
  description: string | null;
  workCount: number;
  updatedAt: string;
};
export type AdminTagEdit = PublicTagSummary;
type CharacterRow = {
  id: number;
  slug: string;
  primary_name: string;
  original_name: string | null;
  description: string | null;
  extra_json: string;
  work_count: number;
  updated_at: string;
};
type TagRow = {
  id: number;
  slug: string;
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
  slug: string,
): Promise<PublicCharacterSummary | null> {
  return getCharacter(slug, false);
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
  mergeTargetSlug: string | null;
}): Promise<AdminCharacterEdit> {
  if (!input.primaryName.trim()) throw new Error("角色名不能为空");
  if (input.mergeTargetSlug) {
    await mergeCharacter(input.characterId, input.mergeTargetSlug);
    const target = await getCharacterBySlug(input.mergeTargetSlug, true);
    if (!target) throw new Error("合并目标不存在");
    return target;
  }
  await getD1()
    .prepare(
      `UPDATE characters SET primary_name=?,original_name=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(
      input.primaryName.trim(),
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
    mergeTargetSlug: clean(form.get("merge_target_slug")),
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
    where.push("(t.name LIKE ? OR t.slug LIKE ?)");
    binds.push(q, q);
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
  slug: string,
): Promise<PublicTagSummary | null> {
  const tag = await getTagBySlug(slug, false);
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
  mergeTargetSlug: string | null;
}): Promise<AdminTagEdit> {
  if (!input.name.trim()) throw new Error("标签名不能为空");
  if (
    !["genre", "theme", "character", "technical", "content", "other"].includes(
      input.namespace,
    )
  )
    throw new Error("标签命名空间不合法");
  if (input.mergeTargetSlug) {
    await mergeTag(input.tagId, input.mergeTargetSlug);
    const target = await getTagBySlug(input.mergeTargetSlug, true);
    if (!target) throw new Error("合并目标不存在");
    return target;
  }
  await getD1()
    .prepare(
      `UPDATE tags SET name=?,namespace=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(input.name.trim(), input.namespace, input.description, input.tagId)
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
    mergeTargetSlug: clean(form.get("merge_target_slug")),
  };
}

async function getCharacter(
  slug: string,
  includeNonPublic: boolean,
): Promise<PublicCharacterSummary | null> {
  const row = await getD1()
    .prepare(`${characterSql()} FROM characters ch WHERE ch.slug=? LIMIT 1`)
    .bind(slug)
    .first<CharacterRow>();
  if (!row) return null;
  if (!includeNonPublic && row.work_count === 0) return null;
  return mapCharacter(row);
}
async function getCharacterBySlug(
  slug: string,
  includeNonPublic: boolean,
): Promise<AdminCharacterEdit | null> {
  const row = await getD1()
    .prepare(
      `${characterSql()},ch.extra_json FROM characters ch WHERE ch.slug=? LIMIT 1`,
    )
    .bind(slug)
    .first<CharacterRow>();
  if (!row) return null;
  if (!includeNonPublic && row.work_count === 0) return null;
  return { ...mapCharacter(row), extra: parseExtra(row.extra_json) };
}
async function getTagBySlug(
  slug: string,
  includeNonPublic: boolean,
): Promise<PublicTagSummary | null> {
  const row = await getD1()
    .prepare(`${tagSql()} FROM tags t WHERE t.slug=? LIMIT 1`)
    .bind(slug)
    .first<TagRow>();
  if (!row || (!includeNonPublic && row.work_count === 0)) return null;
  return mapTag(row);
}
async function mergeCharacter(id: number, targetSlug: string): Promise<void> {
  const target = await getD1()
    .prepare(`SELECT id FROM characters WHERE slug=? LIMIT 1`)
    .bind(targetSlug)
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
async function mergeTag(id: number, targetSlug: string): Promise<void> {
  const target = await getD1()
    .prepare(`SELECT id FROM tags WHERE slug=? LIMIT 1`)
    .bind(targetSlug)
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
  return `SELECT ch.id,ch.slug,ch.primary_name,ch.original_name,ch.description,ch.extra_json,(SELECT COUNT(DISTINCT wc.work_id) FROM work_characters wc JOIN works w ON w.id=wc.work_id WHERE wc.character_id=ch.id AND w.status='published') AS work_count,ch.updated_at`;
}
function tagSql(): string {
  return `SELECT t.id,t.slug,t.name,t.namespace,t.description,(SELECT COUNT(DISTINCT wt.work_id) FROM work_tags wt JOIN works w ON w.id=wt.work_id WHERE wt.tag_id=t.id AND w.status='published') AS work_count,t.updated_at`;
}
function mapCharacter(row: CharacterRow): PublicCharacterSummary {
  return {
    id: row.id,
    slug: row.slug,
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
    slug: row.slug,
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
