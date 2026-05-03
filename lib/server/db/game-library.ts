import { getD1 } from "@/lib/server/db/d1";

export type GameWorkSummary = {
  id: number;
  slug: string;
  originalTitle: string;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  originalReleasePrecision: string;
  engineFamily: string;
  usesManiacsPatch: boolean;
  status: string;
  thumbnailBlobSha256: string | null;
  previewBlobSha256: string | null;
  releaseCount: number;
  archiveVersionCount: number;
  totalSizeBytes: number;
  latestPublishedAt: string | null;
  tags: GameTag[];
  characters: GameCharacter[];
  creators: GameCreatorCredit[];
};

export type GameWorkDetail = GameWorkSummary & {
  sortTitle: string | null;
  engineDetail: string | null;
  aliases: string[];
  media: GameMediaAsset[];
  externalLinks: GameExternalLink[];
  releases: GameReleaseDetail[];
  relations: GameWorkRelation[];
  series: GameSeriesMembership[];
};

export type AdminWorkEdit = {
  id: number;
  slug: string;
  originalTitle: string;
  chineseTitle: string | null;
  sortTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  originalReleasePrecision: string;
  engineFamily: string;
  engineDetail: string | null;
  usesManiacsPatch: boolean;
  status: "draft" | "published" | "hidden" | "deleted";
  aliases: string[];
  tags: string[];
  iconBlobSha256: string | null;
  thumbnailBlobSha256: string | null;
  characters: string[];
  characterCredits: GameCharacter[];
  media: GameMediaAsset[];
  series: GameSeriesMembership[];
  outgoingRelations: GameWorkRelation[];
  externalLinks: GameExternalLink[];
};

export type AdminReleaseSummary = {
  id: number;
  key: string;
  label: string;
  baseVariant: string;
  variantLabel: string;
  type: string;
  releaseDate: string | null;
  status: "draft" | "published" | "hidden" | "deleted";
  archiveVersionCount: number;
  currentArchiveVersionCount: number;
};

export type AdminReleaseEdit = {
  id: number;
  workId: number;
  workSlug: string;
  workTitle: string;
  key: string;
  label: string;
  baseVariant: string;
  variantLabel: string;
  type: string;
  releaseDate: string | null;
  releaseDatePrecision: string;
  sourceName: string | null;
  sourceUrl: string | null;
  executablePath: string | null;
  rightsNotes: string | null;
  status: "draft" | "published" | "hidden";
  tags: string[];
  externalLinks: GameExternalLink[];
  archiveVersions: AdminReleaseArchiveVersion[];
};

export type AdminReleaseArchiveVersion = {
  id: number;
  archiveKey: string;
  archiveLabel: string;
  archiveVariantLabel: string;
  language: string;
  isProofread: boolean;
  isImageEdited: boolean;
  isCurrent: boolean;
  status: "draft" | "published" | "hidden" | "deleted";
  totalFiles: number;
  totalSizeBytes: number;
  uploaderName: string | null;
  publishedAt: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
};

export type AdminArchiveVersionEdit = {
  id: number;
  releaseId: number;
  workId: number;
  workSlug: string;
  workTitle: string;
  releaseLabel: string;
  archiveKey: string;
  archiveLabel: string;
  archiveVariantLabel: string;
  language: string;
  isProofread: boolean;
  isImageEdited: boolean;
  isCurrent: boolean;
  status: "draft" | "published" | "hidden";
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  manifestSha256: string;
  manifestR2Key: string;
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
};

export type GameTag = {
  slug: string;
  name: string;
  namespace: string;
};

export type GameCharacter = {
  slug: string;
  primaryName: string;
  originalName: string | null;
  roleKey: string;
  spoilerLevel: number;
  sortOrder: number | null;
  notes: string | null;
};

export type GameCreatorCredit = {
  slug: string;
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

export type GameReleaseDetail = {
  id: number;
  key: string;
  label: string;
  baseVariant: string;
  variantLabel: string;
  type: string;
  releaseDate: string | null;
  releaseDatePrecision: string;
  sourceName: string | null;
  sourceUrl: string | null;
  executablePath: string | null;
  rightsNotes: string | null;
  tags: GameTag[];
  staff: GameCreatorCredit[];
  externalLinks: GameExternalLink[];
  archiveVersions: GameArchiveVersionDetail[];
};

export type GameArchiveVersionDetail = {
  id: number;
  archiveKey: string;
  archiveLabel: string;
  archiveVariantLabel: string;
  language: string;
  isProofread: boolean;
  isImageEdited: boolean;
  isCurrent: boolean;
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  publishedAt: string | null;
  uploaderName: string | null;
};

export type GameWorkRelation = {
  direction: "from" | "to";
  relationType: string;
  notes: string | null;
  workId: number;
  slug: string;
  title: string;
};

export type GameSeriesMembership = {
  seriesId: number;
  slug: string;
  title: string;
  positionNumber: number | null;
  positionLabel: string | null;
  relationKind: string;
};

export type AdminWorkCharacterInput = {
  name: string;
  roleKey: string;
  spoilerLevel: number;
  sortOrder: number | null;
  notes: string | null;
};

export type AdminWorkSeriesInput = {
  slug: string;
  title: string;
  positionNumber: number | null;
  positionLabel: string | null;
  relationKind: string;
  notes: string | null;
};

export type AdminWorkRelationInput = {
  targetSlug: string;
  relationType: string;
  notes: string | null;
};

type WorkSummaryRow = {
  id: number;
  slug: string;
  original_title: string;
  chinese_title: string | null;
  description: string | null;
  original_release_date: string | null;
  original_release_precision: string;
  engine_family: string;
  uses_maniacs_patch: number;
  status: string;
  thumbnail_blob_sha256: string | null;
  preview_blob_sha256: string | null;
  release_count: number;
  archive_version_count: number;
  total_size_bytes: number | null;
  latest_published_at: string | null;
};

type WorkDetailRow = WorkSummaryRow & {
  sort_title: string | null;
  engine_detail: string | null;
};

type TagRow = {
  work_id?: number;
  release_id?: number;
  slug: string;
  name: string;
  namespace: string;
};

type CharacterRow = {
  work_id?: number;
  slug: string;
  primary_name: string;
  original_name: string | null;
  role_key: string;
  spoiler_level: number;
  sort_order: number | null;
  notes: string | null;
};

type CreatorCreditRow = {
  work_id?: number;
  release_id?: number;
  slug: string;
  name: string;
  original_name: string | null;
  website_url: string | null;
  role_key: string;
  role_label: string | null;
};

type ReleaseRow = {
  id: number;
  release_key: string;
  release_label: string;
  base_variant: string;
  variant_label: string;
  release_type: string;
  release_date: string | null;
  release_date_precision: string;
  source_name: string | null;
  source_url: string | null;
  executable_path: string | null;
  rights_notes: string | null;
};

type ArchiveVersionRow = {
  release_id: number;
  id: number;
  archive_key: string;
  archive_label: string;
  archive_variant_label: string;
  language: string;
  is_proofread: number;
  is_image_edited: number;
  is_current: number;
  total_files: number;
  total_size_bytes: number;
  estimated_r2_get_count: number;
  published_at: string | null;
  uploader_name: string | null;
};

type AliasRow = {
  title: string;
};

type MediaRow = {
  blob_sha256: string;
  kind: string;
  title: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: number;
};

type ExternalLinkRow = {
  id: number;
  label: string;
  url: string;
  link_type: string;
};

type AdminReleaseSummaryRow = {
  id: number;
  release_key: string;
  release_label: string;
  base_variant: string;
  variant_label: string;
  release_type: string;
  release_date: string | null;
  status: AdminReleaseSummary["status"];
  archive_version_count: number;
  current_archive_version_count: number;
};

type AdminReleaseEditRow = {
  id: number;
  work_id: number;
  work_slug: string;
  work_title: string;
  release_key: string;
  release_label: string;
  base_variant: string;
  variant_label: string;
  release_type: string;
  release_date: string | null;
  release_date_precision: string;
  source_name: string | null;
  source_url: string | null;
  executable_path: string | null;
  rights_notes: string | null;
  status: AdminReleaseEdit["status"];
};

type AdminReleaseArchiveVersionRow = {
  id: number;
  archive_key: string;
  archive_label: string;
  archive_variant_label: string;
  language: string;
  is_proofread: number;
  is_image_edited: number;
  is_current: number;
  status: AdminReleaseArchiveVersion["status"];
  total_files: number;
  total_size_bytes: number;
  uploader_name: string | null;
  published_at: string | null;
  deleted_at: string | null;
  purged_at: string | null;
};

type AdminArchiveVersionEditRow = {
  id: number;
  release_id: number;
  work_id: number;
  work_slug: string;
  work_title: string;
  release_label: string;
  archive_key: string;
  archive_label: string;
  archive_variant_label: string;
  language: string;
  is_proofread: number;
  is_image_edited: number;
  is_current: number;
  status: AdminArchiveVersionEdit["status"];
  total_files: number;
  total_size_bytes: number;
  estimated_r2_get_count: number;
  manifest_sha256: string;
  manifest_r2_key: string;
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
};

type RelationRow = {
  direction: "from" | "to";
  relation_type: string;
  notes: string | null;
  work_id: number;
  slug: string;
  title: string;
};

type SeriesRow = {
  series_id: number;
  slug: string;
  title: string;
  position_number: number | null;
  position_label: string | null;
  relation_kind: string;
};

export async function listGameWorks(input: {
  query?: string;
  engine?: string;
  tag?: string;
  tagQuery?: string;
  character?: string;
  limit?: number;
  includeNonPublic?: boolean;
} = {}): Promise<GameWorkSummary[]> {
  const where: string[] = [];
  const binds: Array<string | number> = [];

  if (!input.includeNonPublic) {
    where.push("w.status = 'published'");
  } else {
    where.push("w.status <> 'deleted'");
  }

  if (input.engine && input.engine !== "all") {
    where.push("w.engine_family = ?");
    binds.push(input.engine);
  }

  if (input.tag) {
    where.push(
      `(EXISTS (
        SELECT 1
        FROM work_tags wt
        JOIN tags t ON t.id = wt.tag_id
        WHERE wt.work_id = w.id
          AND t.slug = ?
      )
      OR EXISTS (
        SELECT 1
        FROM releases r
        JOIN release_tags rt ON rt.release_id = r.id
        JOIN tags t ON t.id = rt.tag_id
        WHERE r.work_id = w.id
          AND r.status = 'published'
          AND t.slug = ?
      ))`,
    );
    binds.push(input.tag, input.tag);
  }

  const normalizedTagQuery = input.tagQuery?.trim();

  if (normalizedTagQuery) {
    const pattern = `%${normalizedTagQuery}%`;
    where.push(
      `(EXISTS (
        SELECT 1
        FROM work_tags wt
        JOIN tags t ON t.id = wt.tag_id
        WHERE wt.work_id = w.id
          AND (t.name LIKE ? OR t.slug LIKE ?)
      )
      OR EXISTS (
        SELECT 1
        FROM releases r
        JOIN release_tags rt ON rt.release_id = r.id
        JOIN tags t ON t.id = rt.tag_id
        WHERE r.work_id = w.id
          AND r.status = 'published'
          AND (t.name LIKE ? OR t.slug LIKE ?)
      ))`,
    );
    binds.push(pattern, pattern, pattern, pattern);
  }

  if (input.character) {
    where.push(
      `EXISTS (
        SELECT 1
        FROM work_characters wc
        JOIN characters ch ON ch.id = wc.character_id
        WHERE wc.work_id = w.id
          AND ch.slug = ?
      )`,
    );
    binds.push(input.character);
  }

  const normalizedQuery = input.query?.trim();

  if (normalizedQuery) {
    const pattern = `%${normalizedQuery}%`;
    where.push(
      `(w.original_title LIKE ?
        OR w.chinese_title LIKE ?
        OR EXISTS (
          SELECT 1 FROM work_titles title
          WHERE title.work_id = w.id
            AND title.is_searchable = 1
            AND title.title LIKE ?
        )
        OR EXISTS (
          SELECT 1
          FROM work_staff ws
          JOIN creators c ON c.id = ws.creator_id
          WHERE ws.work_id = w.id
            AND (c.name LIKE ? OR c.original_name LIKE ?)
        )
        OR EXISTS (
          SELECT 1
          FROM work_tags wt
          JOIN tags t ON t.id = wt.tag_id
          WHERE wt.work_id = w.id
            AND (t.name LIKE ? OR t.slug LIKE ?)
        )
        OR EXISTS (
          SELECT 1
          FROM releases r
          JOIN release_tags rt ON rt.release_id = r.id
          JOIN tags t ON t.id = rt.tag_id
          WHERE r.work_id = w.id
            AND r.status = 'published'
            AND (t.name LIKE ? OR t.slug LIKE ?)
        )
        OR EXISTS (
          SELECT 1
          FROM work_characters wc
          JOIN characters ch ON ch.id = wc.character_id
          WHERE wc.work_id = w.id
            AND (ch.primary_name LIKE ? OR ch.original_name LIKE ?)
        ))`,
    );
    binds.push(
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
    );
  }

  const rows = await getD1()
    .prepare(
      `${workSummarySelectSql()}
      FROM works w
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        COALESCE(latest_published_at, w.published_at, w.created_at) DESC,
        COALESCE(w.sort_title, w.chinese_title, w.original_title) ASC
      LIMIT ?`,
    )
    .bind(...binds, clampLimit(input.limit ?? 80, 1, 200))
    .all<WorkSummaryRow>();

  return hydrateWorkSummaries(rows.results ?? []);
}

export async function getGameWorkDetail(slug: string): Promise<GameWorkDetail | null> {
  const routeSlugs = uniqueClean([slug, decodeRouteSlug(slug)]);
  const placeholders = routeSlugs.map(() => "?").join(", ");
  const row = await getD1()
    .prepare(
      `${workSummarySelectSql()},
        w.sort_title,
        w.engine_detail
      FROM works w
      WHERE w.slug IN (${placeholders})
        AND w.status = 'published'
      LIMIT 1`,
    )
    .bind(...routeSlugs)
    .first<WorkDetailRow>();

  if (!row) {
    return null;
  }

  const [summary] = await hydrateWorkSummaries([row]);
  const [
    aliases,
    media,
    externalLinks,
    releases,
    releaseTags,
    releaseStaff,
    releaseLinks,
    archiveVersions,
    relations,
    series,
  ] = await Promise.all([
    listWorkAliases(row.id),
    listWorkMedia(row.id),
    listWorkExternalLinks(row.id),
    listReleasesForWork(row.id),
    listReleaseTagsForWork(row.id),
    listReleaseStaffForWork(row.id),
    listReleaseExternalLinksForWork(row.id),
    listArchiveVersionsForWork(row.id),
    listWorkRelations(row.id),
    listWorkSeries(row.id),
  ]);
  const tagsByRelease = groupBy(releaseTags, (item) => String(item.release_id));
  const staffByRelease = groupBy(releaseStaff, (item) => String(item.release_id));
  const linksByRelease = groupBy(releaseLinks, (item) => String(item.release_id));
  const archivesByRelease = groupBy(archiveVersions, (item) => String(item.release_id));

  return {
    ...summary,
    sortTitle: row.sort_title,
    engineDetail: row.engine_detail,
    aliases,
    media,
    externalLinks,
    releases: releases.map((release) => ({
      id: release.id,
      key: release.release_key,
      label: release.release_label,
      baseVariant: release.base_variant,
      variantLabel: release.variant_label,
      type: release.release_type,
      releaseDate: release.release_date,
      releaseDatePrecision: release.release_date_precision,
      sourceName: release.source_name,
      sourceUrl: release.source_url,
      executablePath: release.executable_path,
      rightsNotes: release.rights_notes,
      tags: (tagsByRelease[String(release.id)] ?? []).map(mapTagRow),
      staff: (staffByRelease[String(release.id)] ?? []).map(mapCreatorCreditRow),
      externalLinks: (linksByRelease[String(release.id)] ?? []).map(mapExternalLinkRow),
      archiveVersions: (archivesByRelease[String(release.id)] ?? []).map(mapArchiveVersionRow),
    })),
    relations,
    series,
  };
}

export async function listEditableWorksForAdmin(limit = 200): Promise<GameWorkSummary[]> {
  return listGameWorks({ includeNonPublic: true, limit });
}

export async function getWorkForAdminEdit(workId: number): Promise<AdminWorkEdit | null> {
  const row = await getD1()
    .prepare(
      `SELECT
        id,
        slug,
        original_title,
        chinese_title,
        sort_title,
        description,
        original_release_date,
        original_release_precision,
        engine_family,
        engine_detail,
        uses_maniacs_patch,
        icon_blob_sha256,
        thumbnail_blob_sha256,
        status
      FROM works
      WHERE id = ?
      LIMIT 1`,
    )
    .bind(workId)
    .first<{
      id: number;
      slug: string;
      original_title: string;
      chinese_title: string | null;
      sort_title: string | null;
      description: string | null;
      original_release_date: string | null;
      original_release_precision: string;
      engine_family: string;
      engine_detail: string | null;
      uses_maniacs_patch: number;
      icon_blob_sha256: string | null;
      thumbnail_blob_sha256: string | null;
      status: AdminWorkEdit["status"];
    }>();

  if (!row) {
    return null;
  }

  const [aliases, tags, characters, media, series, outgoingRelations, externalLinks] = await Promise.all([
    listWorkAliases(row.id),
    listWorkTags(row.id),
    listWorkCharacters(row.id),
    listWorkMedia(row.id),
    listWorkSeriesAdmin(row.id),
    listWorkOutgoingRelationsAdmin(row.id),
    listWorkExternalLinks(row.id),
  ]);

  return {
    id: row.id,
    slug: row.slug,
    originalTitle: row.original_title,
    chineseTitle: row.chinese_title,
    sortTitle: row.sort_title,
    description: row.description,
    originalReleaseDate: row.original_release_date,
    originalReleasePrecision: row.original_release_precision,
    engineFamily: row.engine_family,
    engineDetail: row.engine_detail,
    usesManiacsPatch: row.uses_maniacs_patch === 1,
    status: row.status,
    aliases,
    tags: tags.map((tag) => tag.name),
    iconBlobSha256: row.icon_blob_sha256,
    thumbnailBlobSha256: row.thumbnail_blob_sha256,
    characters: characters.map((character) => character.primaryName),
    characterCredits: characters,
    media,
    series,
    outgoingRelations,
    externalLinks,
  };
}

export async function updateWorkForAdmin(input: {
  workId: number;
  chineseTitle: string | null;
  sortTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  originalReleasePrecision: string;
  engineFamily: string;
  engineDetail: string | null;
  usesManiacsPatch: boolean;
  status: string;
  iconBlobSha256: string | null;
  thumbnailBlobSha256: string | null;
  aliases: string[];
  tags: string[];
  characters: AdminWorkCharacterInput[];
  previewBlobSha256s: string[];
  seriesMemberships: AdminWorkSeriesInput[];
  outgoingRelations: AdminWorkRelationInput[];
  externalLinks: Array<{
    label: string;
    url: string;
    linkType: string;
  }>;
}): Promise<AdminWorkEdit> {
  assertEnum(input.originalReleasePrecision, ["year", "month", "day", "unknown"], "发布日期精度");
  assertEnum(
    input.engineFamily,
    ["rpg_maker_2000", "rpg_maker_2003", "mixed", "unknown", "other"],
    "引擎",
  );
  assertEnum(input.status, ["draft", "published", "hidden"], "状态");

  const existing = await getWorkForAdminEdit(input.workId);

  if (!existing) {
    throw new Error("作品不存在");
  }

  await getD1()
    .prepare(
      `UPDATE works
      SET chinese_title = ?,
        sort_title = ?,
        description = ?,
        original_release_date = ?,
        original_release_precision = ?,
        engine_family = ?,
        engine_detail = ?,
        uses_maniacs_patch = ?,
        icon_blob_sha256 = ?,
        thumbnail_blob_sha256 = ?,
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
      input.sortTitle,
      input.description,
      input.originalReleaseDate,
      input.originalReleasePrecision,
      input.engineFamily,
      input.engineDetail,
      input.usesManiacsPatch ? 1 : 0,
      input.iconBlobSha256,
      input.thumbnailBlobSha256,
      input.status,
      input.status,
      input.workId,
    )
    .run();

  await replaceAliases(input.workId, input.aliases);
  await replaceWorkTags(input.workId, input.tags);
  await replaceWorkCharacters(input.workId, input.characters);
  await replaceWorkMediaAssets(input.workId, input.previewBlobSha256s);
  await replaceWorkSeries(input.workId, input.seriesMemberships);
  await replaceWorkOutgoingRelations(input.workId, input.outgoingRelations);
  await replaceWorkExternalLinks(input.workId, input.externalLinks);

  const updated = await getWorkForAdminEdit(input.workId);

  if (!updated) {
    throw new Error("作品更新后不可读取");
  }

  return updated;
}

export async function listAdminReleasesForWork(
  workId: number,
): Promise<AdminReleaseSummary[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        r.id,
        r.release_key,
        r.release_label,
        r.base_variant,
        r.variant_label,
        r.release_type,
        r.release_date,
        r.status,
        (
          SELECT COUNT(*)
          FROM archive_versions av
          WHERE av.release_id = r.id
            AND av.status <> 'deleted'
        ) AS archive_version_count,
        (
          SELECT COUNT(*)
          FROM archive_versions av
          WHERE av.release_id = r.id
            AND av.status = 'published'
            AND av.is_current = 1
        ) AS current_archive_version_count
      FROM releases r
      WHERE r.work_id = ?
        AND r.status <> 'deleted'
      ORDER BY
        COALESCE(r.release_date, r.created_at) DESC,
        r.id DESC`,
    )
    .bind(workId)
    .all<AdminReleaseSummaryRow>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    key: row.release_key,
    label: row.release_label,
    baseVariant: row.base_variant,
    variantLabel: row.variant_label,
    type: row.release_type,
    releaseDate: row.release_date,
    status: row.status,
    archiveVersionCount: row.archive_version_count,
    currentArchiveVersionCount: row.current_archive_version_count,
  }));
}

export async function getReleaseForAdminEdit(
  releaseId: number,
): Promise<AdminReleaseEdit | null> {
  const row = await getD1()
    .prepare(
      `SELECT
        r.id,
        w.id AS work_id,
        w.slug AS work_slug,
        COALESCE(w.chinese_title, w.original_title) AS work_title,
        r.release_key,
        r.release_label,
        r.base_variant,
        r.variant_label,
        r.release_type,
        r.release_date,
        r.release_date_precision,
        r.source_name,
        r.source_url,
        r.executable_path,
        r.rights_notes,
        r.status
      FROM releases r
      JOIN works w ON w.id = r.work_id
      WHERE r.id = ?
        AND r.status <> 'deleted'
      LIMIT 1`,
    )
    .bind(releaseId)
    .first<AdminReleaseEditRow>();

  if (!row) {
    return null;
  }

  const [tags, externalLinks, archiveVersions] = await Promise.all([
    listReleaseTags(row.id),
    listReleaseExternalLinks(row.id),
    listArchiveVersionsForReleaseAdmin(row.id),
  ]);

  return {
    id: row.id,
    workId: row.work_id,
    workSlug: row.work_slug,
    workTitle: row.work_title,
    key: row.release_key,
    label: row.release_label,
    baseVariant: row.base_variant,
    variantLabel: row.variant_label,
    type: row.release_type,
    releaseDate: row.release_date,
    releaseDatePrecision: row.release_date_precision,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    executablePath: row.executable_path,
    rightsNotes: row.rights_notes,
    status: row.status,
    tags: tags.map((tag) => tag.name),
    externalLinks,
    archiveVersions,
  };
}

export async function updateReleaseForAdmin(input: {
  releaseId: number;
  label: string;
  baseVariant: string;
  variantLabel: string;
  type: string;
  releaseDate: string | null;
  releaseDatePrecision: string;
  sourceName: string | null;
  sourceUrl: string | null;
  executablePath: string | null;
  rightsNotes: string | null;
  status: string;
  tags: string[];
  externalLinks: Array<{
    label: string;
    url: string;
    linkType: string;
  }>;
}): Promise<AdminReleaseEdit> {
  assertRequired(input.label, "Release 名称");
  assertRequired(input.variantLabel, "版本分支");
  assertEnum(input.baseVariant, ["original", "remake", "other"], "基底版本");
  assertEnum(
    input.type,
    [
      "original",
      "translation",
      "revision",
      "localized_revision",
      "demo",
      "event_submission",
      "patch_applied_full_release",
      "repack",
      "other",
    ],
    "Release 类型",
  );
  assertEnum(input.releaseDatePrecision, ["year", "month", "day", "unknown"], "发布日期精度");
  assertEnum(input.status, ["draft", "published", "hidden"], "状态");

  const existing = await getReleaseForAdminEdit(input.releaseId);

  if (!existing) {
    throw new Error("Release 不存在");
  }

  await getD1()
    .prepare(
      `UPDATE releases
      SET release_label = ?,
        base_variant = ?,
        variant_label = ?,
        release_type = ?,
        release_date = ?,
        release_date_precision = ?,
        source_name = ?,
        source_url = ?,
        executable_path = ?,
        rights_notes = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP,
        published_at = CASE
          WHEN ? = 'published' THEN COALESCE(published_at, CURRENT_TIMESTAMP)
          ELSE published_at
        END
      WHERE id = ?`,
    )
    .bind(
      input.label.trim(),
      input.baseVariant,
      input.variantLabel.trim(),
      input.type,
      input.releaseDate,
      input.releaseDatePrecision,
      input.sourceName,
      input.sourceUrl,
      input.executablePath,
      input.rightsNotes,
      input.status,
      input.status,
      input.releaseId,
    )
    .run();

  await replaceReleaseTags(input.releaseId, input.tags);
  await replaceReleaseExternalLinks(input.releaseId, input.externalLinks);

  const updated = await getReleaseForAdminEdit(input.releaseId);

  if (!updated) {
    throw new Error("Release 更新后不可读取");
  }

  return updated;
}

export async function getArchiveVersionForAdminEdit(
  archiveVersionId: number,
): Promise<AdminArchiveVersionEdit | null> {
  const row = await getD1()
    .prepare(
      `SELECT
        av.id,
        av.release_id,
        w.id AS work_id,
        w.slug AS work_slug,
        COALESCE(w.chinese_title, w.original_title) AS work_title,
        r.release_label,
        av.archive_key,
        av.archive_label,
        av.archive_variant_label,
        av.language,
        av.is_proofread,
        av.is_image_edited,
        av.is_current,
        av.status,
        av.total_files,
        av.total_size_bytes,
        av.estimated_r2_get_count,
        av.manifest_sha256,
        av.manifest_r2_key,
        av.file_policy_version,
        av.packer_version,
        av.source_type,
        av.source_name,
        av.source_file_count,
        av.source_size_bytes,
        av.excluded_file_count,
        av.excluded_size_bytes,
        av.created_at,
        av.published_at,
        u.display_name AS uploader_name
      FROM archive_versions av
      JOIN releases r ON r.id = av.release_id
      JOIN works w ON w.id = r.work_id
      LEFT JOIN users u ON u.id = av.uploader_id
      WHERE av.id = ?
        AND av.status <> 'deleted'
      LIMIT 1`,
    )
    .bind(archiveVersionId)
    .first<AdminArchiveVersionEditRow>();

  if (!row) {
    return null;
  }

  return mapAdminArchiveVersionEditRow(row);
}

export async function updateArchiveVersionForAdmin(input: {
  archiveVersionId: number;
  archiveLabel: string;
  archiveVariantLabel: string;
  language: string;
  isProofread: boolean;
  isImageEdited: boolean;
  status: string;
}): Promise<AdminArchiveVersionEdit> {
  assertRequired(input.archiveLabel, "ArchiveVersion 名称");
  assertRequired(input.archiveVariantLabel, "ArchiveVersion 分支");
  assertRequired(input.language, "语言");
  assertEnum(input.status, ["draft", "published", "hidden"], "状态");

  const existing = await getArchiveVersionForAdminEdit(input.archiveVersionId);

  if (!existing) {
    throw new Error("ArchiveVersion 不存在");
  }

  const shouldEnsureReplacementCurrent =
    existing.isCurrent && input.status !== "published";

  await getD1()
    .prepare(
      `UPDATE archive_versions
      SET archive_label = ?,
        archive_variant_label = ?,
        language = ?,
        is_proofread = ?,
        is_image_edited = ?,
        status = ?,
        is_current = CASE
          WHEN ? = 'published' THEN is_current
          ELSE 0
        END,
        published_at = CASE
          WHEN ? = 'published' THEN COALESCE(published_at, CURRENT_TIMESTAMP)
          ELSE published_at
        END
      WHERE id = ?
        AND status <> 'deleted'`,
    )
    .bind(
      input.archiveLabel.trim(),
      input.archiveVariantLabel.trim(),
      input.language.trim(),
      input.isProofread ? 1 : 0,
      input.isImageEdited ? 1 : 0,
      input.status,
      input.status,
      input.status,
      input.archiveVersionId,
    )
    .run();

  if (shouldEnsureReplacementCurrent) {
    await ensureCurrentArchiveVersionForAdmin(existing.releaseId, existing.archiveKey);
  }

  const updated = await getArchiveVersionForAdminEdit(input.archiveVersionId);

  if (!updated) {
    throw new Error("ArchiveVersion 更新后不可读取");
  }

  return updated;
}

export async function listPublicTags(limit = 100): Promise<GameTag[]> {
  const rows = await getD1()
    .prepare(
      `SELECT DISTINCT slug, name, namespace
      FROM (
        SELECT t.slug, t.name, t.namespace
        FROM tags t
        JOIN work_tags wt ON wt.tag_id = t.id
        JOIN works w ON w.id = wt.work_id
        WHERE w.status = 'published'
        UNION
        SELECT t.slug, t.name, t.namespace
        FROM tags t
        JOIN release_tags rt ON rt.tag_id = t.id
        JOIN releases r ON r.id = rt.release_id
        JOIN works w ON w.id = r.work_id
        WHERE w.status = 'published'
          AND r.status = 'published'
      )
      ORDER BY name ASC
      LIMIT ?`,
    )
    .bind(clampLimit(limit, 1, 300))
    .all<TagRow>();

  return (rows.results ?? []).map(mapTagRow);
}

export async function listPublicCharacters(limit = 100): Promise<GameCharacter[]> {
  const rows = await getD1()
    .prepare(
      `SELECT DISTINCT
        ch.slug,
        ch.primary_name,
        ch.original_name,
        'supporting' AS role_key,
        0 AS spoiler_level,
        NULL AS sort_order,
        NULL AS notes
      FROM characters ch
      JOIN work_characters wc ON wc.character_id = ch.id
      JOIN works w ON w.id = wc.work_id
      WHERE w.status = 'published'
      ORDER BY ch.primary_name ASC
      LIMIT ?`,
    )
    .bind(clampLimit(limit, 1, 300))
    .all<CharacterRow>();

  return (rows.results ?? []).map(mapCharacterRow);
}

function workSummarySelectSql(): string {
  return `SELECT
    w.id,
    w.slug,
    w.original_title,
    w.chinese_title,
    w.description,
    w.original_release_date,
    w.original_release_precision,
    w.engine_family,
    w.uses_maniacs_patch,
    w.status,
    w.thumbnail_blob_sha256,
    COALESCE(
      (
        SELECT ma.blob_sha256
        FROM work_media_assets wma
        JOIN media_assets ma ON ma.id = wma.media_asset_id
        WHERE wma.work_id = w.id
          AND ma.kind = 'preview'
        ORDER BY wma.is_primary DESC, wma.sort_order ASC, ma.id ASC
        LIMIT 1
      ),
      w.thumbnail_blob_sha256,
      w.icon_blob_sha256
    ) AS preview_blob_sha256,
    (
      SELECT COUNT(*)
      FROM releases r
      WHERE r.work_id = w.id
        AND r.status = 'published'
    ) AS release_count,
    (
      SELECT COUNT(*)
      FROM releases r
      JOIN archive_versions av ON av.release_id = r.id
      WHERE r.work_id = w.id
        AND r.status = 'published'
        AND av.status = 'published'
    ) AS archive_version_count,
    (
      SELECT COALESCE(SUM(av.total_size_bytes), 0)
      FROM releases r
      JOIN archive_versions av ON av.release_id = r.id
      WHERE r.work_id = w.id
        AND r.status = 'published'
        AND av.status = 'published'
        AND av.is_current = 1
    ) AS total_size_bytes,
    (
      SELECT MAX(av.published_at)
      FROM releases r
      JOIN archive_versions av ON av.release_id = r.id
      WHERE r.work_id = w.id
        AND r.status = 'published'
        AND av.status = 'published'
    ) AS latest_published_at`;
}

async function hydrateWorkSummaries(rows: WorkSummaryRow[]): Promise<GameWorkSummary[]> {
  if (rows.length === 0) {
    return [];
  }

  const workIds = rows.map((row) => row.id);
  const [tagRows, characterRows, creatorRows] = await Promise.all([
    listWorkTagsForWorks(workIds),
    listWorkCharactersForWorks(workIds),
    listWorkCreatorsForWorks(workIds),
  ]);
  const tagsByWork = groupBy(tagRows, (item) => String(item.work_id));
  const charactersByWork = groupBy(characterRows, (item) => String(item.work_id));
  const creatorsByWork = groupBy(creatorRows, (item) => String(item.work_id));

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    originalTitle: row.original_title,
    chineseTitle: row.chinese_title,
    description: row.description,
    originalReleaseDate: row.original_release_date,
    originalReleasePrecision: row.original_release_precision,
    engineFamily: row.engine_family,
    usesManiacsPatch: row.uses_maniacs_patch === 1,
    status: row.status,
    thumbnailBlobSha256: row.thumbnail_blob_sha256,
    previewBlobSha256: row.preview_blob_sha256,
    releaseCount: row.release_count,
    archiveVersionCount: row.archive_version_count,
    totalSizeBytes: row.total_size_bytes ?? 0,
    latestPublishedAt: row.latest_published_at,
    tags: (tagsByWork[String(row.id)] ?? []).map(mapTagRow),
    characters: (charactersByWork[String(row.id)] ?? []).map(mapCharacterRow),
    creators: (creatorsByWork[String(row.id)] ?? []).map(mapCreatorCreditRow),
  }));
}

async function listWorkAliases(workId: number): Promise<string[]> {
  const rows = await getD1()
    .prepare(
      `SELECT title
      FROM work_titles
      WHERE work_id = ?
      ORDER BY title ASC`,
    )
    .bind(workId)
    .all<AliasRow>();

  return (rows.results ?? []).map((row) => row.title);
}

async function listWorkTags(workId: number): Promise<GameTag[]> {
  const rows = await getD1()
    .prepare(
      `SELECT t.slug, t.name, t.namespace
      FROM work_tags wt
      JOIN tags t ON t.id = wt.tag_id
      WHERE wt.work_id = ?
      ORDER BY t.name ASC`,
    )
    .bind(workId)
    .all<TagRow>();

  return (rows.results ?? []).map(mapTagRow);
}

async function listWorkTagsForWorks(workIds: number[]): Promise<TagRow[]> {
  const placeholders = workIds.map(() => "?").join(", ");
  const rows = await getD1()
    .prepare(
      `SELECT wt.work_id, t.slug, t.name, t.namespace
      FROM work_tags wt
      JOIN tags t ON t.id = wt.tag_id
      WHERE wt.work_id IN (${placeholders})
      ORDER BY t.name ASC`,
    )
    .bind(...workIds)
    .all<TagRow>();

  return rows.results ?? [];
}

async function listWorkCharacters(workId: number): Promise<GameCharacter[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        ch.slug,
        ch.primary_name,
        ch.original_name,
        wc.role_key,
        wc.spoiler_level,
        wc.sort_order,
        wc.notes
      FROM work_characters wc
      JOIN characters ch ON ch.id = wc.character_id
      WHERE wc.work_id = ?
      ORDER BY COALESCE(wc.sort_order, 999999) ASC, ch.primary_name ASC`,
    )
    .bind(workId)
    .all<CharacterRow>();

  return (rows.results ?? []).map(mapCharacterRow);
}

async function listWorkCharactersForWorks(workIds: number[]): Promise<CharacterRow[]> {
  const placeholders = workIds.map(() => "?").join(", ");
  const rows = await getD1()
    .prepare(
      `SELECT
        wc.work_id,
        ch.slug,
        ch.primary_name,
        ch.original_name,
        wc.role_key,
        wc.spoiler_level,
        wc.sort_order,
        wc.notes
      FROM work_characters wc
      JOIN characters ch ON ch.id = wc.character_id
      WHERE wc.work_id IN (${placeholders})
      ORDER BY wc.work_id ASC, COALESCE(wc.sort_order, 999999) ASC, ch.primary_name ASC`,
    )
    .bind(...workIds)
    .all<CharacterRow>();

  return rows.results ?? [];
}

async function listWorkCreatorsForWorks(workIds: number[]): Promise<CreatorCreditRow[]> {
  const placeholders = workIds.map(() => "?").join(", ");
  const rows = await getD1()
    .prepare(
      `SELECT
        ws.work_id,
        c.slug,
        c.name,
        c.original_name,
        c.website_url,
        ws.role_key,
        ws.role_label
      FROM work_staff ws
      JOIN creators c ON c.id = ws.creator_id
      WHERE ws.work_id IN (${placeholders})
      ORDER BY ws.role_key ASC, c.name ASC`,
    )
    .bind(...workIds)
    .all<CreatorCreditRow>();

  return rows.results ?? [];
}

async function listWorkMedia(workId: number): Promise<GameMediaAsset[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        ma.blob_sha256,
        ma.kind,
        ma.title,
        ma.alt_text,
        wma.sort_order,
        wma.is_primary
      FROM work_media_assets wma
      JOIN media_assets ma ON ma.id = wma.media_asset_id
      WHERE wma.work_id = ?
      ORDER BY wma.is_primary DESC, wma.sort_order ASC, ma.id ASC`,
    )
    .bind(workId)
    .all<MediaRow>();

  return (rows.results ?? []).map((row) => ({
    blobSha256: row.blob_sha256,
    kind: row.kind,
    title: row.title,
    altText: row.alt_text,
    sortOrder: row.sort_order,
    isPrimary: row.is_primary === 1,
  }));
}

async function listWorkExternalLinks(workId: number): Promise<GameExternalLink[]> {
  const rows = await getD1()
    .prepare(
      `SELECT id, label, url, link_type
      FROM work_external_links
      WHERE work_id = ?
      ORDER BY id ASC`,
    )
    .bind(workId)
    .all<ExternalLinkRow>();

  return (rows.results ?? []).map(mapExternalLinkRow);
}

async function listReleasesForWork(workId: number): Promise<ReleaseRow[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        id,
        release_key,
        release_label,
        base_variant,
        variant_label,
        release_type,
        release_date,
        release_date_precision,
        source_name,
        source_url,
        executable_path,
        rights_notes
      FROM releases
      WHERE work_id = ?
        AND status = 'published'
      ORDER BY
        COALESCE(release_date, created_at) DESC,
        id DESC`,
    )
    .bind(workId)
    .all<ReleaseRow>();

  return rows.results ?? [];
}

async function listReleaseTagsForWork(workId: number): Promise<TagRow[]> {
  const rows = await getD1()
    .prepare(
      `SELECT rt.release_id, t.slug, t.name, t.namespace
      FROM release_tags rt
      JOIN tags t ON t.id = rt.tag_id
      JOIN releases r ON r.id = rt.release_id
      WHERE r.work_id = ?
      ORDER BY t.name ASC`,
    )
    .bind(workId)
    .all<TagRow>();

  return rows.results ?? [];
}

async function listReleaseTags(releaseId: number): Promise<GameTag[]> {
  const rows = await getD1()
    .prepare(
      `SELECT t.slug, t.name, t.namespace
      FROM release_tags rt
      JOIN tags t ON t.id = rt.tag_id
      WHERE rt.release_id = ?
      ORDER BY t.name ASC`,
    )
    .bind(releaseId)
    .all<TagRow>();

  return (rows.results ?? []).map(mapTagRow);
}

async function listReleaseStaffForWork(workId: number): Promise<CreatorCreditRow[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        rs.release_id,
        c.slug,
        c.name,
        c.original_name,
        c.website_url,
        rs.role_key,
        rs.role_label
      FROM release_staff rs
      JOIN creators c ON c.id = rs.creator_id
      JOIN releases r ON r.id = rs.release_id
      WHERE r.work_id = ?
      ORDER BY rs.role_key ASC, c.name ASC`,
    )
    .bind(workId)
    .all<CreatorCreditRow>();

  return rows.results ?? [];
}

async function listReleaseExternalLinksForWork(workId: number): Promise<Array<ExternalLinkRow & { release_id: number }>> {
  const rows = await getD1()
    .prepare(
      `SELECT rel.release_id, rel.id, rel.label, rel.url, rel.link_type
      FROM release_external_links rel
      JOIN releases r ON r.id = rel.release_id
      WHERE r.work_id = ?
      ORDER BY rel.id ASC`,
    )
    .bind(workId)
    .all<ExternalLinkRow & { release_id: number }>();

  return rows.results ?? [];
}

async function listReleaseExternalLinks(releaseId: number): Promise<GameExternalLink[]> {
  const rows = await getD1()
    .prepare(
      `SELECT id, label, url, link_type
      FROM release_external_links
      WHERE release_id = ?
      ORDER BY id ASC`,
    )
    .bind(releaseId)
    .all<ExternalLinkRow>();

  return (rows.results ?? []).map(mapExternalLinkRow);
}

async function listArchiveVersionsForWork(workId: number): Promise<ArchiveVersionRow[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        av.release_id,
        av.id,
        av.archive_key,
        av.archive_label,
        av.archive_variant_label,
        av.language,
        av.is_proofread,
        av.is_image_edited,
        av.is_current,
        av.total_files,
        av.total_size_bytes,
        av.estimated_r2_get_count,
        av.published_at,
        u.display_name AS uploader_name
      FROM archive_versions av
      JOIN releases r ON r.id = av.release_id
      LEFT JOIN users u ON u.id = av.uploader_id
      WHERE r.work_id = ?
        AND r.status = 'published'
        AND av.status = 'published'
      ORDER BY
        av.is_current DESC,
        COALESCE(av.published_at, av.created_at) DESC,
        av.id DESC`,
    )
    .bind(workId)
    .all<ArchiveVersionRow>();

  return rows.results ?? [];
}

async function listArchiveVersionsForReleaseAdmin(
  releaseId: number,
): Promise<AdminReleaseArchiveVersion[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        av.id,
        av.archive_key,
        av.archive_label,
        av.archive_variant_label,
        av.language,
        av.is_proofread,
        av.is_image_edited,
        av.is_current,
        av.status,
        av.total_files,
        av.total_size_bytes,
        u.display_name AS uploader_name,
        av.published_at,
        av.deleted_at,
        av.purged_at
      FROM archive_versions av
      LEFT JOIN users u ON u.id = av.uploader_id
      WHERE av.release_id = ?
        AND av.status <> 'deleted'
      ORDER BY
        av.is_current DESC,
        COALESCE(av.published_at, av.created_at) DESC,
        av.id DESC`,
    )
    .bind(releaseId)
    .all<AdminReleaseArchiveVersionRow>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    archiveKey: row.archive_key,
    archiveLabel: row.archive_label,
    archiveVariantLabel: row.archive_variant_label,
    language: row.language,
    isProofread: row.is_proofread === 1,
    isImageEdited: row.is_image_edited === 1,
    isCurrent: row.is_current === 1,
    status: row.status,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
    uploaderName: row.uploader_name,
    publishedAt: row.published_at,
    deletedAt: row.deleted_at,
    purgedAt: row.purged_at,
  }));
}

async function listWorkRelations(workId: number): Promise<GameWorkRelation[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        'from' AS direction,
        wr.relation_type,
        wr.notes,
        target.id AS work_id,
        target.slug,
        COALESCE(target.chinese_title, target.original_title) AS title
      FROM work_relations wr
      JOIN works target ON target.id = wr.to_work_id
      WHERE wr.from_work_id = ?
        AND target.status = 'published'
      UNION ALL
      SELECT
        'to' AS direction,
        wr.relation_type,
        wr.notes,
        source.id AS work_id,
        source.slug,
        COALESCE(source.chinese_title, source.original_title) AS title
      FROM work_relations wr
      JOIN works source ON source.id = wr.from_work_id
      WHERE wr.to_work_id = ?
        AND source.status = 'published'
      ORDER BY relation_type ASC, title ASC`,
    )
    .bind(workId, workId)
    .all<RelationRow>();

  return (rows.results ?? []).map((row) => ({
    direction: row.direction,
    relationType: row.relation_type,
    notes: row.notes,
    workId: row.work_id,
    slug: row.slug,
    title: row.title,
  }));
}

async function listWorkSeries(workId: number): Promise<GameSeriesMembership[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        s.id AS series_id,
        s.slug,
        s.title,
        ws.position_number,
        ws.position_label,
        ws.relation_kind
      FROM work_series ws
      JOIN series s ON s.id = ws.series_id
      WHERE ws.work_id = ?
        AND s.status = 'published'
      ORDER BY ws.position_number ASC, ws.position_label ASC`,
    )
    .bind(workId)
    .all<SeriesRow>();

  return (rows.results ?? []).map((row) => ({
    seriesId: row.series_id,
    slug: row.slug,
    title: row.title,
    positionNumber: row.position_number,
    positionLabel: row.position_label,
    relationKind: row.relation_kind,
  }));
}

async function listWorkSeriesAdmin(workId: number): Promise<GameSeriesMembership[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        s.id AS series_id,
        s.slug,
        s.title,
        ws.position_number,
        ws.position_label,
        ws.relation_kind
      FROM work_series ws
      JOIN series s ON s.id = ws.series_id
      WHERE ws.work_id = ?
        AND s.status <> 'deleted'
      ORDER BY ws.position_number ASC, ws.position_label ASC`,
    )
    .bind(workId)
    .all<SeriesRow>();

  return (rows.results ?? []).map((row) => ({
    seriesId: row.series_id,
    slug: row.slug,
    title: row.title,
    positionNumber: row.position_number,
    positionLabel: row.position_label,
    relationKind: row.relation_kind,
  }));
}

async function listWorkOutgoingRelationsAdmin(workId: number): Promise<GameWorkRelation[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        'from' AS direction,
        wr.relation_type,
        wr.notes,
        target.id AS work_id,
        target.slug,
        COALESCE(target.chinese_title, target.original_title) AS title
      FROM work_relations wr
      JOIN works target ON target.id = wr.to_work_id
      WHERE wr.from_work_id = ?
        AND target.status <> 'deleted'
      ORDER BY wr.relation_type ASC, title ASC`,
    )
    .bind(workId)
    .all<RelationRow>();

  return (rows.results ?? []).map((row) => ({
    direction: row.direction,
    relationType: row.relation_type,
    notes: row.notes,
    workId: row.work_id,
    slug: row.slug,
    title: row.title,
  }));
}

async function replaceAliases(workId: number, aliases: string[]): Promise<void> {
  await getD1().prepare(`DELETE FROM work_titles WHERE work_id = ?`).bind(workId).run();

  for (const alias of uniqueClean(aliases)) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO work_titles (
          work_id,
          title,
          language,
          title_type,
          is_searchable
        ) VALUES (?, ?, NULL, 'alias', 1)`,
      )
      .bind(workId, alias)
      .run();
  }
}

async function replaceWorkTags(workId: number, tags: string[]): Promise<void> {
  await getD1().prepare(`DELETE FROM work_tags WHERE work_id = ?`).bind(workId).run();

  for (const tag of uniqueClean(tags)) {
    const slug = tagSlug(tag);
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO tags (slug, name, namespace)
        VALUES (?, ?, 'other')`,
      )
      .bind(slug, tag)
      .run();
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO work_tags (work_id, tag_id, source)
        VALUES (?, (SELECT id FROM tags WHERE slug = ?), 'admin')`,
      )
      .bind(workId, slug)
      .run();
  }
}

async function replaceWorkCharacters(
  workId: number,
  characters: AdminWorkCharacterInput[],
): Promise<void> {
  await getD1().prepare(`DELETE FROM work_characters WHERE work_id = ?`).bind(workId).run();

  const cleaned = dedupeBy(characters.filter((character) => character.name.trim()), (item) =>
    characterSlug(item.name),
  );

  for (const [index, character] of cleaned.entries()) {
    const slug = characterSlug(character.name);
    assertEnum(character.roleKey, ["main", "supporting", "cameo", "mentioned", "other"], "角色职务");
    await getD1()
      .prepare(
        `INSERT INTO characters (slug, primary_name, extra_json)
        VALUES (?, ?, '{}')
        ON CONFLICT(slug) DO UPDATE SET
          primary_name = excluded.primary_name,
          updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(slug, character.name.trim())
      .run();
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO work_characters (
          work_id,
          character_id,
          role_key,
          spoiler_level,
          sort_order,
          notes
        ) VALUES (?, (SELECT id FROM characters WHERE slug = ?), ?, ?, ?, ?)`,
      )
      .bind(
        workId,
        slug,
        character.roleKey,
        character.spoilerLevel,
        character.sortOrder ?? index + 1,
        character.notes,
      )
      .run();
  }
}

async function replaceWorkMediaAssets(
  workId: number,
  previewBlobSha256s: string[],
): Promise<void> {
  await getD1()
    .prepare(
      `DELETE FROM work_media_assets
      WHERE work_id = ?
        AND media_asset_id IN (
          SELECT id FROM media_assets WHERE kind = 'preview'
        )`,
    )
    .bind(workId)
    .run();

  for (const [index, rawSha256] of uniqueClean(previewBlobSha256s).entries()) {
    const sha256 = rawSha256.toLowerCase();
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO media_assets (blob_sha256, kind)
        VALUES (?, 'preview')`,
      )
      .bind(sha256)
      .run();
    await getD1()
      .prepare(
        `INSERT OR REPLACE INTO work_media_assets (
          work_id,
          media_asset_id,
          sort_order,
          is_primary
        ) VALUES (?, (SELECT id FROM media_assets WHERE blob_sha256 = ? AND kind = 'preview'), ?, ?)`,
      )
      .bind(workId, sha256, index + 1, index === 0 ? 1 : 0)
      .run();
  }
}

async function replaceWorkSeries(
  workId: number,
  memberships: AdminWorkSeriesInput[],
): Promise<void> {
  await getD1().prepare(`DELETE FROM work_series WHERE work_id = ?`).bind(workId).run();

  for (const membership of memberships.filter((item) => item.slug && item.title)) {
    assertEnum(
      membership.relationKind,
      ["main", "side", "collection_member", "same_setting", "other"],
      "系列关系",
    );
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO series (slug, title, status, extra_json, updated_at)
        VALUES (?, ?, 'published', '{}', CURRENT_TIMESTAMP)`,
      )
      .bind(membership.slug, membership.title)
      .run();
    await getD1()
      .prepare(
        `UPDATE series
        SET title = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE slug = ?`,
      )
      .bind(membership.title, membership.slug)
      .run();
    await getD1()
      .prepare(
        `INSERT OR REPLACE INTO work_series (
          series_id,
          work_id,
          position_number,
          position_label,
          relation_kind,
          notes
        ) VALUES (
          (SELECT id FROM series WHERE slug = ?),
          ?,
          ?,
          ?,
          ?,
          ?
        )`,
      )
      .bind(
        membership.slug,
        workId,
        membership.positionNumber,
        membership.positionLabel,
        membership.relationKind,
        membership.notes,
      )
      .run();
  }
}

async function replaceWorkOutgoingRelations(
  workId: number,
  relations: AdminWorkRelationInput[],
): Promise<void> {
  await getD1().prepare(`DELETE FROM work_relations WHERE from_work_id = ?`).bind(workId).run();

  for (const relation of relations.filter((item) => item.targetSlug.trim())) {
    assertEnum(
      relation.relationType,
      [
        "prequel",
        "sequel",
        "side_story",
        "same_setting",
        "remake",
        "remaster",
        "fan_disc",
        "alternate_version",
        "translation_source",
        "inspired_by",
        "other",
      ],
      "作品关系",
    );
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO work_relations (
          from_work_id,
          to_work_id,
          relation_type,
          notes
        )
        SELECT
          ?,
          id,
          ?,
          ?
        FROM works
        WHERE slug = ?
          AND status <> 'deleted'`,
      )
      .bind(workId, relation.relationType, relation.notes, relation.targetSlug)
      .run();
  }
}

async function replaceReleaseTags(releaseId: number, tags: string[]): Promise<void> {
  await getD1().prepare(`DELETE FROM release_tags WHERE release_id = ?`).bind(releaseId).run();

  for (const tag of uniqueClean(tags)) {
    const slug = tagSlug(tag);
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO tags (slug, name, namespace)
        VALUES (?, ?, 'other')`,
      )
      .bind(slug, tag)
      .run();
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO release_tags (release_id, tag_id, source)
        VALUES (?, (SELECT id FROM tags WHERE slug = ?), 'admin')`,
      )
      .bind(releaseId, slug)
      .run();
  }
}

async function replaceWorkExternalLinks(
  workId: number,
  links: Array<{ label: string; url: string; linkType: string }>,
): Promise<void> {
  await getD1().prepare(`DELETE FROM work_external_links WHERE work_id = ?`).bind(workId).run();

  for (const link of links) {
    if (!link.label.trim() || !link.url.trim()) {
      continue;
    }

    assertEnum(
      link.linkType,
      ["official", "wiki", "source", "video", "download_page", "other"],
      "外部链接类型",
    );
    await getD1()
      .prepare(
        `INSERT INTO work_external_links (work_id, label, url, link_type)
        VALUES (?, ?, ?, ?)`,
      )
      .bind(workId, link.label.trim(), link.url.trim(), link.linkType)
      .run();
  }
}

async function replaceReleaseExternalLinks(
  releaseId: number,
  links: Array<{ label: string; url: string; linkType: string }>,
): Promise<void> {
  await getD1()
    .prepare(`DELETE FROM release_external_links WHERE release_id = ?`)
    .bind(releaseId)
    .run();

  for (const link of links) {
    if (!link.label.trim() || !link.url.trim()) {
      continue;
    }

    assertEnum(
      link.linkType,
      ["official", "source", "download_page", "patch_note", "other"],
      "Release 外部链接类型",
    );
    await getD1()
      .prepare(
        `INSERT INTO release_external_links (release_id, label, url, link_type)
        VALUES (?, ?, ?, ?)`,
      )
      .bind(releaseId, link.label.trim(), link.url.trim(), link.linkType)
      .run();
  }
}

async function ensureCurrentArchiveVersionForAdmin(
  releaseId: number,
  archiveKey: string,
): Promise<void> {
  const current = await getD1()
    .prepare(
      `SELECT id
      FROM archive_versions
      WHERE release_id = ?
        AND archive_key = ?
        AND status = 'published'
        AND is_current = 1
      LIMIT 1`,
    )
    .bind(releaseId, archiveKey)
    .first<{ id: number }>();

  if (current) {
    return;
  }

  const replacement = await getD1()
    .prepare(
      `SELECT id
      FROM archive_versions
      WHERE release_id = ?
        AND archive_key = ?
        AND status = 'published'
      ORDER BY
        COALESCE(published_at, created_at) DESC,
        id DESC
      LIMIT 1`,
    )
    .bind(releaseId, archiveKey)
    .first<{ id: number }>();

  if (!replacement) {
    return;
  }

  await getD1()
    .prepare(
      `UPDATE archive_versions
      SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END
      WHERE release_id = ?
        AND archive_key = ?
        AND status = 'published'`,
    )
    .bind(replacement.id, releaseId, archiveKey)
    .run();
}

function mapTagRow(row: TagRow): GameTag {
  return {
    slug: row.slug,
    name: row.name,
    namespace: row.namespace,
  };
}

function mapCharacterRow(row: CharacterRow): GameCharacter {
  return {
    slug: row.slug,
    primaryName: row.primary_name,
    originalName: row.original_name,
    roleKey: row.role_key,
    spoilerLevel: row.spoiler_level,
    sortOrder: row.sort_order,
    notes: row.notes,
  };
}

function mapCreatorCreditRow(row: CreatorCreditRow): GameCreatorCredit {
  return {
    slug: row.slug,
    name: row.name,
    originalName: row.original_name,
    websiteUrl: row.website_url,
    roleKey: row.role_key,
    roleLabel: row.role_label,
  };
}

function mapExternalLinkRow(row: ExternalLinkRow): GameExternalLink {
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    linkType: row.link_type,
  };
}

function mapArchiveVersionRow(row: ArchiveVersionRow): GameArchiveVersionDetail {
  return {
    id: row.id,
    archiveKey: row.archive_key,
    archiveLabel: row.archive_label,
    archiveVariantLabel: row.archive_variant_label,
    language: row.language,
    isProofread: row.is_proofread === 1,
    isImageEdited: row.is_image_edited === 1,
    isCurrent: row.is_current === 1,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
    estimatedR2GetCount: row.estimated_r2_get_count,
    publishedAt: row.published_at,
    uploaderName: row.uploader_name,
  };
}

function mapAdminArchiveVersionEditRow(
  row: AdminArchiveVersionEditRow,
): AdminArchiveVersionEdit {
  return {
    id: row.id,
    releaseId: row.release_id,
    workId: row.work_id,
    workSlug: row.work_slug,
    workTitle: row.work_title,
    releaseLabel: row.release_label,
    archiveKey: row.archive_key,
    archiveLabel: row.archive_label,
    archiveVariantLabel: row.archive_variant_label,
    language: row.language,
    isProofread: row.is_proofread === 1,
    isImageEdited: row.is_image_edited === 1,
    isCurrent: row.is_current === 1,
    status: row.status,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
    estimatedR2GetCount: row.estimated_r2_get_count,
    manifestSha256: row.manifest_sha256,
    manifestR2Key: row.manifest_r2_key,
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
  };
}

function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string,
): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = keyFn(item);
    groups[key] = groups[key] ?? [];
    groups[key].push(item);
    return groups;
  }, {});
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function cleanNullable(value: string | null | undefined): string | null {
  const cleaned = value?.trim() ?? "";

  return cleaned || null;
}

function uniqueClean(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function dedupeBy<T>(values: T[], keyFn: (value: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const value of values) {
    const key = keyFn(value);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(value);
  }

  return output;
}

function tagSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .replace(/^-+|-+$/g, "")
    || "tag";
}

function characterSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .replace(/^-+|-+$/g, "")
    || "character";
}

function decodeRouteSlug(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function assertEnum(value: string, allowed: string[], label: string): void {
  if (!allowed.includes(value)) {
    throw new Error(`${label} 不合法`);
  }
}

function assertRequired(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} 不能为空`);
  }
}

export function parseWorkEditForm(formData: FormData): Parameters<typeof updateWorkForAdmin>[0] {
  const workId = Number.parseInt(String(formData.get("work_id") ?? ""), 10);

  if (!Number.isSafeInteger(workId) || workId <= 0) {
    throw new Error("Invalid work id");
  }

  return {
    workId,
    chineseTitle: cleanNullable(String(formData.get("chinese_title") ?? "")),
    sortTitle: cleanNullable(String(formData.get("sort_title") ?? "")),
    description: cleanNullable(String(formData.get("description") ?? "")),
    originalReleaseDate: cleanNullable(String(formData.get("original_release_date") ?? "")),
    originalReleasePrecision: String(formData.get("original_release_precision") ?? "unknown"),
    engineFamily: String(formData.get("engine_family") ?? "unknown"),
    engineDetail: cleanNullable(String(formData.get("engine_detail") ?? "")),
    usesManiacsPatch: formData.get("uses_maniacs_patch") === "1",
    status: String(formData.get("status") ?? "published"),
    iconBlobSha256: cleanNullable(String(formData.get("icon_blob_sha256") ?? "")),
    thumbnailBlobSha256: cleanNullable(String(formData.get("thumbnail_blob_sha256") ?? "")),
    aliases: splitLines(String(formData.get("aliases") ?? "")),
    tags: splitTagText(String(formData.get("tags") ?? "")),
    characters: parseWorkCharacters(String(formData.get("characters") ?? "")),
    previewBlobSha256s: splitLines(String(formData.get("preview_blob_sha256s") ?? "")),
    seriesMemberships: parseWorkSeriesMemberships(String(formData.get("series_memberships") ?? "")),
    outgoingRelations: parseWorkRelations(String(formData.get("outgoing_relations") ?? "")),
    externalLinks: parseExternalLinks(String(formData.get("external_links") ?? "")),
  };
}

export function parseReleaseEditForm(
  formData: FormData,
): Parameters<typeof updateReleaseForAdmin>[0] {
  const releaseId = Number.parseInt(String(formData.get("release_id") ?? ""), 10);

  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
    throw new Error("Invalid release id");
  }

  return {
    releaseId,
    label: String(formData.get("release_label") ?? "").trim(),
    baseVariant: String(formData.get("base_variant") ?? "original"),
    variantLabel: String(formData.get("variant_label") ?? "").trim(),
    type: String(formData.get("release_type") ?? "other"),
    releaseDate: cleanNullable(String(formData.get("release_date") ?? "")),
    releaseDatePrecision: String(formData.get("release_date_precision") ?? "unknown"),
    sourceName: cleanNullable(String(formData.get("source_name") ?? "")),
    sourceUrl: cleanNullable(String(formData.get("source_url") ?? "")),
    executablePath: cleanNullable(String(formData.get("executable_path") ?? "")),
    rightsNotes: cleanNullable(String(formData.get("rights_notes") ?? "")),
    status: String(formData.get("status") ?? "published"),
    tags: splitTagText(String(formData.get("tags") ?? "")),
    externalLinks: parseExternalLinks(String(formData.get("external_links") ?? "")),
  };
}

export function parseArchiveVersionEditForm(
  formData: FormData,
): Parameters<typeof updateArchiveVersionForAdmin>[0] {
  const archiveVersionId = Number.parseInt(
    String(formData.get("archive_version_id") ?? ""),
    10,
  );

  if (!Number.isSafeInteger(archiveVersionId) || archiveVersionId <= 0) {
    throw new Error("Invalid archive version id");
  }

  return {
    archiveVersionId,
    archiveLabel: String(formData.get("archive_label") ?? "").trim(),
    archiveVariantLabel: String(formData.get("archive_variant_label") ?? "").trim(),
    language: String(formData.get("language") ?? "").trim(),
    isProofread: formData.get("is_proofread") === "1",
    isImageEdited: formData.get("is_image_edited") === "1",
    status: String(formData.get("status") ?? "published"),
  };
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitTagText(value: string): string[] {
  return value
    .split(/[,，\r\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseWorkCharacters(value: string): AdminWorkCharacterInput[] {
  return splitLines(value).map((line, index) => {
    const [name = "", roleKey = "supporting", sortOrder = "", notes = ""] = line
      .split("|")
      .map((part) => part.trim());

    return {
      name,
      roleKey: roleKey || "supporting",
      spoilerLevel: 0,
      sortOrder: numberOrNull(sortOrder) ?? index + 1,
      notes: cleanNullable(notes),
    };
  });
}

function parseWorkSeriesMemberships(value: string): AdminWorkSeriesInput[] {
  return splitLines(value).map((line) => {
    const [
      slug = "",
      title = "",
      positionNumber = "",
      positionLabel = "",
      relationKind = "main",
      notes = "",
    ] = line.split("|").map((part) => part.trim());

    return {
      slug,
      title,
      positionNumber: numberOrNull(positionNumber),
      positionLabel: cleanNullable(positionLabel),
      relationKind: relationKind || "main",
      notes: cleanNullable(notes),
    };
  });
}

function parseWorkRelations(value: string): AdminWorkRelationInput[] {
  return splitLines(value).map((line) => {
    const [targetSlug = "", relationType = "other", notes = ""] = line
      .split("|")
      .map((part) => part.trim());

    return {
      targetSlug,
      relationType: relationType || "other",
      notes: cleanNullable(notes),
    };
  });
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function parseExternalLinks(value: string): Array<{
  label: string;
  url: string;
  linkType: string;
}> {
  return splitLines(value).map((line) => {
    const [label = "", url = "", linkType = "other"] = line.split("|").map((part) => part.trim());

    return {
      label,
      url,
      linkType: linkType || "other",
    };
  });
}
