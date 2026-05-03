import { getD1 } from "@/lib/server/db/d1";
import { listGameWorks, type GameWorkSummary } from "@/lib/server/db/game-library";

export type PublicCharacterSummary = {
  id: number;
  slug: string;
  primaryName: string;
  originalName: string | null;
  description: string | null;
  workCount: number;
  updatedAt: string;
};

export type PublicCharacterDetail = PublicCharacterSummary & {
  works: GameWorkSummary[];
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
  releaseCount: number;
  updatedAt: string;
};

export type PublicTagDetail = PublicTagSummary & {
  works: GameWorkSummary[];
};

export type AdminTagEdit = PublicTagSummary;

export type PublicSeriesSummary = {
  id: number;
  slug: string;
  title: string;
  titleOriginal: string | null;
  description: string | null;
  status: string;
  workCount: number;
  updatedAt: string;
};

export type PublicSeriesDetail = PublicSeriesSummary & {
  works: SeriesWork[];
};

export type AdminSeriesEdit = PublicSeriesDetail & {
  extra: Record<string, unknown>;
};

export type SeriesWork = {
  workId: number;
  slug: string;
  title: string;
  originalTitle: string;
  positionNumber: number | null;
  positionLabel: string | null;
  relationKind: string;
  notes: string | null;
  status: string;
};

type CharacterRow = {
  id: number;
  slug: string;
  primary_name: string;
  original_name: string | null;
  description: string | null;
  extra_json?: string;
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
  release_count: number;
  updated_at: string;
};

type SeriesRow = {
  id: number;
  slug: string;
  title: string;
  title_original: string | null;
  description: string | null;
  status: string;
  extra_json?: string;
  work_count: number;
  updated_at: string;
};

type SeriesWorkRow = {
  work_id: number;
  slug: string;
  title: string;
  original_title: string;
  position_number: number | null;
  position_label: string | null;
  relation_kind: string;
  notes: string | null;
  status: string;
};

export async function listPublicCharacters(input: {
  query?: string;
  limit?: number;
} = {}): Promise<PublicCharacterSummary[]> {
  const where = [
    `EXISTS (
      SELECT 1
      FROM work_characters wc
      JOIN works w ON w.id = wc.work_id
      WHERE wc.character_id = ch.id
        AND w.status = 'published'
    )`,
  ];
  const binds: Array<string | number> = [];
  const query = input.query?.trim();

  if (query) {
    const pattern = `%${query}%`;
    where.push("(ch.primary_name LIKE ? OR ch.original_name LIKE ?)");
    binds.push(pattern, pattern);
  }

  const rows = await getD1()
    .prepare(
      `${characterSummarySelectSql()}
      FROM characters ch
      WHERE ${where.join(" AND ")}
      ORDER BY work_count DESC, ch.primary_name ASC
      LIMIT ?`,
    )
    .bind(...binds, clampLimit(input.limit ?? 120, 1, 300))
    .all<CharacterRow>();

  return (rows.results ?? []).map(mapCharacterSummary);
}

export async function getPublicCharacterDetail(
  slug: string,
): Promise<PublicCharacterDetail | null> {
  const character = await getCharacterBySlug(slug, false);

  if (!character) {
    return null;
  }

  const works = await listGameWorks({ character: character.slug, limit: 200 });

  return {
    ...character,
    works,
  };
}

export async function listCharactersForAdmin(limit = 300): Promise<PublicCharacterSummary[]> {
  const rows = await getD1()
    .prepare(
      `${characterSummarySelectSql()}
      FROM characters ch
      ORDER BY ch.updated_at DESC, ch.primary_name ASC
      LIMIT ?`,
    )
    .bind(clampLimit(limit, 1, 500))
    .all<CharacterRow>();

  return (rows.results ?? []).map(mapCharacterSummary);
}

export async function getCharacterForAdminEdit(
  characterId: number,
): Promise<AdminCharacterEdit | null> {
  const row = await getD1()
    .prepare(
      `${characterSummarySelectSql()},
        ch.extra_json
      FROM characters ch
      WHERE ch.id = ?
      LIMIT 1`,
    )
    .bind(characterId)
    .first<CharacterRow>();

  if (!row || typeof row.extra_json !== "string") {
    return null;
  }

  return {
    ...mapCharacterSummary(row),
    extra: parseExtraJson(row.extra_json),
  };
}

export async function updateCharacterForAdmin(input: {
  characterId: number;
  primaryName: string;
  originalName: string | null;
  description: string | null;
  mergeTargetSlug: string | null;
}): Promise<AdminCharacterEdit> {
  assertRequired(input.primaryName, "角色名");

  if (input.mergeTargetSlug) {
    await mergeCharacter(input.characterId, input.mergeTargetSlug);
    const merged = await getCharacterBySlug(input.mergeTargetSlug, true);

    if (!merged) {
      throw new Error("角色合并目标不存在");
    }

    const edit = await getCharacterForAdminEdit(merged.id);

    if (!edit) {
      throw new Error("角色合并后不可读取");
    }

    return edit;
  }

  await getD1()
    .prepare(
      `UPDATE characters
      SET primary_name = ?,
        original_name = ?,
        description = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(input.primaryName.trim(), input.originalName, input.description, input.characterId)
    .run();

  const updated = await getCharacterForAdminEdit(input.characterId);

  if (!updated) {
    throw new Error("角色更新后不可读取");
  }

  return updated;
}

export async function listPublicTags(input: {
  query?: string;
  limit?: number;
} = {}): Promise<PublicTagSummary[]> {
  const where = [
    `(EXISTS (
      SELECT 1
      FROM work_tags wt
      JOIN works w ON w.id = wt.work_id
      WHERE wt.tag_id = t.id
        AND w.status = 'published'
    )
    OR EXISTS (
      SELECT 1
      FROM release_tags rt
      JOIN releases r ON r.id = rt.release_id
      JOIN works w ON w.id = r.work_id
      WHERE rt.tag_id = t.id
        AND r.status = 'published'
        AND w.status = 'published'
    ))`,
  ];
  const binds: Array<string | number> = [];
  const query = input.query?.trim();

  if (query) {
    const pattern = `%${query}%`;
    where.push("(t.name LIKE ? OR t.slug LIKE ?)");
    binds.push(pattern, pattern);
  }

  const rows = await getD1()
    .prepare(
      `${tagSummarySelectSql()}
      FROM tags t
      WHERE ${where.join(" AND ")}
      ORDER BY work_count DESC, release_count DESC, t.name ASC
      LIMIT ?`,
    )
    .bind(...binds, clampLimit(input.limit ?? 120, 1, 300))
    .all<TagRow>();

  return (rows.results ?? []).map(mapTagSummary);
}

export async function getPublicTagDetail(slug: string): Promise<PublicTagDetail | null> {
  const tag = await getTagBySlug(slug);

  if (!tag) {
    return null;
  }

  const works = await listGameWorks({ tag: tag.slug, limit: 200 });

  return {
    ...tag,
    works,
  };
}

export async function listTagsForAdmin(limit = 300): Promise<PublicTagSummary[]> {
  const rows = await getD1()
    .prepare(
      `${tagSummarySelectSql()}
      FROM tags t
      ORDER BY t.updated_at DESC, t.name ASC
      LIMIT ?`,
    )
    .bind(clampLimit(limit, 1, 500))
    .all<TagRow>();

  return (rows.results ?? []).map(mapTagSummary);
}

export async function getTagForAdminEdit(tagId: number): Promise<AdminTagEdit | null> {
  const row = await getD1()
    .prepare(
      `${tagSummarySelectSql()}
      FROM tags t
      WHERE t.id = ?
      LIMIT 1`,
    )
    .bind(tagId)
    .first<TagRow>();

  return row ? mapTagSummary(row) : null;
}

export async function updateTagForAdmin(input: {
  tagId: number;
  name: string;
  namespace: string;
  description: string | null;
  mergeTargetSlug: string | null;
}): Promise<AdminTagEdit> {
  assertRequired(input.name, "标签名");
  assertEnum(input.namespace, ["genre", "theme", "character", "technical", "content", "other"], "标签命名空间");

  if (input.mergeTargetSlug) {
    await mergeTag(input.tagId, input.mergeTargetSlug);
    const merged = await getTagBySlug(input.mergeTargetSlug);

    if (!merged) {
      throw new Error("标签合并目标不存在");
    }

    return merged;
  }

  await getD1()
    .prepare(
      `UPDATE tags
      SET name = ?,
        namespace = ?,
        description = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(input.name.trim(), input.namespace, input.description, input.tagId)
    .run();

  const updated = await getTagForAdminEdit(input.tagId);

  if (!updated) {
    throw new Error("标签更新后不可读取");
  }

  return updated;
}

export async function listPublicSeries(input: {
  query?: string;
  limit?: number;
} = {}): Promise<PublicSeriesSummary[]> {
  const where = [
    "s.status = 'published'",
    `EXISTS (
      SELECT 1
      FROM work_series ws
      JOIN works w ON w.id = ws.work_id
      WHERE ws.series_id = s.id
        AND w.status = 'published'
    )`,
  ];
  const binds: Array<string | number> = [];
  const query = input.query?.trim();

  if (query) {
    const pattern = `%${query}%`;
    where.push("(s.title LIKE ? OR s.title_original LIKE ? OR s.slug LIKE ?)");
    binds.push(pattern, pattern, pattern);
  }

  const rows = await getD1()
    .prepare(
      `${seriesSummarySelectSql()}
      FROM series s
      WHERE ${where.join(" AND ")}
      ORDER BY s.title ASC
      LIMIT ?`,
    )
    .bind(...binds, clampLimit(input.limit ?? 120, 1, 300))
    .all<SeriesRow>();

  return (rows.results ?? []).map(mapSeriesSummary);
}

export async function getPublicSeriesDetail(slug: string): Promise<PublicSeriesDetail | null> {
  const series = await getSeriesBySlug(slug, false);

  if (!series) {
    return null;
  }

  const works = await listSeriesWorks(series.id, false);

  return {
    ...series,
    works,
  };
}

export async function listSeriesForAdmin(limit = 300): Promise<PublicSeriesSummary[]> {
  const rows = await getD1()
    .prepare(
      `${seriesSummarySelectSql()}
      FROM series s
      WHERE s.status <> 'deleted'
      ORDER BY s.updated_at DESC, s.title ASC
      LIMIT ?`,
    )
    .bind(clampLimit(limit, 1, 500))
    .all<SeriesRow>();

  return (rows.results ?? []).map(mapSeriesSummary);
}

export async function getSeriesForAdminEdit(seriesId: number): Promise<AdminSeriesEdit | null> {
  const row = await getD1()
    .prepare(
      `${seriesSummarySelectSql()},
        s.extra_json
      FROM series s
      WHERE s.id = ?
      LIMIT 1`,
    )
    .bind(seriesId)
    .first<SeriesRow>();

  if (!row || typeof row.extra_json !== "string") {
    return null;
  }

  return {
    ...mapSeriesSummary(row),
    works: await listSeriesWorks(row.id, true),
    extra: parseExtraJson(row.extra_json),
  };
}

export async function createSeriesForAdmin(input: {
  title: string;
  titleOriginal: string | null;
  slug: string | null;
}): Promise<PublicSeriesSummary> {
  assertRequired(input.title, "系列名");
  const slug = input.slug?.trim() || slugFromText(input.title, "series");

  await getD1()
    .prepare(
      `INSERT INTO series (slug, title, title_original, status, extra_json)
      VALUES (?, ?, ?, 'published', '{}')`,
    )
    .bind(slug, input.title.trim(), input.titleOriginal)
    .run();

  const created = await getSeriesBySlug(slug, true);

  if (!created) {
    throw new Error("系列创建后不可读取");
  }

  return created;
}

export async function updateSeriesForAdmin(input: {
  seriesId: number;
  title: string;
  titleOriginal: string | null;
  description: string | null;
  status: string;
}): Promise<AdminSeriesEdit> {
  assertRequired(input.title, "系列名");
  assertEnum(input.status, ["draft", "published", "hidden", "deleted"], "系列状态");

  await getD1()
    .prepare(
      `UPDATE series
      SET title = ?,
        title_original = ?,
        description = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(input.title.trim(), input.titleOriginal, input.description, input.status, input.seriesId)
    .run();

  const updated = await getSeriesForAdminEdit(input.seriesId);

  if (!updated) {
    throw new Error("系列更新后不可读取");
  }

  return updated;
}

export function parseCharacterEditForm(
  formData: FormData,
): Parameters<typeof updateCharacterForAdmin>[0] {
  return {
    characterId: positiveInteger(formData.get("character_id"), "Invalid character id"),
    primaryName: String(formData.get("primary_name") ?? "").trim(),
    originalName: cleanNullable(String(formData.get("original_name") ?? "")),
    description: cleanNullable(String(formData.get("description") ?? "")),
    mergeTargetSlug: cleanNullable(String(formData.get("merge_target_slug") ?? "")),
  };
}

export function parseTagEditForm(formData: FormData): Parameters<typeof updateTagForAdmin>[0] {
  return {
    tagId: positiveInteger(formData.get("tag_id"), "Invalid tag id"),
    name: String(formData.get("name") ?? "").trim(),
    namespace: String(formData.get("namespace") ?? "other"),
    description: cleanNullable(String(formData.get("description") ?? "")),
    mergeTargetSlug: cleanNullable(String(formData.get("merge_target_slug") ?? "")),
  };
}

export function parseSeriesCreateForm(
  formData: FormData,
): Parameters<typeof createSeriesForAdmin>[0] {
  return {
    title: String(formData.get("title") ?? "").trim(),
    titleOriginal: cleanNullable(String(formData.get("title_original") ?? "")),
    slug: cleanNullable(String(formData.get("slug") ?? "")),
  };
}

export function parseSeriesEditForm(
  formData: FormData,
): Parameters<typeof updateSeriesForAdmin>[0] {
  return {
    seriesId: positiveInteger(formData.get("series_id"), "Invalid series id"),
    title: String(formData.get("title") ?? "").trim(),
    titleOriginal: cleanNullable(String(formData.get("title_original") ?? "")),
    description: cleanNullable(String(formData.get("description") ?? "")),
    status: String(formData.get("status") ?? "published"),
  };
}

function characterSummarySelectSql(): string {
  return `SELECT
    ch.id,
    ch.slug,
    ch.primary_name,
    ch.original_name,
    ch.description,
    (
      SELECT COUNT(DISTINCT wc.work_id)
      FROM work_characters wc
      JOIN works w ON w.id = wc.work_id
      WHERE wc.character_id = ch.id
        AND w.status = 'published'
    ) AS work_count,
    ch.updated_at`;
}

function tagSummarySelectSql(): string {
  return `SELECT
    t.id,
    t.slug,
    t.name,
    t.namespace,
    t.description,
    (
      SELECT COUNT(DISTINCT wt.work_id)
      FROM work_tags wt
      JOIN works w ON w.id = wt.work_id
      WHERE wt.tag_id = t.id
        AND w.status = 'published'
    ) AS work_count,
    (
      SELECT COUNT(DISTINCT rt.release_id)
      FROM release_tags rt
      JOIN releases r ON r.id = rt.release_id
      JOIN works w ON w.id = r.work_id
      WHERE rt.tag_id = t.id
        AND r.status = 'published'
        AND w.status = 'published'
    ) AS release_count,
    t.updated_at`;
}

function seriesSummarySelectSql(): string {
  return `SELECT
    s.id,
    s.slug,
    s.title,
    s.title_original,
    s.description,
    s.status,
    (
      SELECT COUNT(DISTINCT ws.work_id)
      FROM work_series ws
      JOIN works w ON w.id = ws.work_id
      WHERE ws.series_id = s.id
        AND w.status = 'published'
    ) AS work_count,
    s.updated_at`;
}

async function getCharacterBySlug(
  slug: string,
  includeNonPublic: boolean,
): Promise<PublicCharacterSummary | null> {
  const routeSlugs = uniqueClean([slug, decodeRouteSlug(slug)]);
  const publicFilter = includeNonPublic
    ? ""
    : `AND EXISTS (
        SELECT 1
        FROM work_characters wc
        JOIN works w ON w.id = wc.work_id
        WHERE wc.character_id = ch.id
          AND w.status = 'published'
      )`;
  const row = await getD1()
    .prepare(
      `${characterSummarySelectSql()}
      FROM characters ch
      WHERE ch.slug IN (${routeSlugs.map(() => "?").join(", ")})
        ${publicFilter}
      LIMIT 1`,
    )
    .bind(...routeSlugs)
    .first<CharacterRow>();

  return row ? mapCharacterSummary(row) : null;
}

async function getTagBySlug(slug: string): Promise<PublicTagSummary | null> {
  const routeSlugs = uniqueClean([slug, decodeRouteSlug(slug)]);
  const row = await getD1()
    .prepare(
      `${tagSummarySelectSql()}
      FROM tags t
      WHERE t.slug IN (${routeSlugs.map(() => "?").join(", ")})
      LIMIT 1`,
    )
    .bind(...routeSlugs)
    .first<TagRow>();

  return row ? mapTagSummary(row) : null;
}

async function getSeriesBySlug(
  slug: string,
  includeNonPublic: boolean,
): Promise<PublicSeriesSummary | null> {
  const routeSlugs = uniqueClean([slug, decodeRouteSlug(slug)]);
  const row = await getD1()
    .prepare(
      `${seriesSummarySelectSql()}
      FROM series s
      WHERE s.slug IN (${routeSlugs.map(() => "?").join(", ")})
        ${includeNonPublic ? "AND s.status <> 'deleted'" : "AND s.status = 'published'"}
      LIMIT 1`,
    )
    .bind(...routeSlugs)
    .first<SeriesRow>();

  return row ? mapSeriesSummary(row) : null;
}

async function listSeriesWorks(
  seriesId: number,
  includeNonPublic: boolean,
): Promise<SeriesWork[]> {
  const statusSql = includeNonPublic ? "w.status <> 'deleted'" : "w.status = 'published'";
  const rows = await getD1()
    .prepare(
      `SELECT
        w.id AS work_id,
        w.slug,
        COALESCE(w.chinese_title, w.original_title) AS title,
        w.original_title,
        ws.position_number,
        ws.position_label,
        ws.relation_kind,
        ws.notes,
        w.status
      FROM work_series ws
      JOIN works w ON w.id = ws.work_id
      WHERE ws.series_id = ?
        AND ${statusSql}
      ORDER BY
        ws.position_number ASC,
        ws.position_label ASC,
        COALESCE(w.sort_title, w.chinese_title, w.original_title) ASC`,
    )
    .bind(seriesId)
    .all<SeriesWorkRow>();

  return (rows.results ?? []).map((row) => ({
    workId: row.work_id,
    slug: row.slug,
    title: row.title,
    originalTitle: row.original_title,
    positionNumber: row.position_number,
    positionLabel: row.position_label,
    relationKind: row.relation_kind,
    notes: row.notes,
    status: row.status,
  }));
}

async function mergeCharacter(characterId: number, targetSlug: string): Promise<void> {
  const target = await getCharacterBySlug(targetSlug, true);

  if (!target || target.id === characterId) {
    throw new Error("角色合并目标不合法");
  }

  await getD1()
    .prepare(
      `INSERT OR IGNORE INTO work_characters (
        work_id,
        character_id,
        role_key,
        spoiler_level,
        sort_order,
        notes
      )
      SELECT work_id, ?, role_key, spoiler_level, sort_order, notes
      FROM work_characters
      WHERE character_id = ?`,
    )
    .bind(target.id, characterId)
    .run();
  await getD1().prepare(`DELETE FROM work_characters WHERE character_id = ?`).bind(characterId).run();
  await getD1().prepare(`DELETE FROM characters WHERE id = ?`).bind(characterId).run();
}

async function mergeTag(tagId: number, targetSlug: string): Promise<void> {
  const target = await getTagBySlug(targetSlug);

  if (!target || target.id === tagId) {
    throw new Error("标签合并目标不合法");
  }

  await getD1()
    .prepare(
      `INSERT OR IGNORE INTO work_tags (work_id, tag_id, source)
      SELECT work_id, ?, source
      FROM work_tags
      WHERE tag_id = ?`,
    )
    .bind(target.id, tagId)
    .run();
  await getD1()
    .prepare(
      `INSERT OR IGNORE INTO release_tags (release_id, tag_id, source)
      SELECT release_id, ?, source
      FROM release_tags
      WHERE tag_id = ?`,
    )
    .bind(target.id, tagId)
    .run();
  await getD1().prepare(`DELETE FROM work_tags WHERE tag_id = ?`).bind(tagId).run();
  await getD1().prepare(`DELETE FROM release_tags WHERE tag_id = ?`).bind(tagId).run();
  await getD1().prepare(`DELETE FROM tags WHERE id = ?`).bind(tagId).run();
}

function mapCharacterSummary(row: CharacterRow): PublicCharacterSummary {
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

function mapTagSummary(row: TagRow): PublicTagSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    namespace: row.namespace,
    description: row.description,
    workCount: row.work_count,
    releaseCount: row.release_count,
    updatedAt: row.updated_at,
  };
}

function mapSeriesSummary(row: SeriesRow): PublicSeriesSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    titleOriginal: row.title_original,
    description: row.description,
    status: row.status,
    workCount: row.work_count,
    updatedAt: row.updated_at,
  };
}

function parseExtraJson(extraJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(extraJson) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Keep malformed metadata editable.
  }

  return {};
}

function positiveInteger(value: FormDataEntryValue | null, errorMessage: string): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(errorMessage);
  }

  return parsed;
}

function cleanNullable(value: string | null | undefined): string | null {
  const cleaned = value?.trim() ?? "";

  return cleaned || null;
}

function uniqueClean(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function slugFromText(value: string, fallback: string): string {
  return (
    value
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

function decodeRouteSlug(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function assertRequired(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} 不能为空`);
  }
}

function assertEnum(value: string, allowed: string[], label: string): void {
  if (!allowed.includes(value)) {
    throw new Error(`${label} 不合法`);
  }
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}
