import {
  isArchiveEngineFamily,
  isExternalEngineFamily,
  isLanguageCode,
} from "@/lib/labels";
import type { CharacterSelection } from "@/lib/character-names";
import { normalizeCreatorName, normalizeEntityName } from "@/lib/entity-name";
import {
  ORIGINAL_RELEASE_DATE_FORMAT_ERROR,
  parseOriginalReleaseDate,
} from "@/lib/original-release-date";
import { getD1 } from "@/lib/server/db/d1";
import {
  parseCharacterSelection,
  parseCharacterSelectionsJson,
  prepareWorkCharacterStatements,
} from "@/lib/server/db/characters";
import { chunkArray } from "@/lib/server/db/chunks";
import { assertTranslationLanguageChangeAllowed } from "@/lib/server/db/relations";
import { ensureCurrentArchiveVersion } from "@/lib/server/db/archive-maintenance";
import { isHttpUrl, normalizeHttpUrl } from "@/lib/server/http/safe-url";
import { HttpError } from "@/lib/server/http/json";
import {
  assertStableDistribution,
  assertSingleDownloadLink,
  deriveWorkDistribution,
  type WorkDistribution,
} from "@/lib/server/db/work-distribution";
import type { ArchiveUser } from "@/lib/server/db/users";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";

export type GameTag = { id: number; name: string; namespace: string };
export type GameCharacter = {
  id: number;
  primaryName: string;
  originalName: string;
  displayName: string;
  portraitBlobSha256: string | null;
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
  notes: string | null;
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
  workId: number;
  title: string;
  relationOrder: number;
  viceVersa: boolean;
  createdByUserId: number | null;
  previewBlobSha256?: string | null;
};
export type GameTranslationRelation = {
  id: number;
  role: "original" | "translation";
  workId: number;
  title: string;
  language: string;
  relationOrder: number;
  createdByUserId: number | null;
  previewBlobSha256?: string | null;
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
  isTranslation: boolean;
  language: string;
  status: string;
  previewBlobSha256: string | null;
  currentArchiveVersionId: number | null;
  externalDownloadUrl: string | null;
  archiveVersionCount: number;
  totalSizeBytes: number;
  latestPublishedAt: string | null;
  tags: GameTag[];
  characters: GameCharacter[];
  creators: GameCreatorCredit[];
  distribution: WorkDistribution;
};
export type GameWorkDetail = GameWorkSummary & {
  aliases: string[];
  creators: GameCreatorCredit[];
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
  isTranslation: boolean;
  language: string;
  status: "processing" | "published" | "hidden" | "deleted";
  aliases: string[];
  creators: GameCreatorCredit[];
  tags: string[];
  characters: CharacterSelection[];
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
  status: "processing" | "published" | "hidden";
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
  status?: string;
  engine?: string;
  tag?: number;
  character?: number;
  isOriginal?: boolean;
  language?: string;
  includeNonPublic?: boolean;
};
type ListInput = Filters & {
  sort?: "id" | "title" | "release" | "relevance";
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
  is_translation: number;
  language: string;
  status: string;
  preview_blob_sha256: string | null;
  current_archive_version_id: number | null;
  external_download_url: string | null;
  archive_version_count: number;
  total_size_bytes: number | null;
  latest_published_at: string | null;
  download_link_count: number;
};
type WorkRow = {
  id: number;
  original_title: string;
  chinese_title: string | null;
  description: string | null;
  original_release_date: string | null;
  original_release_precision: string;
  engine_family: string;
  is_original: number;
  is_translation: number;
  language: string;
  status: string;
};
type ArchiveEditRow = {
  id: number;
  work_id: number;
  work_title: string;
  work_language: string;
  is_current: number;
  status: "processing" | "published" | "hidden";
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
  characters: CharacterSelection[];
  previewBlobSha256s: string[];
  outgoingRelations: GameWorkRelation[];
  externalLinks: GameExternalLink[];
};

export type ExternalWorkInput = {
  user: ArchiveUser;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  aliases: string[];
  tags: string[];
  characters: CharacterSelection[];
  creatorName: string | null;
  translatorName: string | null;
  previewBlobSha256s: string[];
  downloadUrl: string;
  sourceUrl: string | null;
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
const VALID_PUBLISHED_DISTRIBUTION_SQL = `(
  (EXISTS (SELECT 1 FROM archive_versions avp WHERE avp.work_id=w.id AND avp.status='published' AND avp.is_current=1)
    AND w.engine_family IN ('rpg_maker_2000','rpg_maker_2003','rpg_maker_2003_maniac')
    AND (SELECT COUNT(*) FROM work_external_links wep WHERE wep.work_id=w.id AND wep.link_type='download_page') = 0)
  OR
  (NOT EXISTS (SELECT 1 FROM archive_versions avp WHERE avp.work_id=w.id AND avp.status='published' AND avp.is_current=1)
    AND w.engine_family NOT IN ('rpg_maker_2000','rpg_maker_2003','rpg_maker_2003_maniac')
    AND (SELECT COUNT(*) FROM work_external_links wep WHERE wep.work_id=w.id AND wep.link_type='download_page') = 1)
)`;

export async function listGameWorks(
  input: ListInput = {},
): Promise<GameWorkSummary[]> {
  const rows = await gameWorksListStatement(getD1(), input).all<SummaryRow>();
  return hydrate(rows.results ?? []);
}

export type UserWorkListItem = {
  work: GameWorkSummary;
  occurredAt: string;
};

export type UploaderWorkEdit = AdminWorkEdit & {
  distribution: "archive" | "external";
  externalDownloadUrl: string | null;
  sourceUrl: string | null;
  archiveVersionCount: number;
  hasCurrentArchive: boolean;
};

export type UploaderWorkUpdateInput = {
  user: ArchiveUser;
  workId: number;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  status: "published" | "hidden";
  aliases: string[];
  tags: string[];
  characters: CharacterSelection[];
  authors: string[];
  translators: string[];
  previewBlobSha256s: string[];
  downloadUrl: string | null;
  sourceUrl: string | null;
};

export async function searchUserWorks(input: {
  userId: number;
  kind: "favorite" | "played";
  page?: number;
  pageSize?: number;
}): Promise<{ items: UserWorkListItem[]; total: number; page: number; pageSize: number }> {
  const pageSize = clamp(input.pageSize ?? 20, 1, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const column = input.kind === "favorite" ? "favorited_at" : "last_played_at";
  const database = getD1();
  const [countResult, rowsResult] = await database.batch([
    database
      .prepare(`SELECT COUNT(*) AS count FROM user_work_entries e JOIN works w ON w.id=e.work_id WHERE e.user_id=? AND e.${column} IS NOT NULL AND w.status='published' AND ${VALID_PUBLISHED_DISTRIBUTION_SQL}`)
      .bind(input.userId),
    database
      .prepare(`SELECT ${summarySql()},e.${column} AS occurred_at FROM user_work_entries e JOIN works w ON w.id=e.work_id LEFT JOIN archive_versions av ON av.work_id=w.id AND av.status='published' AND av.is_current=1 WHERE e.user_id=? AND e.${column} IS NOT NULL AND w.status='published' AND ${VALID_PUBLISHED_DISTRIBUTION_SQL} GROUP BY w.id ORDER BY e.${column} DESC,w.id DESC LIMIT ? OFFSET ?`)
      .bind(input.userId, pageSize, (page - 1) * pageSize),
  ]);
  const rows = (rowsResult.results ?? []) as Array<SummaryRow & { occurred_at: string }>;
  const works = await hydrate(rows);
  return {
    items: works.map((work, index) => ({ work, occurredAt: rows[index].occurred_at })),
    total: Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    page,
    pageSize,
  };
}

export async function searchUploadedWorks(input: {
  userId: number;
  page?: number;
  pageSize?: number;
}): Promise<{ items: GameWorkSummary[]; total: number; page: number; pageSize: number }> {
  const pageSize = clamp(input.pageSize ?? 20, 1, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const database = getD1();
  const [countResult, rowsResult] = await database.batch([
    database.prepare(
      `SELECT COUNT(*) AS count
       FROM work_uploaders wu
       JOIN works w ON w.id=wu.work_id
       WHERE wu.user_id=? AND w.status<>'deleted'`,
    ).bind(input.userId),
    database.prepare(
      `SELECT ${summarySql()}
       FROM work_uploaders wu
       JOIN works w ON w.id=wu.work_id
       LEFT JOIN archive_versions av
         ON av.work_id=w.id AND av.status='published' AND av.is_current=1
       WHERE wu.user_id=? AND w.status<>'deleted'
       GROUP BY w.id
       ORDER BY datetime(w.updated_at) DESC,w.id DESC
       LIMIT ? OFFSET ?`,
    ).bind(input.userId, pageSize, (page - 1) * pageSize),
  ]);
  return {
    items: await hydrate((rowsResult.results ?? []) as SummaryRow[]),
    total: Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    page,
    pageSize,
  };
}
export async function countGameWorks(input: Filters = {}): Promise<number> {
  const row = await gameWorksCountStatement(getD1(), input).first<{ count: number }>();
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
  const pageSize = clamp(input.pageSize ?? 24, 1, 100);
  const page = clamp(input.page ?? 1, 1, 9999);
  const filters = { query: input.query };
  const database = getD1();
  const [countResult, rowsResult] = await database.batch([
    gameWorksCountStatement(database, filters),
    gameWorksListStatement(database, {
      ...filters,
      sort: "relevance",
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);
  const total = Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0);
  return {
    items: await hydrate((rowsResult.results ?? []) as SummaryRow[]),
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
      `SELECT ${summarySql()} FROM works w LEFT JOIN archive_versions av ON av.work_id=w.id AND av.status='published' AND av.is_current=1 WHERE w.id=? AND w.status='published' AND ${VALID_PUBLISHED_DISTRIBUTION_SQL} GROUP BY w.id LIMIT 1`,
    )
    .bind(id)
    .first<
      SummaryRow
  >();
  if (!row) return null;
  const collections = await loadWorkCollections(row.id);
  const summary = mapSummaryRow(row, collections.tags, collections.characters, collections.creators);
  const originalId =
    collections.translations.find((item) => item.role === "original")?.workId ??
    (collections.translations.some((item) => item.role === "translation") ? row.id : null);
  return {
    ...summary,
    aliases: collections.aliases,
    media: collections.media,
    externalLinks: collections.links,
    archiveVersions: collections.archives,
    relations: collections.relations,
    translations: collections.translations,
    parallelTranslations: originalId ? await listTranslations(originalId) : [],
  };
}
export async function listEditableWorksForAdmin(
  limit = 200,
): Promise<GameWorkSummary[]> {
  return listGameWorks({ includeNonPublic: true, limit });
}
export async function searchEditableWorksForAdmin(input: {
  query?: string;
  status?: string;
  sort?: "id" | "title" | "release";
  page?: number;
  pageSize?: number;
}): Promise<PaginatedGameSearch> {
  const pageSize = clamp(input.pageSize ?? 50, 1, 100);
  const page = clamp(input.page ?? 1, 1, 9999);
  const filters = {
    query: input.query,
    status: input.status,
    includeNonPublic: true,
  };
  const database = getD1();
  const [countResult, rowsResult] = await database.batch([
    gameWorksCountStatement(database, filters),
    gameWorksListStatement(database, {
      ...filters,
      sort: input.sort,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);
  const total = Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0);
  return {
    items: await hydrate((rowsResult.results ?? []) as SummaryRow[]),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
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
  const collections = await loadWorkCollections(workId, true);
  const originalId =
    collections.translations.find((item) => item.role === "original")?.workId ??
    (collections.translations.some((item) => item.role === "translation") ? row.id : null);
  return {
    id: row.id,
    originalTitle: row.original_title,
    chineseTitle: row.chinese_title,
    description: row.description,
    originalReleaseDate: row.original_release_date,
    originalReleasePrecision: row.original_release_precision,
    engineFamily: row.engine_family,
    isOriginal: row.is_original === 1,
    isTranslation: row.is_translation === 1,
    language: row.language,
    status: row.status as AdminWorkEdit["status"],
    aliases: collections.aliases,
    creators: collections.creators,
    tags: collections.tags.map((item) => item.name),
    characters: collections.characters.map(characterSelectionFromGameCharacter),
    characterCredits: collections.characters,
    media: collections.media,
    outgoingRelations: collections.relations,
    translations: collections.translations,
    parallelTranslations: originalId
      ? await listTranslations(originalId, true)
      : [],
    externalLinks: collections.links,
  };
}

export async function getOwnedWorkForEdit(
  workId: number,
  user: ArchiveUser,
): Promise<UploaderWorkEdit | null> {
  const owned = await getD1()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM archive_versions av WHERE av.work_id=w.id) AS archive_version_count,
         EXISTS(
           SELECT 1 FROM archive_versions av
           WHERE av.work_id=w.id AND av.status='published' AND av.is_current=1
         ) AS has_current_archive
       FROM work_uploaders wu
       JOIN works w ON w.id=wu.work_id
       WHERE wu.work_id=? AND wu.user_id=? AND w.status<>'deleted'
       LIMIT 1`,
    )
    .bind(workId, user.id)
    .first<{ archive_version_count: number; has_current_archive: number }>();
  if (!owned) return null;
  const work = await getWorkForAdminEdit(workId);
  if (!work || work.status === "processing" || work.status === "deleted") return null;
  const downloadLink = work.externalLinks.find(
    (link) => link.linkType === "download_page",
  );
  const sourceLink = work.externalLinks.find((link) => link.linkType === "source");
  const distribution = deriveWorkDistribution({
    hasCurrentArchive: owned.has_current_archive === 1,
    downloadLinkCount: downloadLink ? 1 : 0,
  });
  if (distribution === "invalid") return null;
  return {
    ...work,
    distribution,
    externalDownloadUrl: downloadLink?.url ?? null,
    sourceUrl: sourceLink?.url ?? null,
    archiveVersionCount: owned.archive_version_count,
    hasCurrentArchive: owned.has_current_archive === 1,
  };
}

export async function updateOwnedWork(
  input: UploaderWorkUpdateInput,
  before: UploaderWorkEdit,
): Promise<void> {
  if (before.id !== input.workId) throw new Error("Owned work snapshot does not match update target");
  const originalTitle = input.originalTitle.trim();
  if (!originalTitle) throw new HttpError(400, "作品原名不能为空");
  assertPublicationDeclarations(input.isOriginal, input.isTranslation);
  if (!isLanguageCode(input.language)) throw new HttpError(400, "语言不合法");
  const releaseDate = parseOriginalReleaseDate(input.originalReleaseDate);
  if (!releaseDate) throw new HttpError(400, ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
  if (!(["published", "hidden"] as const).includes(input.status)) {
    throw new HttpError(400, "作品状态不合法");
  }
  if (before.distribution === "archive" && !isArchiveEngineFamily(input.engineFamily)) {
    throw new HttpError(400, "本站归档作品必须使用 RPG Maker 2000/2003 系引擎");
  }
  if (before.distribution === "external" && !isExternalEngineFamily(input.engineFamily)) {
    throw new HttpError(400, "外链作品必须使用非 RPG Maker 2000/2003 系引擎");
  }
  await assertTranslationLanguageChangeAllowed(input.workId, input.language);

  const aliases = uniqueText(input.aliases);
  const tags = uniqueText(input.tags.map(normalizeEntityName));
  const characters = input.characters.map(parseCharacterSelection);
  const authors = uniqueText(input.authors.map(normalizeCreatorName));
  const translators = input.isTranslation
    ? uniqueText(input.translators.map(normalizeCreatorName))
    : [];
  if (input.isTranslation && translators.length === 0) {
    throw new HttpError(400, "翻译作品必须填写译者");
  }
  const previewHashes = uniqueText(
    input.previewBlobSha256s.map((value) => value.trim().toLowerCase()),
  );
  await validatePreviewHashes(previewHashes);
  if (previewHashes.length === 0) throw new HttpError(400, "作品必须保留至少一张封面图");
  const downloadUrl = before.distribution === "external"
    ? normalizeHttpUrl(input.downloadUrl, "外部下载地址")
    : null;
  if (before.distribution === "external" && !downloadUrl) {
    throw new HttpError(400, "外部下载地址不能为空");
  }
  const sourceUrl = before.distribution === "external"
    ? normalizeHttpUrl(input.sourceUrl, "来源链接")
    : null;

  assertStableDistribution({
    status: input.status,
    engineFamily: input.engineFamily,
    hasCurrentArchive: before.hasCurrentArchive,
    archiveVersionCount: before.archiveVersionCount,
    downloadLinkCount: downloadUrl ? 1 : 0,
  });

  const database = getD1();
  const existingCharacters = new Map(
    before.characterCredits.map((character) => [character.id, character]),
  );
  const characterCredits = characters.map((selection, index) => {
    const existing = selection.kind === "existing"
      ? existingCharacters.get(selection.characterId)
      : undefined;
    return {
      selection,
      roleKey: isCharacterRoleKey(existing?.roleKey) ? existing.roleKey : "supporting",
      spoilerLevel: existing?.spoilerLevel ?? 0,
      sortOrder: index + 1,
      notes: existing?.notes ?? null,
    };
  });
  const existingAuthors = new Map(
    before.creators
      .filter((creator) => creator.roleKey === "author")
      .map((creator) => [entityNameKey(creator.name), creator]),
  );
  const authorCredits = authors.map((name) => {
    const existing = existingAuthors.get(entityNameKey(name));
    return {
      name,
      roleLabel: existing?.roleLabel ?? "作者",
      notes: existing?.notes ?? null,
    };
  });
  const existingTranslators = new Map(
    before.creators
      .filter((creator) => creator.roleKey === "translator")
      .map((creator) => [entityNameKey(creator.name), creator]),
  );
  const translatorCredits = translators.map((name) => {
    const existing = existingTranslators.get(entityNameKey(name));
    return {
      name,
      roleLabel: existing?.roleLabel ?? "译者",
      notes: existing?.notes ?? null,
    };
  });
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `UPDATE works
         SET original_title=?,chinese_title=?,description=?,original_release_date=?,
           original_release_precision=?,engine_family=?,
           is_original=?,is_translation=?,language=?,status=?,updated_at=CURRENT_TIMESTAMP,
           published_at=CASE WHEN ?='published' THEN COALESCE(published_at,CURRENT_TIMESTAMP) ELSE published_at END
         WHERE id=? AND status<>'deleted'`,
      )
      .bind(
        originalTitle,
        input.chineseTitle?.trim() || null,
        input.description?.trim() || null,
        releaseDate.value,
        releaseDate.precision,
        input.engineFamily,
        input.isOriginal ? 1 : 0,
        input.isTranslation ? 1 : 0,
        input.language,
        input.status,
        input.status,
        input.workId,
      ),
    database.prepare(`DELETE FROM work_titles WHERE work_id=?`).bind(input.workId),
    database.prepare(`DELETE FROM work_tags WHERE work_id=? AND source='uploader'`).bind(input.workId),
    database.prepare(`DELETE FROM work_staff WHERE work_id=? AND role_key IN ('author','translator')`).bind(input.workId),
    database
      .prepare(
        `DELETE FROM work_media_assets
         WHERE work_id=? AND media_asset_id IN (SELECT id FROM media_assets WHERE kind='preview')`,
      )
      .bind(input.workId),
    database
      .prepare(`DELETE FROM work_external_links WHERE work_id=? AND link_type='download_page'`)
      .bind(input.workId),
  ];
  if (before.distribution === "external") {
    statements.push(
      database
        .prepare(`DELETE FROM work_external_links WHERE work_id=? AND link_type='source'`)
        .bind(input.workId),
    );
  }
  for (const title of aliases) {
    statements.push(
      database
        .prepare(`INSERT OR IGNORE INTO work_titles(work_id,title,title_type) VALUES(?,?,'alias')`)
        .bind(input.workId, title),
    );
  }
  for (const tag of tags) {
    statements.push(
      database.prepare(`INSERT OR IGNORE INTO tags(name,namespace) VALUES(?,'other')`).bind(tag),
      database
        .prepare(`INSERT OR IGNORE INTO work_tags(work_id,tag_id,source) SELECT ?,id,'uploader' FROM tags WHERE name=? COLLATE NOCASE`)
        .bind(input.workId, tag),
    );
  }
  statements.push(
    ...(await prepareWorkCharacterStatements({
      database,
      workId: input.workId,
      credits: characterCredits,
      source: "user",
    })),
  );
  for (const author of authorCredits) {
    statements.push(
      database.prepare(`INSERT OR IGNORE INTO creators(name,extra_json) VALUES(?,'{}')`).bind(author.name),
      database.prepare(`INSERT OR IGNORE INTO work_staff(work_id,creator_id,role_key,role_label,notes) SELECT ?,id,'author',?,? FROM creators WHERE name=? COLLATE NOCASE`).bind(input.workId, author.roleLabel, author.notes, author.name),
    );
  }
  for (const translator of translatorCredits) {
    statements.push(
      database.prepare(`INSERT OR IGNORE INTO creators(name,extra_json) VALUES(?,'{}')`).bind(translator.name),
      database.prepare(`INSERT OR IGNORE INTO work_staff(work_id,creator_id,role_key,role_label,notes) SELECT ?,id,'translator',?,? FROM creators WHERE name=? COLLATE NOCASE`).bind(input.workId, translator.roleLabel, translator.notes, translator.name),
    );
  }
  for (const [index, hash] of previewHashes.entries()) {
    statements.push(
      database.prepare(`INSERT OR IGNORE INTO media_assets(blob_sha256,kind) VALUES(?,'preview')`).bind(hash),
      database.prepare(`INSERT INTO work_media_assets(work_id,media_asset_id,sort_order,is_primary) SELECT ?,id,?,? FROM media_assets WHERE blob_sha256=? AND kind='preview'`).bind(input.workId, index + 1, index === 0 ? 1 : 0, hash),
    );
  }
  if (downloadUrl) {
    statements.push(
      database.prepare(`INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(?,'外部下载',?,'download_page')`).bind(input.workId, downloadUrl),
    );
  }
  if (sourceUrl) {
    statements.push(
      database.prepare(`INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(?,'来源链接',?,'source')`).bind(input.workId, sourceUrl),
    );
  }
  statements.push(
    database
      .prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json) VALUES(?,?,'uploader_work_update',?)`)
      .bind(
        input.user.id,
        input.user.email,
        JSON.stringify({
          workId: input.workId,
          oldOriginalTitle: before.originalTitle,
          newOriginalTitle: originalTitle,
          oldStatus: before.status,
          newStatus: input.status,
        }),
      ),
  );
  await database.batch(statements);
}
export async function updateWorkForAdmin(
  input: WorkEditInput,
  actor: ArchiveUser,
): Promise<void> {
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
      "other",
    ],
    "引擎",
  );
  assertEnum(input.status, ["processing", "published", "hidden"], "状态");
  if (input.status === "processing") {
    throw new HttpError(400, "processing 只能由上传提交流程创建");
  }
  if (!isLanguageCode(input.language)) throw new Error("语言不合法");
  const externalLinks = normalizeExternalLinks(input.externalLinks);
  const distributionState = await getWorkDistributionState(input.workId);
  assertStableDistribution({
    status: input.status,
    engineFamily: input.engineFamily,
    hasCurrentArchive: distributionState.hasCurrentArchive,
    archiveVersionCount: distributionState.archiveVersionCount,
    downloadLinkCount: externalLinks.filter(
      (link) => link.linkType === "download_page",
    ).length,
  });
  await assertTranslationLanguageChangeAllowed(input.workId, input.language);
  const previewHashes = uniqueText(input.previewBlobSha256s.map((value) => value.toLowerCase()));
  await validatePreviewHashes(previewHashes);
  const aliases = uniqueText(input.aliases);
  const tags = uniqueText(input.tags.map(normalizeEntityName));
  const characters = input.characters.map(parseCharacterSelection);
  const current = await getWorkForAdminEdit(input.workId);
  if (!current) throw new HttpError(404, "作品不存在");
  const existingCharacters = new Map(
    current.characterCredits.map((character) => [character.id, character]),
  );
  const characterCredits = characters.map((selection, index) => {
    const existing = selection.kind === "existing"
      ? existingCharacters.get(selection.characterId)
      : undefined;
    return {
      selection,
      roleKey: isCharacterRoleKey(existing?.roleKey) ? existing.roleKey : "supporting",
      spoilerLevel: existing?.spoilerLevel ?? 0,
      sortOrder: index + 1,
      notes: existing?.notes ?? null,
    };
  });
  const database = getD1();
  const statements: D1PreparedStatement[] = [
    database
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
      ),
    database.prepare(`DELETE FROM work_titles WHERE work_id=?`).bind(input.workId),
    database.prepare(`DELETE FROM work_tags WHERE work_id=?`).bind(input.workId),
    database
      .prepare(
        `DELETE FROM work_media_assets
         WHERE work_id=? AND media_asset_id IN (SELECT id FROM media_assets WHERE kind='preview')`,
      )
      .bind(input.workId),
    database.prepare(`DELETE FROM work_external_links WHERE work_id=?`).bind(input.workId),
  ];
  for (const alias of aliases) {
    statements.push(
      database
        .prepare(`INSERT OR IGNORE INTO work_titles(work_id,title,title_type) VALUES(?,?,'alias')`)
        .bind(input.workId, alias),
    );
  }
  for (const tag of tags) {
    statements.push(
      database.prepare(`INSERT OR IGNORE INTO tags(name,namespace) VALUES(?,'other')`).bind(tag),
      database
        .prepare(
          `INSERT OR IGNORE INTO work_tags(work_id,tag_id,source)
           SELECT ?,id,'admin' FROM tags WHERE name=? COLLATE NOCASE`,
        )
        .bind(input.workId, tag),
    );
  }
  statements.push(
    ...(await prepareWorkCharacterStatements({
      database,
      workId: input.workId,
      credits: characterCredits,
      source: "admin",
    })),
  );
  for (const [index, hash] of previewHashes.entries()) {
    statements.push(
      database.prepare(`INSERT OR IGNORE INTO media_assets(blob_sha256,kind) VALUES(?,'preview')`).bind(hash),
      database
        .prepare(
          `INSERT INTO work_media_assets(work_id,media_asset_id,sort_order,is_primary)
           SELECT ?,id,?,? FROM media_assets WHERE blob_sha256=? AND kind='preview'`,
        )
        .bind(input.workId, index + 1, index === 0 ? 1 : 0, hash),
    );
  }
  for (const link of externalLinks) {
    statements.push(
      database
        .prepare(`INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(?,?,?,?)`)
        .bind(input.workId, link.label, link.url, link.linkType),
    );
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
         VALUES(?,?,'admin_work_update',?)`,
      )
      .bind(actor.id, actor.email, JSON.stringify({ workId: input.workId, status: input.status })),
  );
  await database.batch(statements);
}

export async function createExternalWork(
  input: ExternalWorkInput,
): Promise<{ workId: number }> {
  if (!isExternalEngineFamily(input.engineFamily)) {
    throw new HttpError(400, "外链下载作品必须使用非 RPG Maker 2000/2003 系引擎");
  }
  const originalTitle = input.originalTitle.trim();
  if (!originalTitle) throw new HttpError(400, "作品原名不能为空");
  assertPublicationDeclarations(input.isOriginal, input.isTranslation);
  const releaseDate = parseOriginalReleaseDate(input.originalReleaseDate);
  if (!releaseDate) throw new HttpError(400, ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
  if (!isLanguageCode(input.language)) throw new HttpError(400, "语言不合法");
  const downloadUrl = normalizeHttpUrl(input.downloadUrl, "外部下载地址");
  if (!downloadUrl) throw new HttpError(400, "外部下载地址不能为空");

  const previewBlobSha256s = [
    ...new Set(
      input.previewBlobSha256s.map((value) => value.trim().toLowerCase()),
    ),
  ];
  if (previewBlobSha256s.length === 0) {
    throw new HttpError(400, "外链作品必须提供封面图");
  }
  await validatePreviewHashes(previewBlobSha256s);

  const aliases = [...new Set(input.aliases.map((value) => value.trim()).filter(Boolean))];
  const tags = [...new Set(input.tags.map(normalizeEntityName).filter(Boolean))];
  const characters = input.characters.map(parseCharacterSelection);
  const creatorName = input.creatorName ? normalizeCreatorName(input.creatorName) || null : null;
  const translatorName = input.isTranslation && input.translatorName
    ? normalizeCreatorName(input.translatorName) || null
    : null;
  if (input.isTranslation && !translatorName) {
    throw new HttpError(400, "翻译作品必须填写译者");
  }
  const sourceUrl = normalizeHttpUrl(input.sourceUrl, "来源链接");
  const staffCredits: Array<{
    name: string;
    roleKey: "author" | "translator";
    roleLabel: "作者" | "译者";
  }> = [];
  if (creatorName) staffCredits.push({ name: creatorName, roleKey: "author", roleLabel: "作者" });
  if (translatorName) staffCredits.push({ name: translatorName, roleKey: "translator", roleLabel: "译者" });
  const database = getD1();
  const result = await database
    .prepare(
      `INSERT INTO works (
        original_title, chinese_title, description, is_original, is_translation, language,
        original_release_date, original_release_precision, engine_family, status,
        extra_json, created_by_user_id, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', '{}', ?, CURRENT_TIMESTAMP)`,
    )
    .bind(
      originalTitle,
      input.chineseTitle?.trim() || null,
      input.description?.trim() || null,
      input.isOriginal ? 1 : 0,
      input.isTranslation ? 1 : 0,
      input.language,
      releaseDate.value,
      releaseDate.precision,
      input.engineFamily,
      input.user.id,
    )
    .run();
  const workId = result.meta.last_row_id;
  if (!Number.isSafeInteger(workId)) throw new Error("外链作品创建失败");

  const statements = [
    database
      .prepare(`INSERT INTO work_uploaders(work_id,user_id) VALUES(?,?)`)
      .bind(workId, input.user.id),
    ...aliases.map((title) =>
      database
        .prepare(
          `INSERT OR IGNORE INTO work_titles(work_id,title,title_type) VALUES(?,?, 'alias')`,
        )
        .bind(workId, title),
    ),
    ...staffCredits.flatMap((credit) => [
      database
        .prepare(`INSERT OR IGNORE INTO creators(name,extra_json) VALUES(?, '{}')`)
        .bind(credit.name),
      database
        .prepare(
          `INSERT OR IGNORE INTO work_staff(work_id,creator_id,role_key,role_label) SELECT ?,id,?,? FROM creators WHERE name=? COLLATE NOCASE`,
        )
        .bind(workId, credit.roleKey, credit.roleLabel, credit.name),
    ]),
    ...(await prepareWorkCharacterStatements({
      database,
      workId: workId as number,
      credits: characters.map((selection, index) => ({
        selection,
        roleKey: "supporting",
        spoilerLevel: 0,
        sortOrder: index + 1,
        notes: null,
      })),
      source: "user",
      requirePortrait: true,
    })),
    ...tags.flatMap((name) => [
      database
        .prepare(`INSERT OR IGNORE INTO tags(name,namespace) VALUES(?, 'other')`)
        .bind(name),
      database
        .prepare(
          `INSERT OR IGNORE INTO work_tags(work_id,tag_id,source) SELECT ?,id,'uploader' FROM tags WHERE name=? COLLATE NOCASE`,
        )
        .bind(workId, name),
    ]),
    database
      .prepare(
        `INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(?, '外部下载', ?, 'download_page')`,
      )
      .bind(workId, downloadUrl),
    ...(sourceUrl
      ? [
          database
            .prepare(
              `INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(?, '来源链接', ?, 'source')`,
            )
            .bind(workId, sourceUrl),
        ]
      : []),
    ...previewBlobSha256s.flatMap((sha256, index) => [
      database
        .prepare(
          `INSERT OR IGNORE INTO media_assets(blob_sha256,kind) VALUES(?, 'preview')`,
        )
        .bind(sha256),
      database
        .prepare(
          `INSERT INTO work_media_assets(work_id,media_asset_id,sort_order,is_primary) SELECT ?,id,?,? FROM media_assets WHERE blob_sha256=? AND kind='preview'`,
        )
        .bind(workId, index + 1, index === 0 ? 1 : 0, sha256),
    ]),
  ];
  await database.batch(statements);
  await writeAuthAuditLog({
    userId: input.user.id,
    email: input.user.email,
    eventType: "external_work_created",
    detail: { workId: workId as number, engineFamily: input.engineFamily },
  });
  return { workId: workId as number };
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
  assertEnum(input.status, ["processing", "published", "hidden"], "状态");
  if (input.status === "processing") {
    throw new HttpError(400, "processing 只能由上传提交流程创建");
  }
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
    engineFamily: String(form.get("engine_family") ?? "other"),
    isOriginal: checked(form, "is_original"),
    language: String(form.get("language") ?? "zh-CN"),
    status: String(form.get("status") ?? "published"),
    aliases: lines(form.get("aliases")),
    tags: lines(form.get("tags")),
    characters: parseCharacterSelectionsJson(form.get("characters")),
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
    w.is_translation,
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
    av.id AS current_archive_version_id,
    (
      SELECT wel.url
      FROM work_external_links wel
      WHERE wel.work_id = w.id
        AND wel.link_type = 'download_page'
      ORDER BY wel.id
      LIMIT 1
    ) AS external_download_url,
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
    ) AS latest_published_at,
    (
      SELECT COUNT(*)
      FROM work_external_links wel
      WHERE wel.work_id = w.id
        AND wel.link_type = 'download_page'
    ) AS download_link_count`;
}
function gameWorksListStatement(database: D1Database, input: ListInput): D1PreparedStatement {
  const { where, binds } = buildWhere(input);
  const limit = clamp(input.limit ?? 80, 1, 200);
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const { order, orderBinds } = gameWorksOrder(input);
  return database
    .prepare(
      `SELECT ${summarySql()}
       FROM works w
       LEFT JOIN archive_versions av
         ON av.work_id=w.id AND av.status='published' AND av.is_current=1
       WHERE ${where}
       GROUP BY w.id
       ORDER BY ${order},w.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, ...orderBinds, limit, offset);
}

function gameWorksOrder(input: ListInput): { order: string; orderBinds: string[] } {
  if (input.sort === "relevance" && input.query) {
    const { exact, prefix, contains } = searchPatterns(input.query);
    return {
      order: `CASE
        WHEN w.chinese_title LIKE ? ESCAPE '\\' THEN 0
        WHEN w.original_title LIKE ? ESCAPE '\\' THEN 1
        WHEN EXISTS(SELECT 1 FROM work_titles wte WHERE wte.work_id=w.id AND wte.title LIKE ? ESCAPE '\\') THEN 2
        WHEN w.chinese_title LIKE ? ESCAPE '\\' THEN 3
        WHEN w.original_title LIKE ? ESCAPE '\\' THEN 4
        WHEN EXISTS(SELECT 1 FROM work_titles wtp WHERE wtp.work_id=w.id AND wtp.title LIKE ? ESCAPE '\\') THEN 5
        WHEN w.chinese_title LIKE ? ESCAPE '\\' THEN 6
        WHEN w.original_title LIKE ? ESCAPE '\\' THEN 7
        WHEN EXISTS(SELECT 1 FROM work_titles wtc WHERE wtc.work_id=w.id AND wtc.title LIKE ? ESCAPE '\\') THEN 8
        ELSE 9
      END`,
      orderBinds: [
        exact,
        exact,
        exact,
        prefix,
        prefix,
        prefix,
        contains,
        contains,
        contains,
      ],
    };
  }
  if (input.sort === "title") {
    return { order: "COALESCE(w.chinese_title,w.original_title) ASC", orderBinds: [] };
  }
  if (input.sort === "release") {
    return {
      order: "w.original_release_date IS NULL ASC,w.original_release_date DESC",
      orderBinds: [],
    };
  }
  return { order: "w.id DESC", orderBinds: [] };
}

function gameWorksCountStatement(database: D1Database, input: Filters): D1PreparedStatement {
  const { where, binds } = buildWhere(input);
  return database.prepare(`SELECT COUNT(*) AS count FROM works w WHERE ${where}`).bind(...binds);
}

function buildWhere(input: Filters): {
  where: string;
  binds: Array<string | number>;
} {
  const clauses = [
      input.includeNonPublic
        ? "w.status <> 'deleted'"
        : `w.status='published' AND ${VALID_PUBLISHED_DISTRIBUTION_SQL}`,
    ],
    binds: Array<string | number> = [];
  if (input.query) {
    const { contains } = searchPatterns(input.query);
    clauses.push(
      `(w.original_title LIKE ? ESCAPE '\\' OR w.chinese_title LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM work_titles wtq WHERE wtq.work_id=w.id AND wtq.title LIKE ? ESCAPE '\\'))`,
    );
    binds.push(contains, contains, contains);
  }
  if (input.status && input.status !== "all") {
    clauses.push("w.status=?");
    binds.push(input.status);
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

function searchPatterns(query: string): {
  exact: string;
  prefix: string;
  contains: string;
} {
  const escaped = query.replace(/[\\%_]/g, (match) => `\\${match}`);
  return { exact: escaped, prefix: `${escaped}%`, contains: `%${escaped}%` };
}

async function hydrate(rows: SummaryRow[]): Promise<GameWorkSummary[]> {
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((row) => row.id))];
  const database = getD1();
  const queries: Array<{ kind: "tag" | "character" | "creator"; statement: D1PreparedStatement }> = [];
  for (const chunk of chunkArray(ids, 100)) {
    const placeholders = chunk.map(() => "?").join(",");
    queries.push(
      {
        kind: "tag",
        statement: database
          .prepare(
            `SELECT wt.work_id,t.id,t.name,t.namespace
             FROM work_tags wt JOIN tags t ON t.id=wt.tag_id
             WHERE wt.work_id IN (${placeholders})
             ORDER BY wt.work_id,t.name`,
          )
          .bind(...chunk),
      },
      {
        kind: "character",
        statement: database
          .prepare(
            `SELECT wc.work_id,c.id,c.primary_name,c.original_name,c.portrait_blob_sha256,wc.display_name,wc.role_key,wc.spoiler_level,wc.sort_order,wc.notes
             FROM work_characters wc JOIN characters c ON c.id=wc.character_id
             WHERE wc.work_id IN (${placeholders})
             ORDER BY wc.work_id,wc.sort_order,c.primary_name`,
          )
          .bind(...chunk),
      },
      {
        kind: "creator",
        statement: database
          .prepare(
            `SELECT ws.work_id,c.id,c.name,c.original_name,c.website_url,ws.role_key,ws.role_label,ws.notes
             FROM work_staff ws JOIN creators c ON c.id=ws.creator_id
             WHERE ws.work_id IN (${placeholders})
             ORDER BY ws.work_id,c.name`,
          )
          .bind(...chunk),
      },
    );
  }
  const results = await database.batch(queries.map((query) => query.statement));
  const tagRows: Array<GameTag & { work_id: number }> = [];
  const characterRows: Array<{
    work_id: number;
    id: number;
    primary_name: string;
    original_name: string;
    portrait_blob_sha256: string | null;
    display_name: string;
    role_key: string;
    spoiler_level: number;
    sort_order: number | null;
    notes: string | null;
  }> = [];
  const creatorRows: Array<{
    work_id: number;
    id: number;
    name: string;
    original_name: string | null;
    website_url: string | null;
    role_key: string;
    role_label: string | null;
    notes: string | null;
  }> = [];
  results.forEach((result, index) => {
    if (queries[index].kind === "tag") {
      tagRows.push(...((result.results ?? []) as typeof tagRows));
    } else if (queries[index].kind === "character") {
      characterRows.push(...((result.results ?? []) as typeof characterRows));
    } else {
      creatorRows.push(...((result.results ?? []) as typeof creatorRows));
    }
  });
  const tagsByWork = groupRowsByWork(
    tagRows,
    (tag) => ({ id: tag.id, name: tag.name, namespace: tag.namespace }),
  );
  const charactersByWork = groupRowsByWork(
    characterRows,
    (character) => ({
      id: character.id,
      primaryName: character.primary_name,
      originalName: character.original_name,
      displayName: character.display_name,
      portraitBlobSha256: character.portrait_blob_sha256,
      roleKey: character.role_key,
      spoilerLevel: character.spoiler_level,
      sortOrder: character.sort_order,
      notes: character.notes,
    }),
  );
  const creatorsByWork = groupRowsByWork(
    creatorRows,
    (creator) => ({
      id: creator.id,
      name: creator.name,
      originalName: creator.original_name,
      websiteUrl: isHttpUrl(creator.website_url) ? creator.website_url : null,
      roleKey: creator.role_key,
      roleLabel: creator.role_label,
      notes: creator.notes,
    }),
  );

  return rows.map((row) => mapSummaryRow(
    row,
    tagsByWork.get(row.id) ?? [],
    charactersByWork.get(row.id) ?? [],
    creatorsByWork.get(row.id) ?? [],
  ));
}

function mapSummaryRow(
  row: SummaryRow,
  tags: GameTag[],
  characters: GameCharacter[],
  creators: GameCreatorCredit[],
): GameWorkSummary {
  return {
    id: row.id,
    originalTitle: row.original_title,
    chineseTitle: row.chinese_title,
    description: row.description,
    originalReleaseDate: row.original_release_date,
    originalReleasePrecision: row.original_release_precision,
    engineFamily: row.engine_family,
    isOriginal: row.is_original === 1,
    isTranslation: row.is_translation === 1,
    language: row.language,
    status: row.status,
    previewBlobSha256: row.preview_blob_sha256,
    currentArchiveVersionId: row.current_archive_version_id,
    externalDownloadUrl: isHttpUrl(row.external_download_url) ? row.external_download_url : null,
    archiveVersionCount: row.archive_version_count,
    totalSizeBytes: row.total_size_bytes ?? 0,
    latestPublishedAt: row.latest_published_at,
    distribution: deriveWorkDistribution({
      hasCurrentArchive: row.current_archive_version_id !== null,
      downloadLinkCount: row.download_link_count,
    }),
    tags,
    characters,
    creators,
  };
}

function groupRowsByWork<TRow extends { work_id: number }, TValue>(
  rows: TRow[],
  mapValue: (row: TRow) => TValue,
): Map<number, TValue[]> {
  const grouped = new Map<number, TValue[]>();
  for (const row of rows) {
    const values = grouped.get(row.work_id) ?? [];
    values.push(mapValue(row));
    grouped.set(row.work_id, values);
  }
  return grouped;
}

type WorkCollections = {
  aliases: string[];
  tags: GameTag[];
  characters: GameCharacter[];
  creators: GameCreatorCredit[];
  media: GameMediaAsset[];
  links: GameExternalLink[];
  archives: GameArchiveVersionDetail[];
  relations: GameWorkRelation[];
  translations: GameTranslationRelation[];
};

async function loadWorkCollections(
  workId: number,
  includeNonPublic = false,
): Promise<WorkCollections> {
  const database = getD1();
  const targetStatus = includeNonPublic ? "w.status<>'deleted'" : "w.status='published'";
  const results = await database.batch([
    database.prepare(`SELECT title FROM work_titles WHERE work_id=? ORDER BY id`).bind(workId),
    database
      .prepare(
        `SELECT t.id,t.name,t.namespace
         FROM work_tags wt JOIN tags t ON t.id=wt.tag_id
         WHERE wt.work_id=? ORDER BY t.name`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT c.id,c.primary_name,c.original_name,c.portrait_blob_sha256,wc.display_name,wc.role_key,wc.spoiler_level,wc.sort_order,wc.notes
         FROM work_characters wc JOIN characters c ON c.id=wc.character_id
         WHERE wc.work_id=? ORDER BY wc.sort_order,c.primary_name`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT c.id,c.name,c.original_name,c.website_url,ws.role_key,ws.role_label,ws.notes
         FROM work_staff ws JOIN creators c ON c.id=ws.creator_id
         WHERE ws.work_id=? ORDER BY c.name`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT ma.blob_sha256,ma.kind,ma.title,ma.alt_text,wma.sort_order,wma.is_primary
         FROM work_media_assets wma JOIN media_assets ma ON ma.id=wma.media_asset_id
         WHERE wma.work_id=? ORDER BY wma.sort_order`,
      )
      .bind(workId),
    database
      .prepare(`SELECT id,label,url,link_type FROM work_external_links WHERE work_id=? ORDER BY id`)
      .bind(workId),
    database
      .prepare(
        `SELECT av.id,w.language,av.is_current,av.total_files,av.total_size_bytes,
                av.estimated_r2_get_count,av.published_at,u.display_name AS uploader_name
         FROM archive_versions av
         JOIN works w ON w.id=av.work_id
         LEFT JOIN users u ON u.id=av.uploader_id
         WHERE av.work_id=? AND av.status='published' AND av.is_current=1
         ORDER BY av.id DESC`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT wr.id,wr.relation_type,wr.relation_order,wr.vice_versa,
                wr.created_by_user_id,w.id AS work_id,
                COALESCE(w.chinese_title,w.original_title) AS title,${RELATED_PREVIEW_SQL}
         FROM work_relations wr JOIN works w ON w.id=wr.to_work_id
         WHERE wr.from_work_id=? AND ${targetStatus}
         ORDER BY wr.relation_order,wr.id`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT tr.id,tr.target_role AS role,tr.relation_order,tr.created_by_user_id,
                w.id AS work_id,COALESCE(w.chinese_title,w.original_title) AS title,
                w.language,${RELATED_PREVIEW_SQL}
         FROM translation_relations tr JOIN works w ON w.id=tr.target_work_id
         WHERE tr.source_work_id=? AND ${targetStatus}
         ORDER BY tr.relation_order,tr.id`,
      )
      .bind(workId),
  ]);
  const characters = batchRows<{
    id: number;
    primary_name: string;
    original_name: string;
    portrait_blob_sha256: string | null;
    display_name: string;
    role_key: string;
    spoiler_level: number;
    sort_order: number | null;
    notes: string | null;
  }>(results[2]).map((row) => ({
    id: row.id,
    primaryName: row.primary_name,
    originalName: row.original_name,
    displayName: row.display_name,
    portraitBlobSha256: row.portrait_blob_sha256,
    roleKey: row.role_key,
    spoilerLevel: row.spoiler_level,
    sortOrder: row.sort_order,
    notes: row.notes,
  }));
  const creators = batchRows<{
    id: number;
    name: string;
    original_name: string | null;
    website_url: string | null;
    role_key: string;
    role_label: string | null;
    notes: string | null;
  }>(results[3]).map((row) => ({
    id: row.id,
    name: row.name,
    originalName: row.original_name,
    websiteUrl: isHttpUrl(row.website_url) ? row.website_url : null,
    roleKey: row.role_key,
    roleLabel: row.role_label,
    notes: row.notes,
  }));
  return {
    aliases: batchRows<{ title: string }>(results[0]).map((row) => row.title),
    tags: batchRows<GameTag>(results[1]),
    characters,
    creators,
    media: batchRows<{
      blob_sha256: string;
      kind: string;
      title: string | null;
      alt_text: string | null;
      sort_order: number | null;
      is_primary: number;
    }>(results[4]).map((row) => ({
      blobSha256: row.blob_sha256,
      kind: row.kind,
      title: row.title,
      altText: row.alt_text,
      sortOrder: row.sort_order,
      isPrimary: row.is_primary === 1,
    })),
    links: batchRows<{ id: number; label: string; url: string; link_type: string }>(results[5])
      .filter((row) => isHttpUrl(row.url))
      .map((row) => ({ id: row.id, label: row.label, url: row.url, linkType: row.link_type })),
    archives: batchRows<{
      id: number;
      language: string;
      is_current: number;
      total_files: number;
      total_size_bytes: number;
      estimated_r2_get_count: number;
      published_at: string | null;
      uploader_name: string | null;
    }>(results[6]).map((row) => ({
      id: row.id,
      language: row.language,
      isCurrent: row.is_current === 1,
      totalFiles: row.total_files,
      totalSizeBytes: row.total_size_bytes,
      estimatedR2GetCount: row.estimated_r2_get_count,
      publishedAt: row.published_at,
      uploaderName: row.uploader_name,
    })),
    relations: batchRows<{
      id: number;
      relation_type: string;
      relation_order: number;
      vice_versa: number;
      created_by_user_id: number | null;
      work_id: number;
      title: string;
      preview_blob_sha256: string | null;
    }>(results[7]).map((row) => ({
      id: row.id,
      direction: "from" as const,
      relationType: row.relation_type,
      relationOrder: row.relation_order,
      viceVersa: row.vice_versa === 1,
      createdByUserId: row.created_by_user_id,
      workId: row.work_id,
      title: row.title,
      previewBlobSha256: row.preview_blob_sha256,
    })),
    translations: batchRows<{
      id: number;
      role: "original" | "translation";
      relation_order: number;
      created_by_user_id: number | null;
      work_id: number;
      title: string;
      language: string;
      preview_blob_sha256: string | null;
    }>(results[8]).map((row) => ({
      id: row.id,
      role: row.role,
      workId: row.work_id,
      title: row.title,
      language: row.language,
      relationOrder: row.relation_order,
      createdByUserId: row.created_by_user_id,
      previewBlobSha256: row.preview_blob_sha256,
    })),
  };
}

function batchRows<T>(result: D1Result): T[] {
  return (result.results ?? []) as T[];
}
const RELATED_PREVIEW_SQL = `(
  SELECT ma.blob_sha256
  FROM work_media_assets wma
  JOIN media_assets ma ON ma.id = wma.media_asset_id
  WHERE wma.work_id = w.id
    AND ma.kind IN ('cover', 'preview')
  ORDER BY wma.is_primary DESC, wma.sort_order
  LIMIT 1
) AS preview_blob_sha256`;

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
          w.language,
          ${RELATED_PREVIEW_SQL}
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
      preview_blob_sha256: string | null;
    }>();
  return (rows.results ?? []).map((x) => ({
    id: x.id,
    role: x.role,
    workId: x.work_id,
    title: x.title,
    language: x.language,
    relationOrder: x.relation_order,
    createdByUserId: x.created_by_user_id,
    previewBlobSha256: x.preview_blob_sha256,
  }));
}
function normalizeExternalLinks(
  values: GameExternalLink[],
): GameExternalLink[] {
  const links = values
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
  assertSingleDownloadLink(links);
  return links;
}

async function getWorkDistributionState(workId: number): Promise<{
  hasCurrentArchive: boolean;
  archiveVersionCount: number;
}> {
  const row = await getD1()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM archive_versions WHERE work_id=w.id) AS archive_version_count,
         EXISTS(
           SELECT 1 FROM archive_versions
           WHERE work_id=w.id AND status='published' AND is_current=1
         ) AS has_current_archive
       FROM works w
       WHERE w.id=? AND w.status<>'deleted'
       LIMIT 1`,
    )
    .bind(workId)
    .first<{ archive_version_count: number; has_current_archive: number }>();
  if (!row) throw new HttpError(404, "作品不存在");
  return {
    archiveVersionCount: row.archive_version_count,
    hasCurrentArchive: row.has_current_archive === 1,
  };
}
function entityNameKey(value: string): string {
  return value.toLowerCase();
}

function characterSelectionFromGameCharacter(
  character: GameCharacter,
): CharacterSelection {
  return {
    kind: "existing",
    characterId: character.id,
    originalName: character.originalName,
    displayName: character.displayName,
    portraitBlobSha256: character.portraitBlobSha256,
  };
}

function assertPublicationDeclarations(
  isOriginal: boolean,
  isTranslation: boolean,
): void {
  if (isOriginal && isTranslation) {
    throw new HttpError(400, "原创声明与翻译声明不能同时选择");
  }
}

function isCharacterRoleKey(
  value: string | undefined,
): value is "main" | "supporting" | "cameo" | "mentioned" | "other" {
  return value === "main" || value === "supporting" || value === "cameo" || value === "mentioned" || value === "other";
}

function uniqueText(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function validatePreviewHashes(hashes: string[]): Promise<void> {
  if (hashes.some((value) => !/^[a-f0-9]{64}$/.test(value))) {
    throw new HttpError(400, "封面或浏览图哈希不合法");
  }
  if (!hashes.length) return;
  const rows = await getD1()
    .prepare(
      `SELECT sha256,content_type_hint FROM blobs
       WHERE status='active' AND sha256 IN (${hashes.map(() => "?").join(",")})`,
    )
    .bind(...hashes)
    .all<{ sha256: string; content_type_hint: string | null }>();
  const found = new Map(
    (rows.results ?? []).map((row) => [row.sha256, row.content_type_hint]),
  );
  if (
    hashes.some(
      (hash) => !found.has(hash) || !found.get(hash)?.startsWith("image/"),
    )
  ) {
    throw new HttpError(400, "封面或浏览图对象不存在，或不是图片");
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
