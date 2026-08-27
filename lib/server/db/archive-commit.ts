import { FILE_POLICY_VERSION, PACKER_VERSION } from "@/lib/archive/file-policy";
import type {
  ArchiveCommitMetadata,
  ArchiveManifest,
  ExcludedFileTypeSummary,
} from "@/lib/archive/manifest";
import { shouldSkipWebPlayLocalWrite } from "@/lib/archive/web-play-local-policy";
import { normalizeEntityName } from "@/lib/entity-name";
import { isLanguageCode } from "@/lib/labels";
import { assertTranslationLanguageChangeAllowed } from "@/lib/server/db/relations";
import { normalizeSha256, sha256Hex } from "@/lib/server/crypto/sha256";
import { findExistingObjects } from "@/lib/server/db/archive-objects";
import { chunkArray } from "@/lib/server/db/chunks";
import { getD1 } from "@/lib/server/db/d1";
import { requiredOwnedImportJob } from "@/lib/server/db/import-jobs";
import type { ArchiveUser } from "@/lib/server/db/users";
import { putManifest } from "@/lib/server/storage/archive-bucket";
import { validateCorePackReferences } from "@/lib/server/storage/core-pack-validation";
import { HttpError } from "@/lib/server/http/json";
import { normalizeHttpUrl } from "@/lib/server/http/safe-url";

export type CommitArchiveImportInput = {
  importJobId: number;
  user: ArchiveUser;
  manifestSha256: string;
  manifestJson: string;
  metadata: ArchiveCommitMetadata;
  excludedFileTypes: ExcludedFileTypeSummary[];
};

export type CommitArchiveImportResult = {
  workId: number;
  archiveVersionId: number;
  manifestSha256: string;
  fileCount: number;
  uniqueBlobCount: number;
  corePackCount: number;
};

type IdRow = {
  id: number;
};

type CorePackIdRow = {
  id: number;
  sha256: string;
};

type ArchiveVersionLookupRow = {
  id: number;
  status: string;
  uploader_id: number | null;
  purged_at: string | null;
};

export async function commitArchiveImport(
  input: CommitArchiveImportInput,
): Promise<CommitArchiveImportResult> {
  const job = await requiredOwnedImportJob(input.importJobId, input.user);
  if (job.status === "completed") throw new HttpError(409, "导入任务已完成");
  if (job.status === "canceled") throw new HttpError(409, "导入任务已取消");

  if (
    typeof input.manifestSha256 !== "string" ||
    typeof input.manifestJson !== "string"
  ) {
    throw new HttpError(400, "Manifest payload is invalid");
  }

  if (!/^[a-f0-9]{64}$/i.test(input.manifestSha256)) {
    throw new HttpError(400, "Manifest SHA-256 is invalid");
  }
  let manifestSha256 = normalizeSha256(input.manifestSha256);
  let manifestJson = input.manifestJson;
  const actualManifestSha256 = await sha256Hex(
    new TextEncoder().encode(manifestJson).buffer,
  );

  if (actualManifestSha256 !== manifestSha256) {
    throw new HttpError(400, "Manifest SHA-256 mismatch");
  }

  const manifest = parseManifestJson(manifestJson);
  let metadata: ArchiveCommitMetadata;
  try {
    metadata = normalizeMetadata(input.metadata);
    try {
      validateManifest(manifest, metadata);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        400,
        error instanceof Error
          ? error.message
          : "Manifest or metadata is invalid",
      );
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      error instanceof Error
        ? error.message
        : "Manifest or metadata is invalid",
    );
  }

  const blobHashes = unique(
    manifest.files
      .filter((file) => file.storage.kind === "blob")
      .map((file) =>
        normalizeSha256(
          file.storage.kind === "blob" ? file.storage.blobSha256 : "",
        ),
      ),
  );
  const metadataBlobHashes = metadataImageBlobHashes(metadata);
  const allBlobHashes = unique([...blobHashes, ...metadataBlobHashes]);
  const corePackHashes = manifest.corePacks.map((corePack) =>
    normalizeSha256(corePack.sha256),
  );
  const existing = await findExistingObjects({
    blobSha256: allBlobHashes,
    corePackSha256: corePackHashes,
  });
  const missingBlobs = allBlobHashes.filter(
    (sha256) => !existing.blobs.has(sha256),
  );
  const missingCorePacks = corePackHashes.filter(
    (sha256) => !existing.corePacks.has(sha256),
  );

  if (missingBlobs.length > 0 || missingCorePacks.length > 0) {
    throw new HttpError(
      409,
      `Commit blocked by missing objects: ${missingBlobs.length} blobs, ${missingCorePacks.length} core packs`,
    );
  }

  await validateBlobReferences(manifest);
  await validateCorePackReferences(manifest);
  const workId = await resolveTargetWork(
    metadata,
    input.user,
    job.work_id,
    input.importJobId,
  );
  const work = await getD1()
    .prepare(`SELECT id FROM works WHERE id = ? LIMIT 1`)
    .bind(workId)
    .first<{ id: number }>();
  if (!work) throw new Error("Game was not created");
  if (metadata.target.mode === "update") {
    const existingWork = await getD1()
      .prepare(
        `SELECT chinese_title,sort_title,description,original_release_date,
           original_release_precision,engine_detail,icon_blob_sha256,thumbnail_blob_sha256,
           status,extra_json
         FROM works WHERE id = ? LIMIT 1`,
      )
      .bind(workId)
      .first<{
        chinese_title: string | null;
        sort_title: string | null;
        description: string | null;
        original_release_date: string | null;
        original_release_precision: "year" | "month" | "day" | "unknown";
        engine_detail: string | null;
        icon_blob_sha256: string | null;
        thumbnail_blob_sha256: string | null;
        status: "draft" | "published" | "hidden";
        extra_json: string;
      }>();
    if (existingWork) {
      metadata = {
        ...metadata,
        game: {
          ...metadata.game,
          chineseTitle: mergeNullableWorkText(
            metadata.game.chineseTitle,
            existingWork.chinese_title,
          ),
          sortTitle: mergeNullableWorkText(
            metadata.game.sortTitle,
            existingWork.sort_title,
          ),
          description: mergeNullableWorkText(
            metadata.game.description,
            existingWork.description,
          ),
          originalReleaseDate: mergeNullableWorkText(
            metadata.game.originalReleaseDate,
            existingWork.original_release_date,
          ),
          originalReleasePrecision:
            metadata.game.originalReleaseDate ||
            metadata.game.originalReleasePrecision !== "unknown"
              ? metadata.game.originalReleasePrecision
              : existingWork.original_release_precision,
          engineDetail: mergeNullableWorkText(
            metadata.game.engineDetail,
            existingWork.engine_detail,
          ),
          iconBlobSha256:
            metadata.game.iconBlobSha256 ?? existingWork.icon_blob_sha256,
          thumbnailBlobSha256:
            metadata.game.thumbnailBlobSha256 ??
            existingWork.thumbnail_blob_sha256,
          status: existingWork.status,
          extra: {
            ...parseJsonObject(existingWork.extra_json),
            ...metadata.game.extra,
          },
        },
      };
    }
  }
  // The server may fill omitted update fields from the existing work. Keep the
  // signed manifest in lockstep with those effective game fields.
  if (
    manifest.game.originalTitle !== metadata.game.originalTitle ||
    manifest.game.chineseTitle !== metadata.game.chineseTitle ||
    manifest.game.language !== metadata.game.language ||
    manifest.game.isOriginal !== metadata.game.isOriginal
  ) {
    manifest.game.originalTitle = metadata.game.originalTitle;
    manifest.game.chineseTitle = metadata.game.chineseTitle;
    manifest.game.language = metadata.game.language;
    manifest.game.isOriginal = metadata.game.isOriginal;
    manifestJson = JSON.stringify(manifest);
    manifestSha256 = await sha256Hex(
      new TextEncoder().encode(manifestJson).buffer,
    );
    validateManifest(manifest, metadata);
  }
  await getD1()
    .prepare(
      `UPDATE import_jobs SET work_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .bind(workId, input.importJobId)
    .run();

  const existingArchiveVersion = await findReusableDraftByManifest(
    workId,
    manifestSha256,
    input.user.id,
  );

  const archiveVersionId = existingArchiveVersion
    ? existingArchiveVersion.id
    : await insertArchiveVersion({
        workId,
        manifest,
        metadata,
        manifestSha256,
        uniqueBlobSizeBytes: sumUniqueBlobBytes(manifest),
        corePackSizeBytes: manifest.corePacks.reduce(
          (sum, item) => sum + item.size,
          0,
        ),
        estimatedR2GetCount: corePackHashes.length + blobHashes.length,
        uploaderId: input.user.id,
      });
  await putManifest(manifestSha256, manifestJson, {
    workId,
    archiveVersionId,
  });

  const corePackIds = await loadCorePackIds(corePackHashes);
  await updateObjectFirstSeen(archiveVersionId, blobHashes, corePackHashes);
  await insertArchiveVersionRefs({
    archiveVersionId,
    manifest,
    corePackIds,
  });
  await finalizeArchiveCommit({
    importJobId: input.importJobId,
    workId,
    archiveVersionId,
    manifest,
    metadata,
    missingBlobCount: missingBlobs.length,
    missingCorePackCount: missingCorePacks.length,
    excludedFileTypes: input.excludedFileTypes,
  });

  return {
    workId,
    archiveVersionId,
    manifestSha256,
    fileCount: manifest.files.length,
    uniqueBlobCount: blobHashes.length,
    corePackCount: corePackHashes.length,
  };
}

async function validateBlobReferences(
  manifest: ArchiveManifest,
): Promise<void> {
  const expected = new Map<string, number>();
  for (const file of manifest.files) {
    if (file.storage.kind !== "blob") continue;
    const sha256 = normalizeSha256(file.storage.blobSha256);
    const previous = expected.get(sha256);
    if (previous !== undefined && previous !== file.size) {
      throw new HttpError(
        400,
        `Blob size is inconsistent across manifest files: ${sha256}`,
      );
    }
    expected.set(sha256, file.size);
  }
  const hashes = [...expected.keys()];
  for (const chunk of chunkArray(hashes, 100)) {
    if (chunk.length === 0) continue;
    const rows = await getD1()
      .prepare(
        `SELECT sha256,size_bytes FROM blobs WHERE status='active' AND sha256 IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(...chunk)
      .all<{ sha256: string; size_bytes: number }>();
    const found = new Map(
      (rows.results ?? []).map((row) => [row.sha256, row.size_bytes]),
    );
    for (const sha256 of chunk) {
      const size = found.get(sha256);
      if (size === undefined)
        throw new HttpError(409, `Blob record is missing: ${sha256}`);
      if (size !== expected.get(sha256))
        throw new HttpError(
          400,
          `Blob metadata does not match manifest: ${sha256}`,
        );
    }
  }
}

function validateManifest(
  manifest: ArchiveManifest,
  metadata: ArchiveCommitMetadata,
): void {
  if (manifest.schema !== "viprpg-archive.manifest.v1") {
    throw new Error("Unsupported manifest schema");
  }

  if (manifest.archiveVersion.filePolicyVersion !== FILE_POLICY_VERSION) {
    throw new Error("Unsupported file policy version");
  }

  if (manifest.archiveVersion.packerVersion !== PACKER_VERSION) {
    throw new Error("Unsupported packer version");
  }

  if (manifest.game.originalTitle !== metadata.game.originalTitle) {
    throw new Error("Manifest game original title does not match metadata");
  }

  if (manifest.game.chineseTitle !== metadata.game.chineseTitle) {
    throw new Error("Manifest game Chinese title does not match metadata");
  }

  if (manifest.game.language !== metadata.game.language) {
    throw new Error("Manifest game language does not match metadata");
  }

  if (manifest.game.isOriginal !== metadata.game.isOriginal) {
    throw new Error("Manifest game originality does not match metadata");
  }

  if (manifest.archiveVersion.label !== metadata.archiveVersion.label) {
    throw new Error("Manifest archive version label does not match metadata");
  }

  const snapshotFields: Array<[unknown, unknown, string]> = [
    [
      manifest.archiveVersion.isProofread,
      metadata.archiveVersion.isProofread,
      "proofread flag",
    ],
    [
      manifest.archiveVersion.isImageEdited,
      metadata.archiveVersion.isImageEdited,
      "image edit flag",
    ],
    [
      manifest.archiveVersion.sourceName,
      metadata.archiveVersion.sourceName,
      "source name",
    ],
    [
      manifest.archiveVersion.sourceUrl,
      metadata.archiveVersion.sourceUrl,
      "source URL",
    ],
    [
      manifest.archiveVersion.executablePath,
      metadata.archiveVersion.executablePath,
      "executable path",
    ],
    [
      manifest.archiveVersion.rightsNotes,
      metadata.archiveVersion.rightsNotes,
      "rights notes",
    ],
  ];
  for (const [manifestValue, metadataValue, field] of snapshotFields) {
    if (manifestValue !== metadataValue) {
      throw new Error(`Manifest archive ${field} does not match metadata`);
    }
  }

  if (!isSupportedLanguage(metadata.game.language)) {
    throw new Error("Unsupported game language");
  }

  if (manifest.corePacks.length !== 1) {
    throw new Error("Exactly one core pack is required");
  }
  if (manifest.corePacks[0]?.id !== "core-main") {
    throw new Error("Manifest core pack id is invalid");
  }
  for (const corePack of manifest.corePacks) {
    assertCanonicalSha256(corePack.sha256, "core pack hash");
  }

  const includedSize = sumManifestFileSizes(manifest.files);
  const excludedSize = manifest.archiveVersion.excludedSize;
  if (manifest.archiveVersion.includedFileCount !== manifest.files.length) {
    throw new Error("Manifest included file count does not match files");
  }
  if (manifest.archiveVersion.includedSize !== includedSize) {
    throw new Error("Manifest included size does not match files");
  }
  if (
    manifest.archiveVersion.sourceFileCount !==
    manifest.archiveVersion.includedFileCount +
      manifest.archiveVersion.excludedFileCount
  ) {
    throw new Error(
      "Manifest source file count does not match included and excluded files",
    );
  }
  if (manifest.archiveVersion.sourceSize !== includedSize + excludedSize) {
    throw new Error(
      "Manifest source size does not match included and excluded files",
    );
  }
  const coreFiles = manifest.files.filter(
    (file) => file.storage.kind === "core_pack",
  );
  if (manifest.corePacks[0]?.fileCount !== coreFiles.length) {
    throw new Error("Manifest core pack file count does not match files");
  }
  if (
    manifest.corePacks[0]?.uncompressedSize !== sumManifestFileSizes(coreFiles)
  ) {
    throw new Error("Manifest core pack size does not match files");
  }

  const paths = new Set<string>();

  for (const file of manifest.files) {
    validateManifestPath(file.path);
    assertCanonicalSha256(file.sha256, `file hash: ${file.path}`);
    validateCrc32(file.crc32, file.path);

    if (paths.has(file.path)) {
      throw new Error(`Duplicate file path: ${file.path}`);
    }

    paths.add(file.path);

    if (file.storage.kind === "blob") {
      const fileSha256 = file.sha256;
      assertCanonicalSha256(file.storage.blobSha256, `blob hash: ${file.path}`);
      const blobSha256 = file.storage.blobSha256;
      if (fileSha256 !== blobSha256) {
        throw new Error(
          `Manifest blob hash does not match file hash: ${file.path}`,
        );
      }
    } else {
      if (file.storage.packId !== "core-main") {
        throw new Error("Unsupported core pack id");
      }

      validateManifestPath(file.storage.entry);
    }
  }
}

function assertCanonicalSha256(value: string, field: string): void {
  const normalized = normalizeSha256(value);
  if (value !== normalized) {
    throw new Error(
      `${field} must be lowercase hexadecimal without whitespace`,
    );
  }
}

function sumManifestFileSizes(files: ArchiveManifest["files"]): number {
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (!Number.isSafeInteger(total)) {
      throw new Error("Manifest file sizes exceed the supported range");
    }
  }
  return total;
}

function parseManifestJson(manifestJson: string): ArchiveManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    throw new HttpError(400, "Manifest JSON is invalid");
  }

  if (
    !isRecord(parsed) ||
    !isRecord(parsed.game) ||
    !isRecord(parsed.archiveVersion)
  ) {
    throw new HttpError(400, "Manifest structure is invalid");
  }
  if (!Array.isArray(parsed.corePacks) || !Array.isArray(parsed.files)) {
    throw new HttpError(400, "Manifest object lists are invalid");
  }

  if (parsed.schema !== "viprpg-archive.manifest.v1") {
    throw new HttpError(400, "Manifest schema is invalid");
  }

  const game = parsed.game;
  if (
    typeof game.originalTitle !== "string" ||
    (game.chineseTitle !== null && typeof game.chineseTitle !== "string") ||
    typeof game.language !== "string" ||
    typeof game.isOriginal !== "boolean"
  ) {
    throw new HttpError(400, "Manifest game fields are invalid");
  }
  const archiveVersion = parsed.archiveVersion;
  if (
    typeof archiveVersion.label !== "string" ||
    typeof archiveVersion.isProofread !== "boolean" ||
    typeof archiveVersion.isImageEdited !== "boolean" ||
    !isNullableString(archiveVersion.sourceName) ||
    !isNullableString(archiveVersion.sourceUrl) ||
    !isNullableString(archiveVersion.executablePath) ||
    !isNullableString(archiveVersion.rightsNotes) ||
    typeof archiveVersion.createdAt !== "string" ||
    typeof archiveVersion.filePolicyVersion !== "string" ||
    typeof archiveVersion.packerVersion !== "string" ||
    !["browser_folder", "browser_zip", "preindexed_manifest"].includes(
      String(archiveVersion.sourceType),
    ) ||
    !isNonNegativeInteger(archiveVersion.sourceFileCount) ||
    !isNonNegativeInteger(archiveVersion.sourceSize) ||
    !isNonNegativeInteger(archiveVersion.includedFileCount) ||
    !isNonNegativeInteger(archiveVersion.includedSize) ||
    !isNonNegativeInteger(archiveVersion.excludedFileCount) ||
    !isNonNegativeInteger(archiveVersion.excludedSize)
  ) {
    throw new HttpError(400, "Manifest archive fields are invalid");
  }
  for (const corePack of parsed.corePacks) {
    if (
      !isRecord(corePack) ||
      typeof corePack.id !== "string" ||
      typeof corePack.sha256 !== "string" ||
      !isNonNegativeInteger(corePack.size) ||
      !isNonNegativeInteger(corePack.uncompressedSize) ||
      !isNonNegativeInteger(corePack.fileCount) ||
      corePack.format !== "zip" ||
      corePack.compression !== "deflate-low"
    ) {
      throw new HttpError(400, "Manifest core pack fields are invalid");
    }
  }
  for (const file of parsed.files) {
    if (
      !isRecord(file) ||
      typeof file.path !== "string" ||
      typeof file.pathSortKey !== "string" ||
      !["map", "database", "asset", "runtime", "metadata", "other"].includes(
        String(file.role),
      ) ||
      typeof file.sha256 !== "string" ||
      !isNonNegativeInteger(file.crc32) ||
      !isNonNegativeInteger(file.size) ||
      (file.mtimeMs !== null &&
        (typeof file.mtimeMs !== "number" || !Number.isFinite(file.mtimeMs))) ||
      (file.pathBytesB64 !== undefined &&
        !isNullableString(file.pathBytesB64)) ||
      !isRecord(file.storage)
    ) {
      throw new HttpError(400, "Manifest file fields are invalid");
    }
    if (file.storage.kind === "blob") {
      if (typeof file.storage.blobSha256 !== "string")
        throw new HttpError(400, "Manifest blob reference is invalid");
    } else if (file.storage.kind === "core_pack") {
      if (
        typeof file.storage.packId !== "string" ||
        typeof file.storage.entry !== "string"
      )
        throw new HttpError(400, "Manifest core pack reference is invalid");
    } else {
      throw new HttpError(400, "Manifest storage kind is invalid");
    }
  }

  return parsed as ArchiveManifest;
}

function validateManifestPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid manifest path: ${path}`);
  }
}

function validateCrc32(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`Invalid CRC32 for manifest file: ${path}`);
  }
}

function normalizeMetadata(
  metadata: ArchiveCommitMetadata,
): ArchiveCommitMetadata {
  if (
    !isRecord(metadata) ||
    !isRecord(metadata.game) ||
    !isRecord(metadata.archiveVersion) ||
    !isRecord(metadata.target) ||
    !isRecord(metadata.externalLinks)
  ) {
    throw new HttpError(400, "Upload metadata is incomplete");
  }

  const game = metadata.game;
  const archiveVersion = metadata.archiveVersion;
  const target = metadata.target;
  const externalLinks = metadata.externalLinks;
  if (
    typeof game.originalTitle !== "string" ||
    !isNullableString(game.chineseTitle) ||
    !isNullableString(game.sortTitle) ||
    !isNullableString(game.description) ||
    !isNullableString(game.originalReleaseDate) ||
    !isEnum(game.originalReleasePrecision, [
      "year",
      "month",
      "day",
      "unknown",
    ] as const) ||
    !isEnum(game.engineFamily, [
      "rpg_maker_2000",
      "rpg_maker_2003",
      "mixed",
      "unknown",
      "other",
    ] as const) ||
    !isNullableString(game.engineDetail) ||
    typeof game.isOriginal !== "boolean" ||
    typeof game.language !== "string" ||
    !isNullableString(game.iconBlobSha256) ||
    !isNullableString(game.thumbnailBlobSha256) ||
    typeof game.usesManiacsPatch !== "boolean" ||
    !isEnum(game.status, ["draft", "published", "hidden"] as const) ||
    !isRecord(game.extra) ||
    !Array.isArray(game.browsingImageBlobSha256s)
  ) {
    throw new HttpError(400, "Upload metadata game fields are invalid");
  }
  if (!isLanguageCode(game.language)) {
    throw new HttpError(400, "Unsupported game language");
  }

  if (
    typeof archiveVersion.label !== "string" ||
    typeof archiveVersion.isProofread !== "boolean" ||
    typeof archiveVersion.isImageEdited !== "boolean" ||
    !isNullableString(archiveVersion.sourceName) ||
    !isNullableString(archiveVersion.sourceUrl) ||
    !isNullableString(archiveVersion.executablePath) ||
    !isNullableString(archiveVersion.rightsNotes)
  ) {
    throw new HttpError(400, "Upload metadata archive fields are invalid");
  }
  if (target.mode !== "create" && target.mode !== "update") {
    throw new HttpError(400, "Invalid upload target mode");
  }
  if (
    (target.mode === "update" &&
      (!Number.isSafeInteger(target.workId) || (target.workId ?? 0) <= 0)) ||
    (target.mode === "create" && target.workId !== null)
  ) {
    throw new HttpError(400, "Invalid upload target game");
  }
  if (
    !Array.isArray(metadata.tags) ||
    !Array.isArray(metadata.workTitles) ||
    !Array.isArray(metadata.creators) ||
    !Array.isArray(metadata.workStaff) ||
    !Array.isArray(externalLinks.work)
  ) {
    throw new HttpError(400, "Upload metadata lists are invalid");
  }
  if (
    metadata.characters !== undefined &&
    !Array.isArray(metadata.characters)
  ) {
    throw new HttpError(400, "Upload metadata characters are invalid");
  }

  const browsingImageBlobSha256s = normalizeOptionalHashList(
    game.browsingImageBlobSha256s,
  );
  const iconBlobSha256 = normalizeOptionalHash(game.iconBlobSha256);
  const thumbnailBlobSha256 = normalizeOptionalHash(game.thumbnailBlobSha256);
  const tags = unique(
    metadata.tags
      .map((tag) => normalizeEntityName(requireString(tag, "tag")))
      .filter(Boolean),
  );

  const workTitles = metadata.workTitles
    .map((title) => {
      if (
        !isRecord(title) ||
        typeof title.title !== "string" ||
        !isNullableString(title.language) ||
        title.titleType !== "alias"
      ) {
        throw new HttpError(400, "Upload metadata title is invalid");
      }
      if (title.language !== null && !isLanguageCode(title.language)) {
        throw new HttpError(400, "Upload metadata title language is invalid");
      }
      return {
        title: title.title.trim(),
        language: title.language?.trim() || null,
        titleType: "alias" as const,
      };
    })
    .filter((title) => title.title);

  const characters = (metadata.characters ?? [])
    .map((character, index) => {
      if (
        !isRecord(character) ||
        typeof character.name !== "string" ||
        !isNullableString(character.originalName) ||
        !isEnum(character.roleKey, [
          "main",
          "supporting",
          "cameo",
          "mentioned",
          "other",
        ] as const) ||
        !Number.isSafeInteger(character.spoilerLevel) ||
        character.spoilerLevel < 0 ||
        !(
          character.sortOrder === null ||
          Number.isSafeInteger(character.sortOrder)
        ) ||
        !isNullableString(character.notes)
      ) {
        throw new HttpError(400, "Upload metadata character is invalid");
      }
      return {
        name: normalizeEntityName(character.name),
        originalName: character.originalName?.trim() || null,
        roleKey: character.roleKey,
        spoilerLevel: character.spoilerLevel,
        sortOrder: character.sortOrder ?? index + 1,
        notes: character.notes?.trim() || null,
      };
    })
    .filter((character) => character.name);

  const creators = metadata.creators
    .map((creator) => {
      if (
        !isRecord(creator) ||
        typeof creator.name !== "string" ||
        !isNullableString(creator.originalName) ||
        !isNullableString(creator.websiteUrl) ||
        !isRecord(creator.extra)
      ) {
        throw new HttpError(400, "Upload metadata creator is invalid");
      }
      return {
        name: normalizeEntityName(creator.name),
        originalName: creator.originalName?.trim() || null,
        websiteUrl: normalizeHttpUrl(creator.websiteUrl, "作者网站"),
        extra: creator.extra,
      };
    })
    .filter((creator) => creator.name);

  const workStaff = metadata.workStaff
    .map((staff) => {
      if (
        !isRecord(staff) ||
        typeof staff.creatorName !== "string" ||
        !isEnum(staff.roleKey, [
          "author",
          "scenario",
          "graphics",
          "music",
          "translator",
          "editor",
          "publisher",
          "proofreader",
          "image_editor",
          "other",
        ] as const) ||
        !isNullableString(staff.roleLabel) ||
        !isNullableString(staff.notes)
      ) {
        throw new HttpError(400, "Upload metadata staff entry is invalid");
      }
      return {
        creatorName: normalizeEntityName(staff.creatorName),
        roleKey: staff.roleKey,
        roleLabel: staff.roleLabel?.trim() || null,
        notes: staff.notes?.trim() || null,
      };
    })
    .filter((staff) => staff.creatorName);

  const workLinks = externalLinks.work
    .map((link) => {
      if (
        !isRecord(link) ||
        typeof link.label !== "string" ||
        typeof link.url !== "string" ||
        !isEnum(link.linkType, [
          "official",
          "wiki",
          "source",
          "video",
          "download_page",
          "other",
        ] as const)
      ) {
        throw new HttpError(400, "Upload metadata external link is invalid");
      }
      return {
        label: link.label.trim(),
        url: normalizeHttpUrl(link.url, "作品外链") ?? "",
        linkType: link.linkType,
      };
    })
    .filter((link) => link.label && link.url);

  if (!game.originalTitle.trim() || !archiveVersion.label.trim()) {
    throw new HttpError(400, "游戏原名和快照名称不能为空");
  }

  return {
    ...metadata,
    game: {
      ...metadata.game,
      originalTitle: game.originalTitle.trim(),
      chineseTitle: normalizeNullableWorkText(game.chineseTitle),
      sortTitle: normalizeNullableWorkText(game.sortTitle),
      description: normalizeNullableWorkText(game.description),
      originalReleaseDate: normalizeNullableWorkText(game.originalReleaseDate),
      engineDetail: normalizeNullableWorkText(game.engineDetail),
      language: game.language.trim(),
      iconBlobSha256,
      thumbnailBlobSha256,
      browsingImageBlobSha256s,
    },
    target: { mode: target.mode, workId: target.workId },
    archiveVersion: {
      ...metadata.archiveVersion,
      label: archiveVersion.label.trim(),
      sourceName: archiveVersion.sourceName?.trim() || null,
      sourceUrl: normalizeHttpUrl(archiveVersion.sourceUrl, "来源网址"),
      executablePath: archiveVersion.executablePath?.trim() || null,
      rightsNotes: archiveVersion.rightsNotes?.trim() || null,
    },
    workTitles,
    characters,
    creators,
    workStaff,
    tags,
    externalLinks: { work: workLinks },
  };
}

function normalizeNullableWorkText(value: string | null): string | null {
  return value === null ? null : value.trim();
}

function mergeNullableWorkText(
  value: string | null,
  existing: string | null,
): string | null {
  return value === null ? existing : value || null;
}

function metadataImageBlobHashes(metadata: ArchiveCommitMetadata): string[] {
  return unique(
    [
      metadata.game.iconBlobSha256,
      metadata.game.thumbnailBlobSha256,
      ...metadata.game.browsingImageBlobSha256s,
    ].filter((sha256): sha256 is string => Boolean(sha256)),
  );
}

async function resolveTargetWork(
  metadata: ArchiveCommitMetadata,
  user: ArchiveUser,
  existingJobWorkId: number | null,
  importJobId: number,
): Promise<number> {
  const game = metadata.game;
  if (metadata.target.mode === "update") {
    if (existingJobWorkId && existingJobWorkId !== metadata.target.workId) {
      throw new HttpError(409, "导入任务已经绑定了另一款游戏");
    }
    if (
      !metadata.target.workId ||
      !(await canEditWork(metadata.target.workId, user))
    ) {
      throw new HttpError(403, "无权更新此游戏");
    }
    const identity = await getD1()
      .prepare(
        `SELECT original_title FROM works WHERE id=? AND status <> 'deleted' LIMIT 1`,
      )
      .bind(metadata.target.workId)
      .first<{ original_title: string }>();
    if (
      !identity ||
      identity.original_title !== game.originalTitle
    ) {
      throw new HttpError(409, "更新目标的原名不匹配");
    }
    await assertTranslationLanguageChangeAllowed(
      metadata.target.workId,
      game.language,
    );
    return metadata.target.workId;
  }

  if (existingJobWorkId) {
    if (!(await canEditWork(existingJobWorkId, user))) {
      throw new HttpError(403, "导入任务对应的游戏不属于当前上传者");
    }
    const identity = await getD1()
      .prepare(
        `SELECT original_title,language,is_original,status FROM works WHERE id=? LIMIT 1`,
      )
      .bind(existingJobWorkId)
      .first<{
        original_title: string;
        language: string;
        is_original: number;
        status: string;
      }>();
    if (
      !identity ||
      identity.status === "deleted" ||
      identity.original_title !== game.originalTitle ||
      identity.language !== game.language ||
      identity.is_original !== (game.isOriginal ? 1 : 0)
    )
      throw new HttpError(409, "导入任务的游戏身份或语言属性不匹配");
    return existingJobWorkId;
  }

  const database = getD1();
  const result = await database
    .prepare(
      `INSERT INTO works (
        original_title, chinese_title, sort_title, description, is_original, language,
        original_release_date, original_release_precision, engine_family, engine_detail,
        uses_maniacs_patch, icon_blob_sha256, thumbnail_blob_sha256, status, extra_json,
        created_by_user_id, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL)`,
    )
    .bind(
      game.originalTitle,
      game.chineseTitle,
      game.sortTitle,
      game.description,
      game.isOriginal ? 1 : 0,
      game.language,
      game.originalReleaseDate,
      game.originalReleasePrecision,
      game.engineFamily,
      game.engineDetail,
      game.usesManiacsPatch ? 1 : 0,
      game.iconBlobSha256,
      game.thumbnailBlobSha256,
      jsonText(game.extra),
      user.id,
    )
    .run();
  const workId = result.meta.last_row_id;
  if (!Number.isSafeInteger(workId)) throw new Error("Game was not created");
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO work_uploaders (work_id, user_id) VALUES (?, ?)`)
        .bind(workId, user.id),
      database
        .prepare(
          `UPDATE import_jobs SET work_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .bind(workId, importJobId),
    ]);
  } catch (error) {
    await database
      .prepare(`DELETE FROM works WHERE id = ? AND status = 'draft'`)
      .bind(workId)
      .run();
    throw error;
  }
  return workId as number;
}

async function canEditWork(
  workId: number,
  user: ArchiveUser,
): Promise<boolean> {
  if (hasWorkUpdatePermission(user)) {
    return Boolean(
      await getD1()
        .prepare(
          `SELECT 1 FROM works WHERE id = ? AND status <> 'deleted' LIMIT 1`,
        )
        .bind(workId)
        .first(),
    );
  }
  if (!user.permissionKeys.includes("work.update_own")) return false;
  const row = await getD1()
    .prepare(
      `SELECT 1 AS allowed FROM work_uploaders wu JOIN works w ON w.id=wu.work_id WHERE wu.work_id = ? AND wu.user_id = ? AND w.status <> 'deleted' LIMIT 1`,
    )
    .bind(workId, user.id)
    .first<{ allowed: number }>();
  return Boolean(row);
}

function hasWorkUpdatePermission(user: ArchiveUser): boolean {
  return (
    user.status === "active" && user.permissionKeys.includes("work.update")
  );
}

function isSupportedLanguage(value: string): boolean {
  return isLanguageCode(value);
}


async function findReusableDraftByManifest(
  workId: number,
  manifestSha256: string,
  uploaderId: number,
): Promise<ArchiveVersionLookupRow | null> {
  const row = await getD1()
    .prepare(
      `SELECT
        av.id,
        av.status,
        av.uploader_id,
        av.purged_at
      FROM archive_versions av
      WHERE av.work_id = ?
        AND av.manifest_sha256 = ?
      LIMIT 1`,
    )
    .bind(workId, manifestSha256)
    .first<ArchiveVersionLookupRow>();

  if (!row) {
    return null;
  }

  if (row.purged_at) {
    throw new HttpError(409, "相同清单的历史快照已最终清理，不能重新提交");
  }

  // A failed commit can leave a draft after the immutable row is inserted.
  // Only its uploader may resume that draft; every published row stays immutable.
  if (row.status === "draft" && row.uploader_id === uploaderId) {
    return row;
  }

  throw new HttpError(409, "相同清单的历史快照已存在，不能覆盖不可变快照");
}

async function finalizeArchiveCommit(input: {
  importJobId: number;
  workId: number;
  archiveVersionId: number;
  manifest: ArchiveManifest;
  metadata: ArchiveCommitMetadata;
  missingBlobCount: number;
  missingCorePackCount: number;
  excludedFileTypes: ExcludedFileTypeSummary[];
}): Promise<void> {
  const database = getD1();
  const game = input.metadata.game;
  const creating = input.metadata.target.mode === "create";
  const characters = input.metadata.characters ?? [];
  const statements: D1PreparedStatement[] = [];

  statements.push(
    database
      .prepare(
        `UPDATE works
       SET chinese_title = ?,
         sort_title = ?,
         description = ?,
         is_original = ?,
         language = ?,
         original_release_date = ?,
         original_release_precision = ?,
         engine_family = ?,
         engine_detail = ?,
         uses_maniacs_patch = ?,
         icon_blob_sha256 = COALESCE(?, icon_blob_sha256),
         thumbnail_blob_sha256 = COALESCE(?, thumbnail_blob_sha256),
         status = ?,
         extra_json = ?,
         updated_at = CURRENT_TIMESTAMP,
         published_at = CASE
           WHEN ? = 'published' THEN COALESCE(published_at, CURRENT_TIMESTAMP)
           ELSE published_at
         END
       WHERE id = ? AND status <> 'deleted'`,
      )
      .bind(
        game.chineseTitle,
        game.sortTitle,
        game.description,
        game.isOriginal ? 1 : 0,
        game.language,
        game.originalReleaseDate,
        game.originalReleasePrecision,
        game.engineFamily,
        game.engineDetail,
        game.usesManiacsPatch ? 1 : 0,
        game.iconBlobSha256,
        game.thumbnailBlobSha256,
        game.status,
        jsonText(game.extra),
        game.status,
        input.workId,
      ),
  );

  if (creating || input.metadata.workTitles.length > 0) {
    if (creating) {
      statements.push(
        database
          .prepare(`DELETE FROM work_titles WHERE work_id = ?`)
          .bind(input.workId),
      );
    }
    for (const title of input.metadata.workTitles) {
      statements.push(
        database
          .prepare(
            `INSERT OR IGNORE INTO work_titles (
             work_id, title, language, title_type, is_searchable
           ) VALUES (?, ?, ?, ?, 1)`,
          )
          .bind(input.workId, title.title, title.language, title.titleType),
      );
    }
  }

  if (
    creating ||
    input.metadata.creators.length > 0 ||
    input.metadata.workStaff.length > 0
  ) {
    for (const creator of input.metadata.creators) {
      statements.push(
        database
          .prepare(
            `INSERT OR IGNORE INTO creators (
             name, original_name, website_url, extra_json
           ) VALUES (?, ?, ?, ?)`,
          )
          .bind(
            creator.name,
            creator.originalName,
            creator.websiteUrl,
            jsonText(creator.extra),
          ),
      );
    }
    if (creating) {
      statements.push(
        database
          .prepare(`DELETE FROM work_staff WHERE work_id = ?`)
          .bind(input.workId),
      );
    }
    for (const staff of input.metadata.workStaff) {
      statements.push(
        database
          .prepare(
            `INSERT OR IGNORE INTO work_staff (
             work_id, creator_id, role_key, role_label, notes
           ) SELECT ?, id, ?, ?, ? FROM creators WHERE name = ? COLLATE NOCASE`,
          )
          .bind(
            input.workId,
            staff.roleKey,
            staff.roleLabel,
            staff.notes,
            staff.creatorName,
          ),
      );
    }
  }

  if (creating || characters.length > 0) {
    for (const character of characters) {
      statements.push(
        database
          .prepare(
            `INSERT OR IGNORE INTO characters (
             primary_name, original_name, extra_json
           ) VALUES (?, ?, '{}')`,
          )
          .bind(character.name, character.originalName),
      );
    }
    if (creating) {
      statements.push(
        database
          .prepare(`DELETE FROM work_characters WHERE work_id = ?`)
          .bind(input.workId),
      );
    }
    for (const character of characters) {
      statements.push(
        database
          .prepare(
            `INSERT OR REPLACE INTO work_characters (
             work_id, character_id, role_key, spoiler_level, sort_order, notes
           ) SELECT ?, id, ?, ?, ?, ? FROM characters WHERE primary_name = ? COLLATE NOCASE`,
          )
          .bind(
            input.workId,
            character.roleKey,
            character.spoilerLevel,
            character.sortOrder,
            character.notes,
            character.name,
          ),
      );
    }
  }

  if (creating || input.metadata.tags.length > 0) {
    for (const tag of input.metadata.tags) {
      statements.push(
        database
          .prepare(
            `INSERT OR IGNORE INTO tags (name, namespace) VALUES (?, 'other')`,
          )
          .bind(tag),
      );
    }
    if (creating) {
      statements.push(
        database
          .prepare(
            `DELETE FROM work_tags WHERE work_id = ? AND source = 'uploader'`,
          )
          .bind(input.workId),
      );
    }
    for (const tag of input.metadata.tags) {
      statements.push(
        database
          .prepare(
            `INSERT OR IGNORE INTO work_tags (work_id, tag_id, source)
           SELECT ?, id, 'uploader' FROM tags WHERE name = ? COLLATE NOCASE`,
          )
          .bind(input.workId, tag),
      );
    }
  }

  const links = input.metadata.externalLinks.work;
  if (creating || links.length > 0) {
    if (creating) {
      statements.push(
        database
          .prepare(`DELETE FROM work_external_links WHERE work_id = ?`)
          .bind(input.workId),
      );
    }
    for (const link of links) {
      statements.push(
        database
          .prepare(
            `INSERT INTO work_external_links (work_id, label, url, link_type)
           SELECT ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM work_external_links
             WHERE work_id = ? AND label = ? AND url = ? AND link_type = ?
           )`,
          )
          .bind(
            input.workId,
            link.label,
            link.url,
            link.linkType,
            input.workId,
            link.label,
            link.url,
            link.linkType,
          ),
      );
    }
  }

  const browsingImages = game.browsingImageBlobSha256s;
  if (creating || browsingImages.length > 0) {
    for (const sha256 of browsingImages) {
      statements.push(
        database
          .prepare(
            `INSERT OR IGNORE INTO media_assets (blob_sha256, kind) VALUES (?, 'preview')`,
          )
          .bind(sha256),
      );
    }
    if (creating) {
      statements.push(
        database
          .prepare(
            `DELETE FROM work_media_assets
           WHERE work_id = ?
             AND media_asset_id IN (SELECT id FROM media_assets WHERE kind = 'preview')`,
          )
          .bind(input.workId),
      );
    }
    for (const [index, sha256] of browsingImages.entries()) {
      statements.push(
        database
          .prepare(
            `INSERT OR REPLACE INTO work_media_assets (
             work_id, media_asset_id, sort_order, is_primary
         ) SELECT ?, id, ?, ? FROM media_assets
             WHERE blob_sha256 = ? AND kind = 'preview'`,
          )
          .bind(
            input.workId,
            index + 1,
            creating && index === 0 ? 1 : 0,
            sha256,
          ),
      );
    }
  }

  statements.push(
    database
      .prepare(
        `UPDATE archive_versions SET is_current = 0
       WHERE work_id = ? AND id <> ?`,
      )
      .bind(input.workId, input.archiveVersionId),
    database
      .prepare(
        `UPDATE archive_versions
       SET status = 'published',
         is_current = 1,
         deleted_at = NULL,
         published_at = COALESCE(published_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND work_id = ? AND purged_at IS NULL`,
      )
      .bind(input.archiveVersionId, input.workId),
    database
      .prepare(
        `UPDATE import_jobs
       SET work_id = ?,
          archive_version_id = ?,
          status = 'completed',
          source_name = ?,
         source_size_bytes = ?,
         file_count = ?,
         excluded_file_count = ?,
         excluded_size_bytes = ?,
          file_policy_version = ?,
          missing_blob_count = ?,
          missing_core_pack_count = ?,
          failed_stage = NULL,
         error_message = NULL,
         updated_at = CURRENT_TIMESTAMP,
         completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      )
      .bind(
        input.workId,
        input.archiveVersionId,
        input.manifest.archiveVersion.sourceName,
        input.manifest.archiveVersion.sourceSize,
        input.manifest.archiveVersion.includedFileCount,
        input.manifest.archiveVersion.excludedFileCount,
        input.manifest.archiveVersion.excludedSize,
        input.manifest.archiveVersion.filePolicyVersion,
        input.missingBlobCount,
        input.missingCorePackCount,
        input.importJobId,
      ),
    database
      .prepare(
        `DELETE FROM import_job_excluded_file_types WHERE import_job_id = ?`,
      )
      .bind(input.importJobId),
  );

  for (const item of input.excludedFileTypes) {
    statements.push(
      database
        .prepare(
          `INSERT OR IGNORE INTO import_job_excluded_file_types (
           import_job_id, file_type, file_count, total_size_bytes, example_path
         ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          input.importJobId,
          item.fileType,
          item.fileCount,
          item.totalSizeBytes,
          item.examplePath,
        ),
    );
  }

  await database.batch(statements);
}

async function insertArchiveVersion(input: {
  workId: number;
  manifest: ArchiveManifest;
  metadata: ArchiveCommitMetadata;
  manifestSha256: string;
  uniqueBlobSizeBytes: number;
  corePackSizeBytes: number;
  estimatedR2GetCount: number;
  uploaderId: number;
}): Promise<number> {
  const manifest = input.manifest;
  const webPlayTotals = calculateWebPlayTotals(manifest);

  await getD1()
    .prepare(
      `INSERT INTO archive_versions (
        work_id,
        archive_label,
        is_proofread,
        is_image_edited,
        source_name,
        source_url,
        executable_path,
        rights_notes,
        manifest_sha256,
        file_policy_version,
        packer_version,
        source_type,
        source_file_count,
        source_size_bytes,
        excluded_file_count,
        excluded_size_bytes,
        total_files,
        total_size_bytes,
        unique_blob_size_bytes,
        core_pack_count,
        core_pack_size_bytes,
        estimated_r2_get_count,
        web_play_file_count,
        web_play_size_bytes,
        is_current,
        uploader_id,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft')`,
    )
    .bind(
      input.workId,
      input.metadata.archiveVersion.label,
      input.metadata.archiveVersion.isProofread ? 1 : 0,
      input.metadata.archiveVersion.isImageEdited ? 1 : 0,
      input.metadata.archiveVersion.sourceName,
      input.metadata.archiveVersion.sourceUrl,
      input.metadata.archiveVersion.executablePath,
      input.metadata.archiveVersion.rightsNotes,
      input.manifestSha256,
      manifest.archiveVersion.filePolicyVersion,
      manifest.archiveVersion.packerVersion,
      manifest.archiveVersion.sourceType,
      manifest.archiveVersion.sourceFileCount,
      manifest.archiveVersion.sourceSize,
      manifest.archiveVersion.excludedFileCount,
      manifest.archiveVersion.excludedSize,
      manifest.files.length,
      manifest.archiveVersion.includedSize,
      input.uniqueBlobSizeBytes,
      manifest.corePacks.length,
      input.corePackSizeBytes,
      input.estimatedR2GetCount,
      webPlayTotals.fileCount,
      webPlayTotals.sizeBytes,
      input.uploaderId,
    )
    .run();

  return requiredId(
    `SELECT id FROM archive_versions WHERE work_id = ? AND manifest_sha256 = ?`,
    [input.workId, input.manifestSha256],
  );
}

async function loadCorePackIds(hashes: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  for (const sha256 of hashes) {
    const row = await getD1()
      .prepare(`SELECT id, sha256 FROM core_packs WHERE sha256 = ?`)
      .bind(sha256)
      .first<CorePackIdRow>();

    if (!row) {
      throw new Error(`Core pack record missing: ${sha256}`);
    }

    result.set(row.sha256, row.id);
  }

  return result;
}

async function updateObjectFirstSeen(
  archiveVersionId: number,
  blobHashes: string[],
  corePackHashes: string[],
): Promise<void> {
  for (const chunk of chunkArray(blobHashes, 50)) {
    if (chunk.length === 0) {
      continue;
    }

    await getD1()
      .prepare(
        `UPDATE blobs
        SET first_seen_archive_version_id = COALESCE(first_seen_archive_version_id, ?)
        WHERE sha256 IN (${chunk.map(() => "?").join(", ")})`,
      )
      .bind(archiveVersionId, ...chunk)
      .run();
  }

  for (const chunk of chunkArray(corePackHashes, 50)) {
    if (chunk.length === 0) {
      continue;
    }

    await getD1()
      .prepare(
        `UPDATE core_packs
        SET first_seen_archive_version_id = COALESCE(first_seen_archive_version_id, ?)
        WHERE sha256 IN (${chunk.map(() => "?").join(", ")})`,
      )
      .bind(archiveVersionId, ...chunk)
      .run();
  }
}

async function insertArchiveVersionRefs(input: {
  archiveVersionId: number;
  manifest: ArchiveManifest;
  corePackIds: Map<string, number>;
}): Promise<void> {
  const blobHashes = unique(
    input.manifest.files
      .filter((file) => file.storage.kind === "blob")
      .map((file) =>
        file.storage.kind === "blob"
          ? normalizeSha256(file.storage.blobSha256)
          : "",
      ),
  );
  const corePackIds = uniqueNumbers(
    input.manifest.corePacks.map((corePack) => {
      const sha256 = normalizeSha256(corePack.sha256);
      const id = input.corePackIds.get(sha256);

      if (!id) {
        throw new Error(`Core pack id missing: ${sha256}`);
      }

      return id;
    }),
  );

  for (const chunk of chunkArray(blobHashes, 50)) {
    if (chunk.length === 0) {
      continue;
    }

    const placeholders = chunk.map(() => "(?, ?)").join(", ");
    const values = chunk.flatMap((sha256) => [input.archiveVersionId, sha256]);

    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO archive_version_blob_refs (
          archive_version_id,
          blob_sha256
        ) VALUES ${placeholders}`,
      )
      .bind(...values)
      .run();
  }

  for (const chunk of chunkArray(corePackIds, 50)) {
    if (chunk.length === 0) {
      continue;
    }

    const placeholders = chunk.map(() => "(?, ?)").join(", ");
    const values = chunk.flatMap((corePackId) => [
      input.archiveVersionId,
      corePackId,
    ]);

    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO archive_version_core_pack_refs (
          archive_version_id,
          core_pack_id
        ) VALUES ${placeholders}`,
      )
      .bind(...values)
      .run();
  }
}

async function requiredId(
  sql: string,
  bindings: Array<string | number | null>,
): Promise<number> {
  const row = await getD1()
    .prepare(sql)
    .bind(...bindings)
    .first<IdRow>();

  if (!row) {
    throw new Error("Expected row id was not found");
  }

  return row.id;
}

function sumUniqueBlobBytes(manifest: ArchiveManifest): number {
  const seen = new Set<string>();
  let total = 0;

  for (const file of manifest.files) {
    if (file.storage.kind !== "blob") {
      continue;
    }

    const sha256 = normalizeSha256(file.storage.blobSha256);
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    total += file.size;
  }

  return total;
}

function calculateWebPlayTotals(manifest: ArchiveManifest): {
  fileCount: number;
  sizeBytes: number;
} {
  let fileCount = 0;
  let sizeBytes = 0;

  for (const file of manifest.files) {
    if (shouldSkipWebPlayLocalWrite(file.path)) {
      continue;
    }

    fileCount += 1;
    sizeBytes += file.size;
  }

  return {
    fileCount,
    sizeBytes,
  };
}

function jsonText(value: Record<string, unknown>): string {
  return JSON.stringify(value ?? {});
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The database CHECK normally prevents this; keep the update path safe if
    // an older local database contains malformed auxiliary data.
  }
  return {};
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isEnum<const T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, `Upload metadata ${field} is invalid`);
  }
  return value;
}

function normalizeOptionalHash(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  return normalizeSha256(value);
}

function normalizeOptionalHashList(values: unknown[]): string[] {
  return unique(
    values
      .map((value) => requireString(value, "image hash").trim())
      .filter(Boolean)
      .map((value) => normalizeSha256(value)),
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
