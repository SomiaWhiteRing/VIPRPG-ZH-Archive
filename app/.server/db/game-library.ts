import { normalizeWorkMedia, validateWorkMedia, workMediaStatements, workTagStatements } from "@/app/.server/db/work-metadata";
import { ensureCurrentArchiveVersion } from "@/app/.server/db/archive-maintenance";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import type { CharacterPortraitRow } from "@/app/.server/db/character-portrait-library";
import {
  CHARACTER_PORTRAIT_COLUMNS,
  mapCharacterPortrait,
  WORK_CHARACTER_PORTRAIT_JOINS,
} from "@/app/.server/db/character-portrait-library";
import {
  parseCharacterCreditSelection,
  parseCharacterSelectionsJson,
  prepareWorkCharacterStatements,
} from "@/app/.server/db/characters";
import { chunkArray } from "@/app/.server/db/chunks";
import {
  parseWorkStaffJson,
  prepareWorkStaffStatements,
} from "@/app/.server/db/creators";
import { getD1 } from "@/app/.server/db/d1";
import { assertTranslationLanguageChangeAllowed } from "@/app/.server/db/relations";
import {
  assertSingleDownloadLink,
  assertStableDistribution,
  deriveWorkDistribution,
} from "@/app/.server/db/work-distribution";
import { isHttpUrl, normalizeHttpUrl } from "@/app/.server/http/safe-url";
import {
  parseWorkMoreInfo,
  parseWorkMoreInfoJson,
} from "@/app/.server/http/work-more-info";
import type { AppRuntime } from "@/app/.server/runtime";
import { hasPermission } from "@/lib/authz/permissions";
import type {
  CharacterCreditSelection,
  CharacterPortraitChoice,
} from "@/lib/character-names";
import { isCharacterRoleKey } from "@/lib/character-names";
import type { CreatorSelection } from "@/lib/creator-names";
import { parseCreatorLinks } from "@/lib/creator-links";
import { creatorSelectionKey } from "@/lib/creator-names";
import type {
  AdminArchiveVersionEdit,
  AdminWorkEdit,
  ExternalWorkInput,
  GameArchiveVersionDetail,
  GameCharacter,
  GameCreatorCredit,
  GameExternalLink,
  GameMediaAsset,
  GameTag,
  GameTranslationRelation,
  GameWorkDetail,
  GameWorkRelation,
  GameWorkSummary,
  PaginatedGameSearch,
  UploaderWorkEdit,
  UploaderWorkUpdateInput,
  UserWorkListItem,
} from "@/lib/dto/db/game-library";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { normalizeEntityName } from "@/lib/entity-name";
import { HttpError } from "@/lib/http";
import {
  isArchiveEngineFamily,
  isExternalEngineFamily,
  isLanguageCode,
} from "@/lib/labels";
import {
  ORIGINAL_RELEASE_DATE_FORMAT_ERROR,
  ORIGINAL_RELEASE_DATE_REQUIRED_ERROR,
  parseOriginalReleaseDate,
} from "@/lib/original-release-date";
import type { StaffCredit } from "@/lib/staff-credits";
import type { WorkMoreInfo } from "@/lib/work-more-info";
import { normalizeWorkMoreInfo } from "@/lib/work-more-info";

type Filters = {
  query?: string;
  status?: string;
  engine?: string;
  tag?: number;
  character?: number;
  uploader?: number;
  isOriginal?: boolean;
  language?: string;
  includeNonPublic?: boolean;
  includeDeleted?: boolean;
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
  cover_blob_sha256: string | null;
  current_archive_version_id: number | null;
  external_download_url: string | null;
  archive_version_count: number;
  total_size_bytes: number | null;
  latest_published_at: string | null;
  download_link_count: number;
};
type WorkRow = {
  extra_json: string;
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
  usesUnsupportedManiac: boolean;
  moreInfo: WorkMoreInfo[];
  workId: number;
  chineseTitle: string | null;
  description: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  isOriginal: boolean;
  isTranslation: boolean;
  workStaff: StaffCredit[];
  language: string;
  status: string;
  aliases: string[];
  tags: string[];
  characters: CharacterCreditSelection[];
  coverBlobSha256: string;
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
  runtime: AppRuntime,
  input: ListInput = {},
): Promise<GameWorkSummary[]> {
  const rows = await gameWorksListStatement(
    getD1(runtime),
    input,
  ).all<SummaryRow>();
  return hydrate(runtime, rows.results ?? []);
}

export async function searchUserWorks(
  runtime: AppRuntime,
  input: {
    userId: number;
    kind: "favorite" | "played";
    page?: number;
    pageSize?: number;
  },
): Promise<{
  items: UserWorkListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const pageSize = clamp(input.pageSize ?? 20, 1, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const column = input.kind === "favorite" ? "favorited_at" : "last_played_at";
  const database = getD1(runtime);
  const [countResult, rowsResult] = await database.batch([
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM user_work_entries e JOIN works w ON w.id=e.work_id WHERE e.user_id=? AND e.${column} IS NOT NULL AND w.id IN (SELECT id FROM public_works)`,
      )
      .bind(input.userId),
    database
      .prepare(
        `SELECT ${summarySql()},e.${column} AS occurred_at FROM user_work_entries e JOIN works w ON w.id=e.work_id LEFT JOIN archive_versions av ON av.work_id=w.id AND av.status='published' AND av.is_current=1 WHERE e.user_id=? AND e.${column} IS NOT NULL AND w.id IN (SELECT id FROM public_works) GROUP BY w.id ORDER BY e.${column} DESC,w.id DESC LIMIT ? OFFSET ?`,
      )
      .bind(input.userId, pageSize, (page - 1) * pageSize),
  ]);
  const rows = (rowsResult.results ?? []) as Array<
    SummaryRow & { occurred_at: string }
  >;
  const works = await hydrate(runtime, rows);
  return {
    items: works.map((work, index) => ({
      work,
      occurredAt: rows[index].occurred_at,
    })),
    total: Number(
      (countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    page,
    pageSize,
  };
}

export async function searchUploadedWorks(
  runtime: AppRuntime,
  input: {
    userId: number;
    page?: number;
    pageSize?: number;
  },
): Promise<{
  items: GameWorkSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const pageSize = clamp(input.pageSize ?? 20, 1, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const database = getD1(runtime);
  const [countResult, rowsResult] = await database.batch([
    database
      .prepare(
        `SELECT COUNT(*) AS count
       FROM work_uploaders wu
       JOIN works w ON w.id=wu.work_id
       WHERE wu.user_id=? AND w.status<>'deleted'`,
      )
      .bind(input.userId),
    database
      .prepare(
        `SELECT ${summarySql()}
       FROM work_uploaders wu
       JOIN works w ON w.id=wu.work_id
       LEFT JOIN archive_versions av
         ON av.work_id=w.id AND av.status='published' AND av.is_current=1
       WHERE wu.user_id=? AND w.status<>'deleted'
       GROUP BY w.id
       ORDER BY datetime(w.updated_at) DESC,w.id DESC
       LIMIT ? OFFSET ?`,
      )
      .bind(input.userId, pageSize, (page - 1) * pageSize),
  ]);
  return {
    items: await hydrate(runtime, (rowsResult.results ?? []) as SummaryRow[]),
    total: Number(
      (countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    page,
    pageSize,
  };
}
export async function countGameWorks(
  runtime: AppRuntime,
  input: Filters = {},
): Promise<number> {
  const row = await gameWorksCountStatement(getD1(runtime), input).first<{
    count: number;
  }>();
  return row?.count ?? 0;
}

export async function searchGameWorks(
  runtime: AppRuntime,
  input: {
    query: string;
    page?: number;
    pageSize?: number;
  },
): Promise<PaginatedGameSearch> {
  const pageSize = clamp(input.pageSize ?? 24, 1, 100);
  const page = clamp(input.page ?? 1, 1, 9999);
  const filters = { query: input.query };
  const database = getD1(runtime);
  const [countResult, rowsResult] = await database.batch([
    gameWorksCountStatement(database, filters),
    gameWorksListStatement(database, {
      ...filters,
      sort: "relevance",
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);
  const total = Number(
    (countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0,
  );
  return {
    items: await hydrate(runtime, (rowsResult.results ?? []) as SummaryRow[]),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
export async function getGameWorkDetail(
  runtime: AppRuntime,
  id: number,
): Promise<GameWorkDetail | null> {
  const row = await getD1(runtime)
    .prepare(
      `SELECT ${summarySql()}, w.extra_json FROM works w LEFT JOIN archive_versions av ON av.work_id=w.id AND av.status='published' AND av.is_current=1 WHERE w.id=? AND w.id IN (SELECT id FROM public_works) GROUP BY w.id LIMIT 1`,
    )
    .bind(id)
    .first<SummaryRow & { extra_json: string }>();
  if (!row) return null;
  const collections = await loadWorkCollections(runtime, row.id);
  const summary = mapSummaryRow(
    row,
    collections.tags,
    collections.characters,
    collections.creators,
  );
  const originalId =
    collections.translations.find((item) => item.role === "original")?.workId ??
    (collections.translations.some((item) => item.role === "translation")
      ? row.id
      : null);
  return {
    ...summary,
    moreInfo: normalizeWorkMoreInfo(JSON.parse(row.extra_json).moreInfo),
    usesUnsupportedManiac:
      row.engine_family === "rpg_maker_2003_maniac" &&
      JSON.parse(row.extra_json).usesUnsupportedManiac === true,
    aliases: collections.aliases,
    media: collections.media,
    externalLinks: collections.links,
    archiveVersions: collections.archives,
    relations: collections.relations,
    translations: collections.translations,
    parallelTranslations: originalId
      ? await listTranslations(runtime, originalId)
      : [],
  };
}
export async function searchEditableWorksForAdmin(
  runtime: AppRuntime,
  input: {
    query?: string;
    status?: string;
    sort?: "id" | "title" | "release";
    page?: number;
    pageSize?: number;
  },
): Promise<PaginatedGameSearch> {
  const pageSize = clamp(input.pageSize ?? 50, 1, 100);
  const page = clamp(input.page ?? 1, 1, 9999);
  const filters = {
    query: input.query,
    status: input.status,
    includeNonPublic: true,
    includeDeleted: true,
  };
  const database = getD1(runtime);
  const [countResult, rowsResult] = await database.batch([
    gameWorksCountStatement(database, filters),
    gameWorksListStatement(database, {
      ...filters,
      sort: input.sort,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);
  const total = Number(
    (countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0,
  );
  return {
    items: await hydrate(runtime, (rowsResult.results ?? []) as SummaryRow[]),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
export async function getWorkForAdminEdit(
  runtime: AppRuntime,
  workId: number,
): Promise<AdminWorkEdit | null> {
  const row = await getD1(runtime)
    .prepare(`SELECT w.* FROM works w WHERE w.id=? LIMIT 1`)
    .bind(workId)
    .first<WorkRow>();
  if (!row) return null;
  const collections = await loadWorkCollections(runtime, workId);
  const originalId =
    collections.translations.find((item) => item.role === "original")?.workId ??
    (collections.translations.some((item) => item.role === "translation")
      ? row.id
      : null);
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
    hasUsableDistribution: await hasUsableDistribution(runtime, workId),
    moreInfo: normalizeWorkMoreInfo(JSON.parse(row.extra_json).moreInfo),
    usesUnsupportedManiac:
      row.engine_family === "rpg_maker_2003_maniac" &&
      JSON.parse(row.extra_json).usesUnsupportedManiac === true,
    aliases: collections.aliases,
    creators: collections.creators,
    tags: collections.tags.map((item) => item.name),
    characters: collections.characters.map(characterSelectionFromGameCharacter),
    characterCredits: collections.characters,
    media: collections.media,
    outgoingRelations: collections.relations,
    translations: collections.translations,
    parallelTranslations: originalId
      ? await listTranslations(runtime, originalId)
      : [],
    externalLinks: collections.links,
  };
}

export async function isWorkUploader(
  runtime: AppRuntime,
  workId: number,
  userId: number,
): Promise<boolean> {
  return !!(await getD1(runtime)
    .prepare("SELECT 1 FROM work_uploaders WHERE work_id=? AND user_id=?")
    .bind(workId, userId)
    .first());
}

export async function getOwnedWorkForEdit(
  runtime: AppRuntime,
  workId: number,
  user: ArchiveUser,
): Promise<UploaderWorkEdit | null> {
  const owned = await getD1(runtime)
    .prepare(
      `SELECT
         av.id AS current_archive_id,
         av.source_name AS current_archive_source_name,
         av.source_file_count AS current_archive_source_file_count,
         av.source_size_bytes AS current_archive_source_size_bytes,
         av.source_url AS current_archive_source_url,
         av.published_at AS current_archive_published_at
       FROM work_uploaders wu
       JOIN works w ON w.id=wu.work_id
       LEFT JOIN archive_versions av
         ON av.work_id=w.id AND av.status='published' AND av.is_current=1
       WHERE wu.work_id=? AND wu.user_id=? AND w.status<>'deleted'
       LIMIT 1`,
    )
    .bind(workId, user.id)
    .first<{
      current_archive_id: number | null;
      current_archive_source_name: string | null;
      current_archive_source_file_count: number | null;
      current_archive_source_size_bytes: number | null;
      current_archive_published_at: string | null;
      current_archive_source_url: string | null;
    }>();
  if (!owned) return null;
  const work = await getWorkForAdminEdit(runtime, workId);
  if (!work || work.status === "processing" || work.status === "deleted")
    return null;
  const downloadLink = work.externalLinks.find(
    (link) => link.linkType === "download_page",
  );

  const hasCurrentArchive = owned.current_archive_id !== null;
  const distribution = deriveWorkDistribution({
    hasCurrentArchive,
    downloadLinkCount: work.externalLinks.filter((link) => link.linkType === "download_page").length,
  });

  return {
    ...work,
    distribution: distribution === "invalid" ? (isArchiveEngineFamily(work.engineFamily) ? "archive" : "external") : distribution,
    externalDownloadUrl: downloadLink?.url ?? null,
    hasCurrentArchive,
    currentArchive: hasCurrentArchive
      ? {
          id: owned.current_archive_id!,
          sourceName: owned.current_archive_source_name || "本站归档",
          sourceFileCount: owned.current_archive_source_file_count ?? 0,
          sourceSizeBytes: owned.current_archive_source_size_bytes ?? 0,
          publishedAt: owned.current_archive_published_at,
          sourceUrl: owned.current_archive_source_url,
        }
      : null,
  };
}

export async function updateOwnedWork(
  runtime: AppRuntime,
  input: UploaderWorkUpdateInput,
  before: UploaderWorkEdit,
): Promise<void> {
  if (before.id !== input.workId)
    throw new Error("Owned work snapshot does not match update target");
  const moreInfo = JSON.stringify(parseWorkMoreInfo(input.moreInfo));
  const originalTitle = input.originalTitle.trim();
  if (!originalTitle) throw new HttpError(400, "作品原名不能为空");
  assertPublicationDeclarations(input.isOriginal, input.isTranslation);
  if (!isLanguageCode(input.language)) throw new HttpError(400, "语言不合法");
  const releaseDate = parseOriginalReleaseDate(input.originalReleaseDate);
  if (!releaseDate)
    throw new HttpError(400, ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
  if (!releaseDate.value)
    throw new HttpError(400, ORIGINAL_RELEASE_DATE_REQUIRED_ERROR);
  if (!(["published", "hidden"] as const).includes(input.status)) {
    throw new HttpError(400, "作品状态不合法");
  }
  if (
    input.distribution === "archive" &&
    !isArchiveEngineFamily(input.engineFamily)
  ) {
    throw new HttpError(400, "本站归档作品必须使用 RPG Maker 2000/2003 系引擎");
  }
  if (
    input.distribution === "external" &&
    !isExternalEngineFamily(input.engineFamily)
  ) {
    throw new HttpError(400, "外链作品必须使用非 RPG Maker 2000/2003 系引擎");
  }

  await assertTranslationLanguageChangeAllowed(
    runtime,
    input.workId,
    input.language,
  );

  const aliases = uniqueText(input.aliases);
  const tags = uniqueText(input.tags.map(normalizeEntityName));
  const characters = input.characters.map(parseCharacterCreditSelection);
  const authors = uniqueCreatorSelections(input.authors);
  const existingTranslators = new Map(
    before.creators
      .filter((creator) => creator.roleKey === "translator")
      .map((creator) => [
        creatorSelectionKey(selectionFromCreator(creator)),
        creator,
      ]),
  );
  const translatorCredits: StaffCredit[] = input.translators.map(
    (selection) => {
      const existing = existingTranslators.get(creatorSelectionKey(selection));
      return {
        selection,
        roleKey: "translator",
        roleLabel: existing?.roleLabel ?? null,
        notes: existing?.notes ?? null,
      };
    },
  );
  if (input.isTranslation !== translatorCredits.length > 0)
    throw new HttpError(400, "翻译作品必须填写译者，非翻译作品不能填写译者。");
  const media = normalizeWorkMedia(input.coverBlobSha256, input.previewBlobSha256s);
  await validateWorkMedia(runtime, [media.coverBlobSha256, ...media.previewBlobSha256s]);
  const downloadUrl =
    input.distribution === "external"
      ? normalizeHttpUrl(input.downloadUrl, "外部下载地址")
      : null;
  if (input.distribution === "external" && !downloadUrl) {
    throw new HttpError(400, "外部下载地址不能为空");
  }

  assertStableDistribution({
    status: input.status,
    engineFamily: input.engineFamily,
    hasCurrentArchive: input.distribution === "archive" && before.hasCurrentArchive,
    allowMissing: input.status === "hidden" || input.status === before.status,
    downloadLinkCount: downloadUrl ? 1 : 0,
  });

  const database = getD1(runtime);
  const existingCharacters = groupCharactersByIdentity(before.characterCredits);
  const characterCredits = characters.map((credit, index) => {
    const existing = takeExistingCharacter(existingCharacters, credit);
    return {
      ...credit,
      spoilerLevel: existing?.spoilerLevel ?? 0,
      sortOrder: index + 1,
      notes: existing?.notes ?? null,
    };
  });
  const existingAuthors = new Map(
    before.creators
      .filter((creator) => creator.roleKey === "author")
      .map((creator) => [
        creatorSelectionKey(selectionFromCreator(creator)),
        creator,
      ]),
  );
  const authorCredits = authors.map((selection) => {
    const existing = existingAuthors.get(creatorSelectionKey(selection));
    return {
      selection,
      roleKey: "author" as const,
      roleLabel: existing?.roleLabel ?? "作者",
      notes: existing?.notes ?? null,
    };
  });
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `UPDATE works
         SET original_title=?,chinese_title=?,description=?,extra_json=json_set(extra_json,'$.moreInfo',json(?),'$.usesUnsupportedManiac',json(?)),original_release_date=?,
           original_release_precision=?,engine_family=?,
           is_original=?,is_translation=?,language=?,status=?,updated_at=CURRENT_TIMESTAMP,
           published_at=CASE WHEN ?='published' THEN COALESCE(published_at,CURRENT_TIMESTAMP) ELSE published_at END
         WHERE id=? AND status<>'deleted'`,
      )
      .bind(
        originalTitle,
        input.chineseTitle?.trim() || null,
        input.description?.trim() || null,
        moreInfo,
        JSON.stringify(input.engineFamily === "rpg_maker_2003_maniac" && input.usesUnsupportedManiac === true),
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
    database
      .prepare(`DELETE FROM work_titles WHERE work_id=?`)
      .bind(input.workId),
    database
      .prepare(`DELETE FROM work_staff WHERE work_id=?`)
      .bind(input.workId),
    database
      .prepare(
        `DELETE FROM work_external_links WHERE work_id=? AND link_type='download_page'`,
      )
      .bind(input.workId),
  ];
  if (input.distribution === "external") {
    statements.push(
      database
        .prepare(`UPDATE archive_versions SET is_current=0 WHERE work_id=?`)
        .bind(input.workId),
    );
  }
  for (const title of aliases) {
    statements.push(
      database
        .prepare(
          `INSERT OR IGNORE INTO work_titles(work_id,title,title_type) VALUES(?,?,'alias')`,
        )
        .bind(input.workId, title),
    );
  }
  statements.push(...workTagStatements(database, input.workId, tags, "uploader"));
  statements.push(
    ...(await prepareWorkCharacterStatements({
      database,
      workId: input.workId,
      credits: characterCredits,
      source: "user",
      actorUserId: input.user.id,
    })),
  );
  statements.push(
    ...(await prepareWorkStaffStatements({
      database,
      workId: input.workId,
      submitter: { user: input.user, origin: runtime.origin },
      credits: [
        ...authorCredits,
        ...translatorCredits,
        ...(input.extraStaff ??
          before.creators
            .filter(
              (creator) =>
                creator.roleKey !== "author" &&
                creator.roleKey !== "translator",
            )
            .map((creator) => ({
              selection: selectionFromCreator(creator),
              roleKey: creator.roleKey as StaffCredit["roleKey"],
              roleLabel: creator.roleLabel,
              notes: creator.notes,
            }))),
      ],
    })),
  );
  statements.push(...workMediaStatements(database, input.workId, media.coverBlobSha256, media.previewBlobSha256s));
  if (downloadUrl) {
    statements.push(
      database
        .prepare(
          `INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(?,'外部下载',?,'download_page')`,
        )
        .bind(input.workId, downloadUrl),
    );
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json) VALUES(?,?,'uploader_work_update',?)`,
      )
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
  runtime: AppRuntime,
  input: WorkEditInput,
  actor: ArchiveUser,
): Promise<void> {
  if (!hasPermission(actor, "work.metadata.update_any")) {
    throw new HttpError(403, "没有编辑作品资料的权限");
  }
  const currentStatus = await getD1(runtime)
    .prepare(`SELECT status FROM works WHERE id=?`)
    .bind(input.workId)
    .first<{ status: string }>();
  if (!currentStatus) throw new HttpError(404, "作品不存在");
  const canUpdateStatus = hasPermission(actor, "work.status.update_any");
  if (currentStatus.status === "deleted" && !canUpdateStatus)
    throw new HttpError(403, "已删除作品须由有状态管理权限的账户恢复");
  if (
    input.status &&
    input.status !== currentStatus.status &&
    !canUpdateStatus
  ) {
    throw new HttpError(403, "没有调整作品状态的权限");
  }
  if (!canUpdateStatus) input.status = currentStatus.status;
  assertPublicationDeclarations(input.isOriginal, input.isTranslation);
  if (
    input.isTranslation !==
    input.workStaff.some((credit) => credit.roleKey === "translator")
  ) {
    throw new HttpError(400, "翻译作品必须填写译者，非翻译作品不能填写译者。");
  }
  const releaseDate = parseOriginalReleaseDate(input.originalReleaseDate);
  if (!releaseDate) throw new HttpError(400, ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
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
  assertEnum(
    input.status,
    ["processing", "published", "hidden", "deleted"],
    "状态",
  );
  if (input.status === "processing") {
    throw new HttpError(400, "processing 只能由上传提交流程创建");
  }
  if (!isLanguageCode(input.language)) throw new Error("语言不合法");
  const externalLinks = normalizeExternalLinks(input.externalLinks);
  const distributionState = await getWorkDistributionState(
    runtime,
    input.workId,
  );
  assertStableDistribution({
    status: input.status,
    engineFamily: input.engineFamily,
    hasCurrentArchive: distributionState.hasCurrentArchive,
    allowMissing: input.status === "hidden" || input.status === currentStatus.status,
    downloadLinkCount: externalLinks.filter(
      (link) => link.linkType === "download_page",
    ).length,
  });
  await assertTranslationLanguageChangeAllowed(
    runtime,
    input.workId,
    input.language,
  );
  const media = normalizeWorkMedia(input.coverBlobSha256, input.previewBlobSha256s, input.status === "published");
  await validateWorkMedia(runtime, [media.coverBlobSha256, ...media.previewBlobSha256s].filter(Boolean));
  const aliases = uniqueText(input.aliases);
  const tags = uniqueText(input.tags.map(normalizeEntityName));
  const characters = input.characters.map(parseCharacterCreditSelection);
  const current = await getWorkForAdminEdit(runtime, input.workId);
  if (!current) throw new HttpError(404, "作品不存在");
  const existingCharacters = groupCharactersByIdentity(
    current.characterCredits,
  );
  const characterCredits = characters.map((credit, index) => {
    const existing = takeExistingCharacter(existingCharacters, credit);
    return {
      ...credit,
      spoilerLevel: existing?.spoilerLevel ?? 0,
      sortOrder: index + 1,
      notes: existing?.notes ?? null,
    };
  });
  const moreInfo = JSON.stringify(parseWorkMoreInfo(input.moreInfo));
  const database = getD1(runtime);
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `UPDATE works
       SET chinese_title = ?,
         description = ?,
         extra_json = json_set(extra_json, '$.moreInfo', json(?), '$.usesUnsupportedManiac', json(?)),
         original_release_date = ?,
         original_release_precision = ?,
         engine_family = ?,
         is_original = ?,
         is_translation = ?,
         language = ?,
         ${canUpdateStatus ? "status = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE published_at END," : ""}
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      )
      .bind(
        input.chineseTitle,
        input.description,
        moreInfo,
        JSON.stringify(input.engineFamily === "rpg_maker_2003_maniac" && input.usesUnsupportedManiac === true),
        releaseDate.value,
        releaseDate.precision,
        input.engineFamily,
        input.isOriginal ? 1 : 0,
        input.isTranslation ? 1 : 0,
        input.language,
        ...(canUpdateStatus ? [input.status, input.status] : []),
        input.workId,
      ),
    database
      .prepare(`DELETE FROM work_staff WHERE work_id=?`)
      .bind(input.workId),
    ...(await prepareWorkStaffStatements({
      database,
      workId: input.workId,
      credits: input.workStaff,
    })),
    database
      .prepare(`DELETE FROM work_titles WHERE work_id=?`)
      .bind(input.workId),
    database
      .prepare(`DELETE FROM work_external_links WHERE work_id=?`)
      .bind(input.workId),
  ];
  for (const alias of aliases) {
    statements.push(
      database
        .prepare(
          `INSERT OR IGNORE INTO work_titles(work_id,title,title_type) VALUES(?,?,'alias')`,
        )
        .bind(input.workId, alias),
    );
  }
  statements.push(...workTagStatements(database, input.workId, tags, "admin"));
  statements.push(
    ...(await prepareWorkCharacterStatements({
      database,
      workId: input.workId,
      credits: characterCredits,
      source: "admin",
      actorUserId: actor.id,
    })),
  );
  statements.push(...workMediaStatements(database, input.workId, media.coverBlobSha256, media.previewBlobSha256s));
  for (const link of externalLinks) {
    statements.push(
      database
        .prepare(
          `INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(?,?,?,?)`,
        )
        .bind(input.workId, link.label, link.url, link.linkType),
    );
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
         VALUES(?,?,'admin_work_update',?)`,
      )
      .bind(
        actor.id,
        actor.email,
        JSON.stringify({ workId: input.workId, status: input.status }),
      ),
  );
  await database.batch(statements);
}

export async function createExternalWork(
  runtime: AppRuntime,
  input: ExternalWorkInput,
): Promise<{ workId: number }> {
  const moreInfo = parseWorkMoreInfo(input.moreInfo);
  if (!isExternalEngineFamily(input.engineFamily)) {
    throw new HttpError(
      400,
      "外链下载作品必须使用非 RPG Maker 2000/2003 系引擎",
    );
  }
  const originalTitle = input.originalTitle.trim();
  if (!originalTitle) throw new HttpError(400, "作品原名不能为空");
  assertPublicationDeclarations(input.isOriginal, input.isTranslation);
  const releaseDate = parseOriginalReleaseDate(input.originalReleaseDate);
  if (!releaseDate)
    throw new HttpError(400, ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
  if (!releaseDate.value)
    throw new HttpError(400, ORIGINAL_RELEASE_DATE_REQUIRED_ERROR);
  if (!isLanguageCode(input.language)) throw new HttpError(400, "语言不合法");
  const downloadUrl = normalizeHttpUrl(input.downloadUrl, "外部下载地址");
  if (!downloadUrl) throw new HttpError(400, "外部下载地址不能为空");

  const media = normalizeWorkMedia(input.coverBlobSha256, input.previewBlobSha256s);
  await validateWorkMedia(runtime, [media.coverBlobSha256, ...media.previewBlobSha256s]);

  const aliases = [
    ...new Set(input.aliases.map((value) => value.trim()).filter(Boolean)),
  ];
  const tags = [
    ...new Set(input.tags.map(normalizeEntityName).filter(Boolean)),
  ];
  const characters = input.characters.map(parseCharacterCreditSelection);
  const authors = input.authors;
  const translatorCredits: StaffCredit[] = input.translators.map(
    (selection) => ({
      selection,
      roleKey: "translator",
      roleLabel: null,
      notes: null,
    }),
  );
  if (input.isTranslation !== translatorCredits.length > 0)
    throw new HttpError(400, "翻译作品必须填写译者，非翻译作品不能填写译者。");
  const staffCredits = [
    ...translatorCredits,
    ...(input.extraStaff ?? []),
    ...authors.map((selection) => ({
      selection,
      roleKey: "author" as const,
      roleLabel: "作者",
      notes: null,
    })),
  ];
  const database = getD1(runtime);
  const result = await database
    .prepare(
      `INSERT INTO works (
        original_title, chinese_title, description, is_original, is_translation, language,
        original_release_date, original_release_precision, engine_family, status,
        extra_json, created_by_user_id, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, CURRENT_TIMESTAMP)`,
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
      JSON.stringify({ moreInfo }),
      input.user.id,
    )
    .run();
  const workId = result.meta.last_row_id;
  if (!Number.isSafeInteger(workId)) throw new Error("外链作品创建失败");

  try {
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
      ...(await prepareWorkStaffStatements({
        database,
        workId: workId as number,
        credits: staffCredits,
        submitter: { user: input.user, origin: runtime.origin },
      })),
      ...(await prepareWorkCharacterStatements({
        database,
        workId: workId as number,
        credits: characters.map((credit, index) => ({
          ...credit,
          spoilerLevel: 0,
          sortOrder: index + 1,
          notes: null,
        })),
        source: "user",
        actorUserId: input.user.id,
        requirePortrait: true,
      })),
      ...workTagStatements(database, workId, tags, "uploader"),
      database
        .prepare(
          `INSERT INTO work_external_links(work_id,label,url,link_type) VALUES(?, '外部下载', ?, 'download_page')`,
        )
        .bind(workId, downloadUrl),
      ...workMediaStatements(database, workId, media.coverBlobSha256, media.previewBlobSha256s),
    ];
    await database.batch(statements);
  } catch (error) {
    await database.prepare("DELETE FROM works WHERE id=?").bind(workId).run();
    throw error;
  }
  await writeAuthAuditLog(runtime, {
    userId: input.user.id,
    email: input.user.email,
    eventType: "external_work_created",
    detail: { workId: workId as number, engineFamily: input.engineFamily },
  });
  return { workId: workId as number };
}
export async function getArchiveVersionForAdminEdit(
  runtime: AppRuntime,
  id: number,
): Promise<AdminArchiveVersionEdit | null> {
  const row = await getD1(runtime)
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
  runtime: AppRuntime,
  input: ArchiveEditInput,
): Promise<AdminArchiveVersionEdit> {
  assertEnum(input.status, ["processing", "published", "hidden"], "状态");
  if (input.status === "processing") {
    throw new HttpError(400, "processing 只能由上传提交流程创建");
  }
  const before = await getD1(runtime)
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
  const update = getD1(runtime)
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
    await ensureCurrentArchiveVersion(runtime, before.work_id);
  const updated = await getArchiveVersionForAdminEdit(
    runtime,
    input.archiveVersionId,
  );
  if (!updated) throw new Error("归档更新后不可读取");
  return updated;
}
export function parseWorkEditForm(form: FormData): WorkEditInput {
  return {
    workId: positive(form.get("work_id")),
    chineseTitle: clean(form.get("chinese_title")),
    description: clean(form.get("description")),
    moreInfo: parseWorkMoreInfoJson(form.get("more_info")),
    originalReleaseDate: clean(form.get("original_release_date")),
    engineFamily: String(form.get("engine_family") ?? "other"),
    isOriginal: checked(form, "is_original"),
    isTranslation: checked(form, "is_translation"),
    usesUnsupportedManiac: checked(form, "uses_unsupported_maniac"),
    workStaff: parseWorkStaffJson(form.get("work_staff")),
    language: String(form.get("language") ?? "zh-CN"),
    status: String(form.get("status") ?? ""),
    aliases: lines(form.get("aliases")),
    tags: lines(form.get("tags")),
    characters: parseCharacterSelectionsJson(form.get("characters")),
    coverBlobSha256: String(form.get("cover_blob_sha256") ?? ""),
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
        AND wma.role='cover'
      ORDER BY wma.sort_order
      LIMIT 1
    ) AS cover_blob_sha256,
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
function gameWorksListStatement(
  database: D1Database,
  input: ListInput,
): D1PreparedStatement {
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

function gameWorksOrder(input: ListInput): {
  order: string;
  orderBinds: string[];
} {
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
    return {
      order: "COALESCE(w.chinese_title,w.original_title) ASC",
      orderBinds: [],
    };
  }
  if (input.sort === "release") {
    return {
      order: "w.original_release_date IS NULL ASC,w.original_release_date DESC",
      orderBinds: [],
    };
  }
  return { order: "w.id DESC", orderBinds: [] };
}

function gameWorksCountStatement(
  database: D1Database,
  input: Filters,
): D1PreparedStatement {
  const { where, binds } = buildWhere(input);
  return database
    .prepare(`SELECT COUNT(*) AS count FROM works w WHERE ${where}`)
    .bind(...binds);
}

function buildWhere(input: Filters): {
  where: string;
  binds: Array<string | number>;
} {
  const clauses = [
      input.includeNonPublic
        ? input.includeDeleted
          ? "1=1"
          : "w.status <> 'deleted'"
        : `w.id IN (SELECT id FROM public_works)`,
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
  if (input.uploader) {
    clauses.push(
      "(EXISTS(SELECT 1 FROM work_uploaders wu WHERE wu.work_id=w.id AND wu.user_id=?) OR EXISTS(SELECT 1 FROM archive_versions uploaded WHERE uploaded.work_id=w.id AND uploaded.uploader_id=? AND uploaded.status='published'))",
    );
    binds.push(input.uploader, input.uploader);
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

async function hydrate(
  runtime: AppRuntime,
  rows: SummaryRow[],
): Promise<GameWorkSummary[]> {
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((row) => row.id))];
  const database = getD1(runtime);
  const queries: Array<{
    kind: "tag" | "character" | "creator";
    statement: D1PreparedStatement;
  }> = [];
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
             ORDER BY wt.work_id,wt.sort_order,t.name`,
          )
          .bind(...chunk),
      },
      {
        kind: "character",
        statement: database
          .prepare(
            `SELECT wc.work_id,c.id,c.primary_name,c.original_name,wc.display_name,wc.role_key,wc.spoiler_level,wc.sort_order,wc.notes,
                    ${CHARACTER_PORTRAIT_COLUMNS},override_sheet.blob_sha256 AS override_blob_sha256,
                    override_ref.cell_row AS override_cell_row,override_ref.cell_column AS override_cell_column
             FROM work_characters wc JOIN characters c ON c.id=wc.character_id
             ${WORK_CHARACTER_PORTRAIT_JOINS}
             LEFT JOIN character_portrait_refs override_ref ON override_ref.id=wc.portrait_ref_id
             LEFT JOIN face_sheets override_sheet ON override_sheet.id=override_ref.face_sheet_id
             WHERE wc.work_id IN (${placeholders})
             ORDER BY wc.work_id,wc.sort_order,wc.id`,
          )
          .bind(...chunk),
      },
      {
        kind: "creator",
        statement: database
          .prepare(
            `SELECT ws.work_id,c.id,c.name,ws.display_name,c.links_json,ws.role_key,ws.role_label,ws.notes
             FROM work_staff ws JOIN creators c ON c.id=ws.creator_id
             WHERE ws.work_id IN (${placeholders})
             ORDER BY ws.work_id,ws.sort_order,c.name`,
          )
          .bind(...chunk),
      },
    );
  }
  const results = await database.batch(queries.map((query) => query.statement));
  const tagRows: Array<GameTag & { work_id: number }> = [];
  const characterRows: Array<
    CharacterPortraitRow & {
      work_id: number;
      id: number;
      primary_name: string;
      original_name: string;
      override_blob_sha256: string | null;
      override_cell_row: number | null;
      override_cell_column: number | null;
      display_name: string;
      role_key: string;
      spoiler_level: number;
      sort_order: number | null;
      notes: string | null;
    }
  > = [];
  const creatorRows: Array<{
    work_id: number;
    id: number;
    name: string;
    display_name: string;
    links_json: string;
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
  const tagsByWork = groupRowsByWork(tagRows, (tag) => ({
    id: tag.id,
    name: tag.name,
    namespace: tag.namespace,
  }));
  const charactersByWork = groupRowsByWork(characterRows, (character) => ({
    id: character.id,
    primaryName: character.primary_name,
    originalName: character.original_name,
    displayName: character.display_name,
    portrait: mapCharacterPortrait(character),
    portraitChoice: portraitChoiceFromRow(character),
    roleKey: character.role_key,
    spoilerLevel: character.spoiler_level,
    sortOrder: character.sort_order,
    notes: character.notes,
  }));
  const creatorsByWork = groupRowsByWork(creatorRows, (creator) => ({
    id: creator.id,
    name: creator.name,
    displayName: creator.display_name,
    links: parseCreatorLinks(creator.links_json),
    roleKey: creator.role_key,
    roleLabel: creator.role_label,
    notes: creator.notes,
  }));

  return rows.map((row) =>
    mapSummaryRow(
      row,
      tagsByWork.get(row.id) ?? [],
      charactersByWork.get(row.id) ?? [],
      creatorsByWork.get(row.id) ?? [],
    ),
  );
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
    coverBlobSha256: row.cover_blob_sha256,
    currentArchiveVersionId: row.current_archive_version_id,
    externalDownloadUrl: isHttpUrl(row.external_download_url)
      ? row.external_download_url
      : null,
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
  runtime: AppRuntime,
  workId: number,
): Promise<WorkCollections> {
  const database = getD1(runtime);
  const results = await database.batch([
    database
      .prepare(`SELECT title FROM work_titles WHERE work_id=? ORDER BY id`)
      .bind(workId),
    database
      .prepare(
        `SELECT t.id,t.name,t.namespace
         FROM work_tags wt JOIN tags t ON t.id=wt.tag_id
         WHERE wt.work_id=? ORDER BY wt.sort_order,t.name`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT c.id,c.primary_name,c.original_name,wc.display_name,wc.role_key,wc.spoiler_level,wc.sort_order,wc.notes,
                ${CHARACTER_PORTRAIT_COLUMNS},override_sheet.blob_sha256 AS override_blob_sha256,
                override_ref.cell_row AS override_cell_row,override_ref.cell_column AS override_cell_column
         FROM work_characters wc JOIN characters c ON c.id=wc.character_id
         ${WORK_CHARACTER_PORTRAIT_JOINS}
         LEFT JOIN character_portrait_refs override_ref ON override_ref.id=wc.portrait_ref_id
         LEFT JOIN face_sheets override_sheet ON override_sheet.id=override_ref.face_sheet_id
          WHERE wc.work_id=? ORDER BY wc.sort_order,wc.id`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT c.id,c.name,ws.display_name,c.links_json,ws.role_key,ws.role_label,ws.notes
         FROM work_staff ws JOIN creators c ON c.id=ws.creator_id
         WHERE ws.work_id=? ORDER BY ws.sort_order,c.name`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT ma.blob_sha256,wma.role,ma.title,ma.alt_text,wma.sort_order
         FROM work_media_assets wma JOIN media_assets ma ON ma.id=wma.media_asset_id
         WHERE wma.work_id=? ORDER BY (wma.role='cover') DESC,wma.sort_order,wma.media_asset_id`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT id,label,url,link_type FROM work_external_links WHERE work_id=? ORDER BY id`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT av.id,w.language,av.is_current,av.total_files,av.total_size_bytes,
                av.estimated_r2_get_count,av.published_at,av.uploader_id,u.display_name AS uploader_name
         FROM archive_versions av
         JOIN works w ON w.id=av.work_id
         LEFT JOIN users u ON u.id=av.uploader_id
         WHERE av.work_id=? AND av.status='published' AND av.is_current=1
         ORDER BY av.id DESC`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT wr.id,wr.relation_type,wr.vice_versa,
                 wr.created_by_user_id,w.id AS work_id,
                 COALESCE(w.chinese_title,w.original_title) AS title,
                 w.original_title,w.chinese_title,w.original_release_date,
                 w.engine_family,w.language,${RELATED_COVER_SQL}
          FROM work_relations wr JOIN works w ON w.id=wr.to_work_id
          WHERE wr.from_work_id=? AND w.id IN (SELECT id FROM public_works)
          ORDER BY wr.relation_type,title,w.id,wr.id`,
      )
      .bind(workId),
    database
      .prepare(
        `SELECT tr.id,tr.target_role AS role,tr.created_by_user_id,
                 w.id AS work_id,COALESCE(w.chinese_title,w.original_title) AS title,
                 w.original_title,w.chinese_title,w.original_release_date,
                 w.engine_family,w.language,${RELATED_COVER_SQL}
          FROM translation_relations tr JOIN works w ON w.id=tr.target_work_id
          WHERE tr.source_work_id=? AND w.id IN (SELECT id FROM public_works)
          ORDER BY CASE tr.target_role WHEN 'original' THEN 0 ELSE 1 END,title,w.id,tr.id`,
      )
      .bind(workId),
  ]);
  const characters = batchRows<
    CharacterPortraitRow & {
      id: number;
      primary_name: string;
      original_name: string;
      override_blob_sha256: string | null;
      override_cell_row: number | null;
      override_cell_column: number | null;
      display_name: string;
      role_key: string;
      spoiler_level: number;
      sort_order: number | null;
      notes: string | null;
    }
  >(results[2]).map((row) => ({
    id: row.id,
    primaryName: row.primary_name,
    originalName: row.original_name,
    displayName: row.display_name,
    portrait: mapCharacterPortrait(row),
    portraitChoice: portraitChoiceFromRow(row),
    roleKey: row.role_key,
    spoilerLevel: row.spoiler_level,
    sortOrder: row.sort_order,
    notes: row.notes,
  }));
  const creators = batchRows<{
    id: number;
    name: string;
    display_name: string;
    links_json: string;
    role_key: string;
    role_label: string | null;
    notes: string | null;
  }>(results[3]).map((row) => ({
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    links: parseCreatorLinks(row.links_json),
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
      role: "cover" | "preview";
      title: string | null;
      alt_text: string | null;
      sort_order: number | null;
    }>(results[4]).map((row) => ({
      blobSha256: row.blob_sha256,
      role: row.role,
      title: row.title,
      altText: row.alt_text,
      sortOrder: row.sort_order,
    })),
    links: batchRows<{
      id: number;
      label: string;
      url: string;
      link_type: string;
    }>(results[5])
      .filter((row) => isHttpUrl(row.url))
      .map((row) => ({
        id: row.id,
        label: row.label,
        url: row.url,
        linkType: row.link_type,
      })),
    archives: batchRows<{
      id: number;
      language: string;
      is_current: number;
      total_files: number;
      total_size_bytes: number;
      estimated_r2_get_count: number;
      published_at: string | null;
      uploader_id: number | null;
      uploader_name: string | null;
    }>(results[6]).map((row) => ({
      id: row.id,
      language: row.language,
      isCurrent: row.is_current === 1,
      totalFiles: row.total_files,
      totalSizeBytes: row.total_size_bytes,
      estimatedR2GetCount: row.estimated_r2_get_count,
      publishedAt: row.published_at,
      uploaderId: row.uploader_id,
      uploaderName: row.uploader_name,
    })),
    relations: batchRows<{
      id: number;
      relation_type: string;
      vice_versa: number;
      created_by_user_id: number | null;
      work_id: number;
      title: string;
      original_title: string;
      chinese_title: string | null;
      original_release_date: string | null;
      engine_family: string;
      language: string;
      cover_blob_sha256: string | null;
    }>(results[7]).map((row) => ({
      id: row.id,
      direction: "from" as const,
      relationType: row.relation_type,
      viceVersa: row.vice_versa === 1,
      createdByUserId: row.created_by_user_id,
      workId: row.work_id,
      title: row.title,
      originalTitle: row.original_title,
      chineseTitle: row.chinese_title,
      originalReleaseDate: row.original_release_date,
      engineFamily: row.engine_family,
      language: row.language,
      coverBlobSha256: row.cover_blob_sha256,
    })),
    translations: batchRows<{
      id: number;
      role: "original" | "translation";
      created_by_user_id: number | null;
      work_id: number;
      title: string;
      original_title: string;
      chinese_title: string | null;
      original_release_date: string | null;
      engine_family: string;
      language: string;
      cover_blob_sha256: string | null;
    }>(results[8]).map((row) => ({
      id: row.id,
      role: row.role,
      workId: row.work_id,
      title: row.title,
      originalTitle: row.original_title,
      chineseTitle: row.chinese_title,
      originalReleaseDate: row.original_release_date,
      engineFamily: row.engine_family,
      language: row.language,
      createdByUserId: row.created_by_user_id,
      coverBlobSha256: row.cover_blob_sha256,
    })),
  };
}

function batchRows<T>(result: D1Result): T[] {
  return (result.results ?? []) as T[];
}
const RELATED_COVER_SQL = `(
  SELECT ma.blob_sha256
  FROM work_media_assets wma
  JOIN media_assets ma ON ma.id = wma.media_asset_id
  WHERE wma.work_id = w.id
    AND wma.role='cover'
  ORDER BY wma.sort_order
  LIMIT 1
) AS cover_blob_sha256`;

async function listTranslations(
  runtime: AppRuntime,
  id: number,
): Promise<GameTranslationRelation[]> {
  const rows = await getD1(runtime)
    .prepare(
      `SELECT tr.id,
          tr.target_role AS role,
          tr.created_by_user_id,
          w.id AS work_id,
          COALESCE(w.chinese_title, w.original_title) AS title,
          w.original_title,w.chinese_title,w.original_release_date,
          w.engine_family,w.language,
          ${RELATED_COVER_SQL}
       FROM translation_relations tr
       JOIN works w ON w.id = tr.target_work_id
       WHERE tr.source_work_id = ?
         AND w.id IN (SELECT id FROM public_works)
       ORDER BY CASE tr.target_role WHEN 'original' THEN 0 ELSE 1 END,title,w.id,tr.id`,
    )
    .bind(id)
    .all<{
      id: number;
      role: "original" | "translation";
      created_by_user_id: number | null;
      work_id: number;
      title: string;
      original_title: string;
      chinese_title: string | null;
      original_release_date: string | null;
      engine_family: string;
      language: string;
      cover_blob_sha256: string | null;
    }>();
  return (rows.results ?? []).map((x) => ({
    id: x.id,
    role: x.role,
    workId: x.work_id,
    title: x.title,
    originalTitle: x.original_title,
    chineseTitle: x.chinese_title,
    originalReleaseDate: x.original_release_date,
    engineFamily: x.engine_family,
    language: x.language,
    createdByUserId: x.created_by_user_id,
    coverBlobSha256: x.cover_blob_sha256,
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

async function getWorkDistributionState(
  runtime: AppRuntime,
  workId: number,
): Promise<{
  hasCurrentArchive: boolean;
}> {
  const row = await getD1(runtime)
    .prepare(
      `SELECT
         EXISTS(
           SELECT 1 FROM archive_versions
           WHERE work_id=w.id AND status='published' AND is_current=1
         ) AS has_current_archive
       FROM works w
       WHERE w.id=?
       LIMIT 1`,
    )
    .bind(workId)
    .first<{ has_current_archive: number }>();
  if (!row) throw new HttpError(404, "作品不存在");
  return {
    hasCurrentArchive: row.has_current_archive === 1,
  };
}
function uniqueCreatorSelections(
  values: CreatorSelection[],
): CreatorSelection[] {
  const selections = new Map<string, CreatorSelection>();
  for (const value of values) {
    const key = creatorSelectionKey(value);
    if (!selections.has(key)) selections.set(key, value);
  }
  return [...selections.values()];
}

function selectionFromCreator(creator: GameCreatorCredit): CreatorSelection {
  return {
    kind: "existing",
    creatorId: creator.id,
    name: creator.name,
    displayName: creator.displayName,
  };
}

function characterSelectionFromGameCharacter(
  character: GameCharacter,
): CharacterCreditSelection {
  return {
    selection: {
      kind: "existing",
      characterId: character.id,
      originalName: character.originalName,
      displayName: character.displayName,
    },
    portrait: character.portraitChoice,
    faceSheetBlobSha256s: [],
    roleKey: isCharacterRoleKey(character.roleKey)
      ? character.roleKey
      : "supporting",
  };
}

function groupCharactersByIdentity(
  characters: GameCharacter[],
): Map<number, GameCharacter[]> {
  const result = new Map<number, GameCharacter[]>();
  for (const character of characters) {
    const group = result.get(character.id) ?? [];
    group.push(character);
    result.set(character.id, group);
  }
  return result;
}

function takeExistingCharacter(
  characters: Map<number, GameCharacter[]>,
  credit: CharacterCreditSelection,
): GameCharacter | undefined {
  if (credit.selection.kind !== "existing") return undefined;
  const group = characters.get(credit.selection.characterId);
  if (!group?.length) return undefined;
  const matchingIndex = group.findIndex(
    (character) => character.displayName === credit.selection.displayName,
  );
  return group.splice(matchingIndex < 0 ? 0 : matchingIndex, 1)[0];
}

function portraitChoiceFromRow(row: {
  override_blob_sha256: string | null;
  override_cell_row: number | null;
  override_cell_column: number | null;
}): CharacterPortraitChoice | null {
  if (
    !row.override_blob_sha256 ||
    row.override_cell_row === null ||
    row.override_cell_column === null
  ) {
    return null;
  }
  return {
    blobSha256: row.override_blob_sha256,
    row: row.override_cell_row,
    column: row.override_cell_column,
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

function uniqueText(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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

async function hasUsableDistribution(runtime: AppRuntime, workId: number) {
  const state = await getWorkDistributionState(runtime, workId);
  const work = await getD1(runtime).prepare("SELECT engine_family FROM works WHERE id=?").bind(workId).first<{engine_family: string}>();
  const links = await getD1(runtime).prepare("SELECT COUNT(*) AS count FROM work_external_links WHERE work_id=? AND link_type='download_page'").bind(workId).first<{count: number}>();
  const distribution = deriveWorkDistribution({...state, downloadLinkCount: links?.count ?? 0});
  return !!work && (distribution === "archive" ? isArchiveEngineFamily(work.engine_family) : distribution === "external" && isExternalEngineFamily(work.engine_family));
}
