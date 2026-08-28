import { isLanguageCode } from "@/lib/labels";
import { normalizeEntityName } from "@/lib/entity-name";
import { getD1 } from "@/lib/server/db/d1";
import { assertTranslationLanguageChangeAllowed } from "@/lib/server/db/relations";
import { ensureCurrentArchiveVersion } from "@/lib/server/db/archive-maintenance";
import { isHttpUrl, normalizeHttpUrl } from "@/lib/server/http/safe-url";
import { HttpError } from "@/lib/server/http/json";

export type GameTag = { id: number; name: string; namespace: string };
export type GameCharacter = {
  id: number;
  primaryName: string;
  originalName: string | null;
  roleKey: string;
  spoilerLevel: number;
  sortOrder: number | null;
  notes: string | null;
};
export type GameCreatorCredit = {
  id: number;
  name: string;
  originalName: string | null;
  websiteUrl: string | null;
  roleKey: string;
  roleLabel: string | null;
};
export type GameMediaAsset = {
  blobSha256: string;
  kind: string;
  title: string | null;
  altText: string | null;
  sortOrder: number | null;
  isPrimary: boolean;
};
export type GameExternalLink = {
  id: number;
  label: string;
  url: string;
  linkType: string;
};
export type GameArchiveVersionDetail = {
  id: number;
  language: string;
  isCurrent: boolean;
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  publishedAt: string | null;
  uploaderName: string | null;
};
export type GameWorkRelation = {
  id: number;
  direction: "from";
  relationType: string;
  notes: string | null;
  workId: number;
  title: string;
  relationOrder: number;
  viceVersa: boolean;
  createdByUserId: number | null;
};
export type GameTranslationRelation = {
  id: number;
  role: "original" | "translation";
  workId: number;
  title: string;
  language: string;
  relationOrder: number;
  createdByUserId: number | null;
};
export type GameWorkSummary = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  originalReleasePrecision: string;
  engineFamily: string;
  isOriginal: boolean;
  language: string;
  status: string;
  previewBlobSha256: string | null;
  archiveVersionCount: number;
  totalSizeBytes: number;
  latestPublishedAt: string | null;
  tags: GameTag[];
  characters: GameCharacter[];
  creators: GameCreatorCredit[];
};
export type GameWorkDetail = GameWorkSummary & {
  aliases: string[];
  media: GameMediaAsset[];
  externalLinks: GameExternalLink[];
  archiveVersions: GameArchiveVersionDetail[];
  relations: GameWorkRelation[];
  translations: GameTranslationRelation[];
  parallelTranslations: GameTranslationRelation[];
};
export type AdminWorkEdit = {
  id: number;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  originalReleasePrecision: string;
  engineFamily: string;
  isOriginal: boolean;
  language: string;
  status: "draft" | "published" | "hidden" | "deleted";
  aliases: string[];
  tags: string[];
  characters: string[];
  characterCredits: GameCharacter[];
  media: GameMediaAsset[];
  outgoingRelations: GameWorkRelation[];
  translations: GameTranslationRelation[];
  parallelTranslations: GameTranslationRelation[];
  externalLinks: GameExternalLink[];
};
export type AdminArchiveVersionEdit = {
  id: number;
  workId: number;
  workTitle: string;
  language: string;
  isCurrent: boolean;
  status: "draft" | "published" | "hidden";
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  manifestSha256: string;
  filePolicyVersion: string;
  packerVersion: string;
  sourceType: string;
  sourceName: string | null;
  sourceFileCount: number;
  sourceSizeBytes: number;
  excludedFileCount: number;
  excludedSizeBytes: number;
  createdAt: string;
  publishedAt: string | null;
  uploaderName: string | null;
  sourceUrl: string | null;
};

type Filters = {
  query?: string;
  engine?: string;
  tag?: number;
  character?: number;
  isOriginal?: boolean;
  language?: string;
  includeNonPublic?: boolean;
};
type ListInput = Filters & {
  sort?: "id" | "title" | "engine";
  limit?: number;
  offset?: number;
};
type SummaryRow = {
  id: number;
  original_title: string;
  chinese_title: string | null;
  description: string | null;
  original_release_date: string | null;
  original_release_precision: string;
  engine_family: string;
  is_original: number;
  language: string;
  status: string;
  preview_blob_sha256: string | null;
  archive_version_count: number;
  total_size_bytes: number | null;
  latest_published_at: string | null;
};
type WorkRow = SummaryRow & {
};
type ArchiveEditRow = {
  id: number;
  work_id: number;
  work_title: string;
  work_language: string;
  is_current: number;
  status: "draft" | "published" | "hidden";
  total_files: number;
  total_size_bytes: number;
  estimated_r2_get_count: number;
  manifest_sha256: string;
  file_policy_version: string;
  packer_version: string;
  source_type: string;
  source_name: string | null;
  source_file_count: number;
  source_size_bytes: number;
  excluded_file_count: number;
  excluded_size_bytes: number;
  created_at: string;
  published_at: string | null;
  uploader_name: string | null;
  source_url: string | null;
};
type WorkEditInput = {
  workId: number;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  originalReleasePrecision: string;
  engineFamily: string;
  isOriginal: boolean;
  language: string;
  status: string;
  aliases: string[];
  tags: string[];
  characters: string[];
  previewBlobSha256s: string[];
  outgoingRelations: GameWorkRelation[];
  externalLinks: GameExternalLink[];
};
type ArchiveEditInput = {
  archiveVersionId: number;
  status: string;
  sourceName: string | null;
  sourceUrl: string | null;
};
const LINK_TYPES = [
  "official",
  "wiki",
  "source",
  "video",
  "download_page",
  "other",
] as const;

export async function listGameWorks(
  input: ListInput = {},
): Promise<GameWorkSummary[]> {
  const { where, binds } = buildWhere(input);
  const limit = clamp(input.limit ?? 80, 1, 200),
    offset = Math.max(0, Math.floor(input.offset ?? 0));
  const order =
    input.sort === "title"
      ? "COALESCE(w.chinese_title,w.original_title) ASC"
      : input.sort === "engine"
        ? "w.engine_family ASC,w.original_title ASC"
        : "w.id DESC";
  const rows = await getD1()
    .prepare(
      `SELECT ${summarySql()} FROM works w LEFT JOIN archive_versions av ON av.work_id=w.id AND av.status='published' AND av.is_current=1 WHERE ${where} GROUP BY w.id ORDER BY ${order},w.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all<SummaryRow>();
  return hydrate(rows.results ?? []);
}
export async function countGameWorks(input: Filters = {}): Promise<number> {
  const { where, binds } = buildWhere(input);
  const row = await getD1()
    .prepare(`SELECT COUNT(*) AS count FROM works w WHERE ${where}`)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
export type PaginatedGameSearch = {
  items: GameWorkSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
export async function searchGameWorks(input: {
  query: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedGameSearch> {
  const pageSize = clamp(input.pageSize ?? 24, 1, 100),
    page = clamp(input.page ?? 1, 1, 9999),
    total = await countGameWorks({ query: input.query });
  return {
    items: await listGameWorks({
      query: input.query,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
export async function getGameWorkDetail(
  id: number,
): Promise<GameWorkDetail | null> {
  const row = await getD1()
    .prepare(
      `SELECT ${summarySql()} FROM works w LEFT JOIN archive_versions av ON av.work_id=w.id AND av.status='published' AND av.is_current=1 WHERE w.id=? AND w.status='published' GROUP BY w.id LIMIT 1`,
    )
    .bind(id)
    .first<
      SummaryRow
    >();
  if (!row) return null;
  const [summary] = await hydrate([row]);
  const [aliases, media, links, archives, relations, translations] =
    await Promise.all([
      listAliases(row.id),
      listMedia(row.id),
      listLinks(row.id),
      listArchives(row.id),
      listRelations(row.id),
      listTranslations(row.id),
    ]);
  const originalId =
    translations.find((item) => item.role === "original")?.workId ??
    (translations.some((item) => item.role === "translation") ? row.id : null);
  return {
    ...summary,
    aliases,
    media,
    externalLinks: links,
    archiveVersions: archives,
    relations,
    translations,
    parallelTranslations: originalId ? await listTranslations(originalId) : [],
  };
}
export async function listEditableWorksForAdmin(
  limit = 200,
): Promise<GameWorkSummary[]> {
  return listGameWorks({ includeNonPublic: true, limit });
}
export async function getWorkForAdminEdit(
  workId: number,
): Promise<AdminWorkEdit | null> {
  const row = await getD1()
    .prepare(
      `SELECT w.* FROM works w WHERE w.id=? LIMIT 1`,
    )
    .bind(workId)
    .first<WorkRow>();
  if (!row) return null;
  const [aliases, tags, characters, media, relations, translations, links] =
    await Promise.all([
      listAliases(workId),
      listTags(workId),
      listCharacters(workId),
      listMedia(workId),
      listRelations(workId, true),
      listTranslations(workId, true),
      listLinks(workId),
    ]);
  const originalId =
    translations.find((item) => item.role === "original")?.workId ??
    (translations.some((item) => item.role === "translation") ? row.id : null);
  return {
    id: row.id,
    originalTitle: row.original_title,
    chineseTitle: row.chinese_title,
    description: row.description,
    originalReleaseDate: row.original_release_date,
    originalReleasePrecision: row.original_release_precision,
    engineFamily: row.engine_family,
    isOriginal: row.is_original === 1,
    language: row.language,
    status: row.status as AdminWorkEdit["status"],
    aliases,
    tags: tags.map((item) => item.name),
    characters: characters.map((item) => item.primaryName),
    characterCredits: characters,
    media,
    outgoingRelations: relations,
    translations,
    parallelTranslations: originalId
      ? await listTranslations(originalId, true)
      : [],
    externalLinks: links,
  };
}
export async function updateWorkForAdmin(
  input: WorkEditInput,
): Promise<AdminWorkEdit> {
  assertEnum(
    input.originalReleasePrecision,
    ["year", "month", "day", "unknown"],
    "发布日期精度",
  );
  assertEnum(
    input.engineFamily,
    [
      "rpg_maker_2000",
      "rpg_maker_2003",
      "rpg_maker_2003_maniac",
      "rpg_maker_xp",
      "rpg_maker_vx",
      "rpg_maker_vx_ace",
      "rpg_maker_mv",
      "rpg_maker_mz",
      "rpg_maker_unite",
      "mixed",
      "unknown",
      "other",
    ],
    "引擎",
  );
  assertEnum(input.status, ["draft", "published", "hidden"], "状态");
  if (!isLanguageCode(input.language)) throw new Error("语言不合法");
  const externalLinks = normalizeExternalLinks(input.externalLinks);
  await assertTranslationLanguageChangeAllowed(input.workId, input.language);
  await replaceMedia(input.workId, input.previewBlobSha256s);
  await getD1()
    .prepare(
      `UPDATE works
       SET chinese_title = ?,
         description = ?,
         original_release_date = ?,
         original_release_precision = ?,
         engine_family = ?,
         is_original = ?,
         language = ?,
         status = ?,
         updated_at = CURRENT_TIMESTAMP,
         published_at = CASE
           WHEN ? = 'published' THEN COALESCE(published_at, CURRENT_TIMESTAMP)
           ELSE published_at
         END
       WHERE id = ?`,
    )
    .bind(
      input.chineseTitle,
      input.description,
      input.originalReleaseDate,
      input.originalReleasePrecision,
      input.engineFamily,
      input.isOriginal ? 1 : 0,
      input.language,
      input.status,
      input.status,
      input.workId,
    )
    .run();
  await replaceAliases(input.workId, input.aliases);
  await replaceTags(input.workId, input.tags);
  await replaceCharacters(input.workId, input.characters);
  await replaceLinks(input.workId, externalLinks);
  const updated = await getWorkForAdminEdit(input.workId);
  if (!updated) throw new Error("游戏更新后不可读取");
  return updated;
}
export async function getArchiveVersionForAdminEdit(
  id: number,
): Promise<AdminArchiveVersionEdit | null> {
  const row = await getD1()
    .prepare(
      `SELECT av.*,
          COALESCE(w.chinese_title, w.original_title) AS work_title,
          w.language AS work_language,
          u.display_name AS uploader_name
       FROM archive_versions av
       JOIN works w ON w.id = av.work_id
       LEFT JOIN users u ON u.id = av.uploader_id
       WHERE av.id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<ArchiveEditRow>();
  if (!row) return null;
  return {
    id: row.id,
    workId: row.work_id,
    workTitle: row.work_title,
    language: row.work_language,
    isCurrent: row.is_current === 1,
    status: row.status,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
    estimatedR2GetCount: row.estimated_r2_get_count,
    manifestSha256: row.manifest_sha256,
    filePolicyVersion: row.file_policy_version,
    packerVersion: row.packer_version,
    sourceType: row.source_type,
    sourceName: row.source_name,
    sourceFileCount: row.source_file_count,
    sourceSizeBytes: row.source_size_bytes,
    excludedFileCount: row.excluded_file_count,
    excludedSizeBytes: row.excluded_size_bytes,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    uploaderName: row.uploader_name,
    sourceUrl: row.source_url,
  };
}
export async function updateArchiveVersionForAdmin(
  input: ArchiveEditInput,
): Promise<AdminArchiveVersionEdit> {
  assertEnum(input.status, ["draft", "published", "hidden"], "状态");
  const before = await getD1()
    .prepare(
      `SELECT work_id,is_current,status,purged_at FROM archive_versions WHERE id=? LIMIT 1`,
    )
    .bind(input.archiveVersionId)
    .first<{
      work_id: number;
      is_current: number;
      status: string;
      purged_at: string | null;
    }>();
  if (!before) throw new Error("归档不存在");
  if (before.purged_at) throw new Error("归档已最终清理，不能修改");
  if (before.status === "deleted")
    throw new Error("已移入回收站的归档必须先恢复");
  const sourceUrl = normalizeHttpUrl(input.sourceUrl, "来源网址");
  const update = getD1()
    .prepare(
      `UPDATE archive_versions
       SET status = ?,
         source_name = ?,
         source_url = ?,
         is_current = CASE
           WHEN ? <> 'published' THEN 0
           ELSE is_current
         END
       WHERE id = ?
         AND purged_at IS NULL
         AND status <> 'deleted'`,
    )
    .bind(
      input.status,
      input.sourceName,
      sourceUrl,
      input.status,
      input.archiveVersionId,
    );
  await update.run();
  if (before.is_current === 1 && input.status !== "published")
    await ensureCurrentArchiveVersion(before.work_id);
  const updated = await getArchiveVersionForAdminEdit(input.archiveVersionId);
  if (!updated) throw new Error("归档更新后不可读取");
  return updated;
}
export function parseWorkEditForm(form: FormData): WorkEditInput {
  return {
    workId: positive(form.get("work_id")),
    chineseTitle: clean(form.get("chinese_title")),
    description: clean(form.get("description")),
    originalReleaseDate: clean(form.get("original_release_date")),
    originalReleasePrecision: String(
      form.get("original_release_precision") ?? "unknown",
    ),
    engineFamily: String(form.get("engine_family") ?? "unknown"),
    isOriginal: checked(form, "is_original"),
    language: String(form.get("language") ?? "zh-CN"),
    status: String(form.get("status") ?? "draft"),
    aliases: lines(form.get("aliases")),
    tags: lines(form.get("tags")),
    characters: lines(form.get("characters")),
    previewBlobSha256s: lines(form.get("preview_blob_sha256s")),
    outgoingRelations: [],
    externalLinks: parseLinks(form.get("external_links")),
  };
}
export function parseArchiveVersionEditForm(form: FormData): ArchiveEditInput {
  return {
    archiveVersionId: positive(form.get("archive_version_id")),
    status: String(form.get("status") ?? "published"),
    sourceName: clean(form.get("source_name")),
    sourceUrl: clean(form.get("source_url")),
  };
}
function summarySql(): string {
  return `
    w.id,
    w.original_title,
    w.chinese_title,
    w.description,
    w.original_release_date,
    w.original_release_precision,
    w.engine_family,
    w.is_original,
    w.language,
    w.status,
    (
      SELECT ma.blob_sha256
      FROM work_media_assets wma
      JOIN media_assets ma ON ma.id = wma.media_asset_id
      WHERE wma.work_id = w.id
        AND ma.kind = 'preview'
      ORDER BY wma.is_primary DESC, wma.sort_order
      LIMIT 1
    ) AS preview_blob_sha256,
    (
      SELECT COUNT(*)
      FROM archive_versions av2
      WHERE av2.work_id = w.id
    ) AS archive_version_count,
    (
      SELECT COALESCE(SUM(av2.total_size_bytes), 0)
      FROM archive_versions av2
      WHERE av2.work_id = w.id
        AND av2.status = 'published'
        AND av2.is_current = 1
    ) AS total_size_bytes,
    (
      SELECT MAX(av2.published_at)
      FROM archive_versions av2
      WHERE av2.work_id = w.id
        AND av2.status = 'published'
    ) AS latest_published_at`;
}
function buildWhere(input: Filters): {
  where: string;
  binds: Array<string | number>;
} {
  const clauses = [
      input.includeNonPublic ? "w.status <> 'deleted'" : "w.status='published'",
    ],
    binds: Array<string | number> = [];
  if (input.query) {
    const q = `%${input.query}%`;
    clauses.push(
      `(w.original_title LIKE ? OR w.chinese_title LIKE ? OR EXISTS(SELECT 1 FROM work_titles wtq WHERE wtq.work_id=w.id AND wtq.title LIKE ?))`,
    );
    binds.push(q, q, q);
  }
  if (input.engine && input.engine !== "all") {
    clauses.push("w.engine_family=?");
    binds.push(input.engine);
  }
  if (input.isOriginal !== undefined) {
    clauses.push("w.is_original=?");
    binds.push(input.isOriginal ? 1 : 0);
  }
  if (input.language) {
    clauses.push("w.language=?");
    binds.push(input.language);
  }
  if (input.tag) {
    clauses.push(
      "EXISTS(SELECT 1 FROM work_tags wt JOIN tags t ON t.id=wt.tag_id WHERE wt.work_id=w.id AND t.id=?)",
    );
    binds.push(input.tag);
  }
  if (input.character) {
    clauses.push(
      "EXISTS(SELECT 1 FROM work_characters wc JOIN characters c ON c.id=wc.character_id WHERE wc.work_id=w.id AND c.id=?)",
    );
    binds.push(input.character);
  }
  return { where: clauses.join(" AND "), binds };
}
async function hydrate(rows: SummaryRow[]): Promise<GameWorkSummary[]> {
  const output: GameWorkSummary[] = [];
  for (const row of rows) {
    const [tags, characters, creators] = await Promise.all([
      listTags(row.id),
      listCharacters(row.id),
      listCreators(row.id),
    ]);
    output.push({
      id: row.id,
      originalTitle: row.original_title,
      chineseTitle: row.chinese_title,
      description: row.description,
      originalReleaseDate: row.original_release_date,
      originalReleasePrecision: row.original_release_precision,
      engineFamily: row.engine_family,
      isOriginal: row.is_original === 1,
      language: row.language,
      status: row.status,
      previewBlobSha256: row.preview_blob_sha256,
      archiveVersionCount: row.archive_version_count,
      totalSizeBytes: row.total_size_bytes ?? 0,
      latestPublishedAt: row.latest_published_at,
      tags,
      characters,
      creators,
    });
  }
  return output;
}
async function listAliases(id: number): Promise<string[]> {
  const rows = await getD1()
    .prepare(`SELECT title FROM work_titles WHERE work_id=? ORDER BY id`)
    .bind(id)
    .all<{ title: string }>();
  return (rows.results ?? []).map((row) => row.title);
}
async function listTags(id: number): Promise<GameTag[]> {
  const rows = await getD1()
    .prepare(
      `SELECT t.id,t.name,t.namespace FROM work_tags wt JOIN tags t ON t.id=wt.tag_id WHERE wt.work_id=? ORDER BY t.name`,
    )
    .bind(id)
    .all<GameTag>();
  return rows.results ?? [];
}
async function listCharacters(id: number): Promise<GameCharacter[]> {
  const rows = await getD1()
    .prepare(
      `SELECT c.id,c.primary_name,c.original_name,wc.role_key,wc.spoiler_level,wc.sort_order,wc.notes FROM work_characters wc JOIN characters c ON c.id=wc.character_id WHERE wc.work_id=? ORDER BY wc.sort_order,c.primary_name`,
    )
    .bind(id)
    .all<{
      id: number;
      primary_name: string;
      original_name: string | null;
      role_key: string;
      spoiler_level: number;
      sort_order: number | null;
      notes: string | null;
    }>();
  return (rows.results ?? []).map((x) => ({
    id: x.id,
    primaryName: x.primary_name,
    originalName: x.original_name,
    roleKey: x.role_key,
    spoilerLevel: x.spoiler_level,
    sortOrder: x.sort_order,
    notes: x.notes,
  }));
}
async function listCreators(id: number): Promise<GameCreatorCredit[]> {
  const rows = await getD1()
    .prepare(
      `SELECT c.id,c.name,c.original_name,c.website_url,ws.role_key,ws.role_label FROM work_staff ws JOIN creators c ON c.id=ws.creator_id WHERE ws.work_id=? ORDER BY c.name`,
    )
    .bind(id)
    .all<{
      id: number;
      name: string;
      original_name: string | null;
      website_url: string | null;
      role_key: string;
      role_label: string | null;
    }>();
  return (rows.results ?? []).map((x) => ({
    id: x.id,
    name: x.name,
    originalName: x.original_name,
    websiteUrl: isHttpUrl(x.website_url) ? x.website_url : null,
    roleKey: x.role_key,
    roleLabel: x.role_label,
  }));
}
async function listMedia(id: number): Promise<GameMediaAsset[]> {
  const rows = await getD1()
    .prepare(
      `SELECT ma.blob_sha256,ma.kind,ma.title,ma.alt_text,wma.sort_order,wma.is_primary FROM work_media_assets wma JOIN media_assets ma ON ma.id=wma.media_asset_id WHERE wma.work_id=? ORDER BY wma.sort_order`,
    )
    .bind(id)
    .all<{
      blob_sha256: string;
      kind: string;
      title: string | null;
      alt_text: string | null;
      sort_order: number | null;
      is_primary: number;
    }>();
  return (rows.results ?? []).map((x) => ({
    blobSha256: x.blob_sha256,
    kind: x.kind,
    title: x.title,
    altText: x.alt_text,
    sortOrder: x.sort_order,
    isPrimary: x.is_primary === 1,
  }));
}
async function listLinks(id: number): Promise<GameExternalLink[]> {
  const rows = await getD1()
    .prepare(
      `SELECT id,label,url,link_type FROM work_external_links WHERE work_id=? ORDER BY id`,
    )
    .bind(id)
    .all<{ id: number; label: string; url: string; link_type: string }>();
  return (rows.results ?? [])
    .filter((x) => isHttpUrl(x.url))
    .map((x) => ({
      id: x.id,
      label: x.label,
      url: x.url,
      linkType: x.link_type,
    }));
}
async function listArchives(id: number): Promise<GameArchiveVersionDetail[]> {
  const rows = await getD1()
    .prepare(
      `SELECT av.id,
          w.language,
          av.is_current,
          av.total_files,
          av.total_size_bytes,
          av.estimated_r2_get_count,
          av.published_at,
          u.display_name AS uploader_name
       FROM archive_versions av
       JOIN works w ON w.id = av.work_id
       LEFT JOIN users u ON u.id = av.uploader_id
       WHERE av.work_id = ?
         AND av.status = 'published'
         AND av.is_current = 1
       ORDER BY av.id DESC`,
    )
    .bind(id)
    .all<{
      id: number;
      language: string;
      is_current: number;
      total_files: number;
      total_size_bytes: number;
      estimated_r2_get_count: number;
      published_at: string | null;
      uploader_name: string | null;
    }>();
  return (rows.results ?? []).map((x) => ({
    id: x.id,
    language: x.language,
    isCurrent: x.is_current === 1,
    totalFiles: x.total_files,
    totalSizeBytes: x.total_size_bytes,
    estimatedR2GetCount: x.estimated_r2_get_count,
    publishedAt: x.published_at,
    uploaderName: x.uploader_name,
  }));
}
async function listRelations(
  id: number,
  includeNonPublic = false,
): Promise<GameWorkRelation[]> {
  const targetStatus = includeNonPublic
    ? "w.status <> 'deleted'"
    : "w.status='published'";
  const rows = await getD1()
    .prepare(
      `SELECT wr.id,
          wr.relation_type,
          wr.notes,
          wr.relation_order,
          wr.vice_versa,
          wr.created_by_user_id,
          w.id AS work_id,
          COALESCE(w.chinese_title, w.original_title) AS title
       FROM work_relations wr
       JOIN works w ON w.id = wr.to_work_id
       WHERE wr.from_work_id = ?
         AND ${targetStatus}
       ORDER BY wr.relation_order, wr.id`,
    )
    .bind(id)
    .all<{
      id: number;
      relation_type: string;
      notes: string | null;
      relation_order: number;
      vice_versa: number;
      created_by_user_id: number | null;
      work_id: number;
      title: string;
    }>();
  return (rows.results ?? []).map((x) => ({
    id: x.id,
    direction: "from",
    relationType: x.relation_type,
    notes: x.notes,
    relationOrder: x.relation_order,
    viceVersa: x.vice_versa === 1,
    createdByUserId: x.created_by_user_id,
    workId: x.work_id,
    title: x.title,
  }));
}
async function listTranslations(
  id: number,
  includeNonPublic = false,
): Promise<GameTranslationRelation[]> {
  const targetStatus = includeNonPublic
    ? "w.status <> 'deleted'"
    : "w.status='published'";
  const rows = await getD1()
    .prepare(
      `SELECT tr.id,
          tr.target_role AS role,
          tr.relation_order,
          tr.created_by_user_id,
          w.id AS work_id,
          COALESCE(w.chinese_title, w.original_title) AS title,
          w.language
       FROM translation_relations tr
       JOIN works w ON w.id = tr.target_work_id
       WHERE tr.source_work_id = ?
         AND ${targetStatus}
       ORDER BY tr.relation_order, tr.id`,
    )
    .bind(id)
    .all<{
      id: number;
      role: "original" | "translation";
      relation_order: number;
      created_by_user_id: number | null;
      work_id: number;
      title: string;
      language: string;
    }>();
  return (rows.results ?? []).map((x) => ({
    id: x.id,
    role: x.role,
    workId: x.work_id,
    title: x.title,
    language: x.language,
    relationOrder: x.relation_order,
    createdByUserId: x.created_by_user_id,
  }));
}
async function replaceAliases(id: number, values: string[]): Promise<void> {
  await getD1()
    .prepare(`DELETE FROM work_titles WHERE work_id=?`)
    .bind(id)
    .run();
  for (const value of values.map((x) => x.trim()).filter(Boolean))
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO work_titles(work_id,title,title_type) VALUES(?,?,'alias')`,
      )
      .bind(id, value)
      .run();
}
async function replaceTags(id: number, values: string[]): Promise<void> {
  await getD1().prepare(`DELETE FROM work_tags WHERE work_id=?`).bind(id).run();
  for (const value of values.map(normalizeEntityName).filter(Boolean)) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO tags(name,namespace) VALUES(?, 'other')`,
      )
      .bind(value)
      .run();
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO work_tags(work_id,tag_id,source) SELECT ?,id,'admin' FROM tags WHERE name=? COLLATE NOCASE`,
      )
      .bind(id, value)
      .run();
  }
}
async function replaceCharacters(id: number, values: string[]): Promise<void> {
  await getD1()
    .prepare(`DELETE FROM work_characters WHERE work_id=?`)
    .bind(id)
    .run();
  for (const value of values.map((x) => x.split("|")[0]).map(normalizeEntityName).filter(Boolean)) {
    const name = value;
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO characters(primary_name) VALUES(?)`,
      )
      .bind(name)
      .run();
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO work_characters(work_id,character_id) SELECT ?,id FROM characters WHERE primary_name=? COLLATE NOCASE`,
      )
      .bind(id, name)
      .run();
  }
}
async function replaceLinks(
  id: number,
  values: GameExternalLink[],
): Promise<void> {
  const links = normalizeExternalLinks(values);
  const database = getD1();
  const statements = [
    database
      .prepare(`DELETE FROM work_external_links WHERE work_id=?`)
      .bind(id),
    ...links.map((link) =>
      database
        .prepare(
          `INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(?,?,?,?)`,
        )
        .bind(id, link.label, link.url, link.linkType),
    ),
  ];
  await database.batch(statements);
}
function normalizeExternalLinks(
  values: GameExternalLink[],
): GameExternalLink[] {
  return values
    .filter(
      (link) =>
        link &&
        typeof link.label === "string" &&
        typeof link.url === "string" &&
        link.label.trim() &&
        link.url.trim(),
    )
    .map((link, index) => {
      if (!LINK_TYPES.includes(link.linkType as (typeof LINK_TYPES)[number]))
        throw new HttpError(400, "作品外链类型不合法");
      const url = normalizeHttpUrl(link.url, "作品外链");
      if (!url) throw new HttpError(400, "作品外链不能为空");
      return {
        id: index,
        label: link.label.trim(),
        url,
        linkType: link.linkType,
      };
    });
}
async function replaceMedia(workId: number, values: string[]): Promise<void> {
  const hashes = [
    ...new Set(
      values.map((value) => value.trim().toLowerCase()).filter(Boolean),
    ),
  ];
  if (hashes.some((value) => !/^[a-f0-9]{64}$/.test(value)))
    throw new Error("浏览图 SHA-256 不合法");
  if (hashes.length) {
    const rows = await getD1()
      .prepare(
        `SELECT sha256 FROM blobs WHERE status='active' AND sha256 IN (${hashes.map(() => "?").join(",")})`,
      )
      .bind(...hashes)
      .all<{ sha256: string }>();
    if ((rows.results ?? []).length !== hashes.length)
      throw new Error("浏览图对象不存在");
  }
  const database = getD1();
  const statements = [
    database
      .prepare(
        `DELETE FROM work_media_assets WHERE work_id=? AND media_asset_id IN (SELECT id FROM media_assets WHERE kind='preview')`,
      )
      .bind(workId),
  ];
  for (const hash of hashes) {
    statements.push(
      database
        .prepare(
          `INSERT OR IGNORE INTO media_assets(blob_sha256,kind) VALUES(?,'preview')`,
        )
        .bind(hash),
    );
  }
  await database.batch(statements);
  const links = [];
  for (const hash of hashes) {
    const row = await database
      .prepare(
        `SELECT id FROM media_assets WHERE blob_sha256=? AND kind='preview' LIMIT 1`,
      )
      .bind(hash)
      .first<{ id: number }>();
    if (row) links.push(row.id);
  }
  if (links.length) {
    await database.batch(
      links.map((mediaAssetId, index) =>
        database
          .prepare(
            `INSERT INTO work_media_assets(work_id,media_asset_id,sort_order,is_primary) VALUES(?,?,?,?)`,
          )
          .bind(workId, mediaAssetId, index + 1, index === 0 ? 1 : 0),
      ),
    );
  }
}
function parseLinks(value: FormDataEntryValue | null): GameExternalLink[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => splitEscapedLink(line))
    .filter((parts) => parts[0] && parts[1])
    .map((parts, index) => ({
      id: index,
      label: parts[0].trim(),
      url: parts[1].trim(),
      linkType: parts[2]?.trim() || "other",
    }));
}
function splitEscapedLink(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (
      character === "\\" &&
      index + 1 < value.length &&
      (value[index + 1] === "\\" || value[index + 1] === "|")
    ) {
      current += value[index + 1];
      index += 1;
      continue;
    }
    if (character === "|") {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}
function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n|[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
}
function clean(value: FormDataEntryValue | null): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}
function checked(form: FormData, key: string): boolean {
  const value = form.get(key);
  return value === "1" || value === "on" || value === "true";
}
function positive(value: FormDataEntryValue | null): number {
  const id = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid id");
  return id;
}
function assertEnum(value: string, allowed: string[], label: string): void {
  if (!allowed.includes(value)) throw new Error(`${label}不合法`);
}
function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : min;
}
