import { FILE_POLICY_VERSION, PACKER_VERSION } from "@/lib/archive/file-policy";
import type {
  ArchiveCommitMetadata,
  ArchiveManifest,
  ArchiveSourceManifest,
  ExcludedFileTypeSummary,
} from "@/lib/archive/manifest";
import { shouldSkipWebPlayLocalWrite } from "@/lib/archive/web-play-local-policy";
import { normalizeCreatorName, normalizeEntityName } from "@/lib/entity-name";
import { isArchiveEngineFamily, isLanguageCode } from "@/lib/labels";
import {
  ORIGINAL_RELEASE_DATE_FORMAT_ERROR,
  parseOriginalReleaseDate,
} from "@/lib/original-release-date";
import { assertTranslationLanguageChangeAllowed } from "@/lib/server/db/relations";
import { normalizeSha256, sha256Hex } from "@/lib/server/crypto/sha256";
import { chunkArray } from "@/lib/server/db/chunks";
import {
  parseCharacterCreditSelection,
  prepareWorkCharacterStatements,
} from "@/lib/server/db/characters";
import { getD1 } from "@/lib/server/db/d1";
import type { ImportJobRow } from "@/lib/server/db/import-jobs";
import type { ArchiveUser } from "@/lib/server/db/users";
import { putManifest } from "@/lib/server/storage/archive-bucket";
import {
  validateCorePackMetadata,
  validateCorePackReferences,
  type CorePackMetadata,
} from "@/lib/server/storage/core-pack-validation";
import { HttpError } from "@/lib/server/http/json";
import { normalizeHttpUrl } from "@/lib/server/http/safe-url";
import {
  ensureCharacterFaceSheets,
} from "@/lib/server/storage/character-portraits";
import { assertSingleDownloadLink } from "@/lib/server/db/work-distribution";

export type CommitArchiveImportInput = {
  job: ImportJobRow;
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

type BlobMetadata = {
  sha256: string;
  sizeBytes: number;
};

type ArchiveObjectLedger = {
  blobs: Map<string, BlobMetadata>;
  corePacks: Map<string, CorePackMetadata>;
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
  const job = input.job;
  if (job.status !== "committing") {
    throw new HttpError(409, "导入任务尚未进入提交阶段");
  }

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

  const sourceManifest = sourceManifestFromArchive(manifest);
  const sourceManifestSha256 = await archiveSourceManifestSha256(sourceManifest);
  if (
    !job.source_manifest_sha256 ||
    job.source_manifest_sha256 !== sourceManifestSha256
  ) {
    throw new HttpError(409, "游戏文件尚未完成服务端校验，请重新上传");
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
  const objectLedger = await loadArchiveObjectLedger(allBlobHashes, corePackHashes);
  const missingBlobs = allBlobHashes.filter(
    (sha256) => !objectLedger.blobs.has(sha256),
  );
  const missingCorePacks = corePackHashes.filter(
    (sha256) => !objectLedger.corePacks.has(sha256),
  );

  if (missingBlobs.length > 0 || missingCorePacks.length > 0) {
    throw new HttpError(
      409,
      `Commit blocked by missing objects: ${missingBlobs.length} blobs, ${missingCorePacks.length} core packs`,
    );
  }

  validateBlobReferences(manifest, objectLedger.blobs);
  const faceSheetHashes = (metadata.characters ?? []).flatMap((credit) => [
    ...credit.faceSheetBlobSha256s,
    ...(credit.portrait ? [credit.portrait.blobSha256] : []),
  ]);
  await ensureCharacterFaceSheets(faceSheetHashes, input.user.id);
  validateCorePackMetadata(manifest, objectLedger.corePacks);
  const workId = await resolveTargetWork(
    metadata,
    input.user,
    job.work_id,
    job.id,
  );
  if (metadata.target.mode === "update") {
    const preserved = await getD1()
      .prepare(
        `SELECT extra_json FROM works WHERE id=? LIMIT 1`,
      )
      .bind(workId)
      .first<{
        extra_json: string;
      }>();
    if (preserved) {
      metadata = {
        ...metadata,
        game: {
          ...metadata.game,
          extra: {
            ...parseJsonObject(preserved.extra_json),
            ...metadata.game.extra,
          },
        },
      };
    }
  }
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

  await writeArchiveObjectLinks({
    archiveVersionId,
    blobHashes,
    corePacks: corePackHashes.map((sha256) => objectLedger.corePacks.get(sha256)!),
  });
  await finalizeArchiveCommit({
    importJobId: job.id,
    workId,
    archiveVersionId,
    manifest,
    metadata,
    missingBlobCount: missingBlobs.length,
    missingCorePackCount: missingCorePacks.length,
    excludedFileTypes: input.excludedFileTypes,
    actorUserId: input.user.id,
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

export async function verifyArchiveSourceManifest(
  manifest: ArchiveSourceManifest,
): Promise<string> {
  validateArchiveSourceManifest(manifest);
  const blobHashes = unique(
    manifest.files.flatMap((file) =>
      file.storage.kind === "blob"
        ? [normalizeSha256(file.storage.blobSha256)]
        : [],
    ),
  );
  const corePackHashes = manifest.corePacks.map((corePack) =>
    normalizeSha256(corePack.sha256),
  );
  const objectLedger = await loadArchiveObjectLedger(blobHashes, corePackHashes);
  const missingBlobs = blobHashes.filter(
    (sha256) => !objectLedger.blobs.has(sha256),
  );
  const missingCorePacks = corePackHashes.filter(
    (sha256) => !objectLedger.corePacks.has(sha256),
  );
  if (missingBlobs.length > 0 || missingCorePacks.length > 0) {
    throw new HttpError(
      409,
      `文件上传尚未完成：缺少 ${missingBlobs.length} 个文件对象和 ${missingCorePacks.length} 个公共文件包`,
    );
  }

  validateBlobReferences(manifest, objectLedger.blobs);
  await validateCorePackReferences(manifest, objectLedger.corePacks);
  return archiveSourceManifestSha256(manifest);
}

function sourceManifestFromArchive(
  manifest: ArchiveManifest,
): ArchiveSourceManifest {
  return {
    schema: manifest.schema,
    archiveVersion: {
      filePolicyVersion: manifest.archiveVersion.filePolicyVersion,
      packerVersion: manifest.archiveVersion.packerVersion,
      sourceType: manifest.archiveVersion.sourceType,
      sourceFileCount: manifest.archiveVersion.sourceFileCount,
      sourceSize: manifest.archiveVersion.sourceSize,
      includedFileCount: manifest.archiveVersion.includedFileCount,
      includedSize: manifest.archiveVersion.includedSize,
      excludedFileCount: manifest.archiveVersion.excludedFileCount,
      excludedSize: manifest.archiveVersion.excludedSize,
    },
    corePacks: manifest.corePacks,
    files: manifest.files,
  };
}

async function archiveSourceManifestSha256(
  manifest: ArchiveSourceManifest,
): Promise<string> {
  return sha256Hex(
    new TextEncoder().encode(stableJson(manifest)).buffer,
  );
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Source manifest is not JSON-safe");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

function validateBlobReferences(
  manifest: Pick<ArchiveManifest, "files">,
  blobs: ReadonlyMap<string, BlobMetadata>,
): void {
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
  for (const [sha256, expectedSize] of expected) {
    const blob = blobs.get(sha256);
    if (!blob) throw new HttpError(409, `Blob record is missing: ${sha256}`);
    if (blob.sizeBytes !== expectedSize) {
      throw new HttpError(400, `Blob metadata does not match manifest: ${sha256}`);
    }
  }
}

async function loadArchiveObjectLedger(
  blobHashes: string[],
  corePackHashes: string[],
): Promise<ArchiveObjectLedger> {
  const database = getD1();
  const queries: Array<{
    kind: "blob" | "core_pack";
    statement: D1PreparedStatement;
  }> = [];
  for (const chunk of chunkArray(unique(blobHashes), 100)) {
    queries.push({
      kind: "blob",
      statement: database
        .prepare(
          `SELECT sha256,size_bytes
           FROM blobs
           WHERE status='active' AND sha256 IN (${chunk.map(() => "?").join(",")})`,
        )
        .bind(...chunk),
    });
  }
  for (const chunk of chunkArray(unique(corePackHashes), 100)) {
    queries.push({
      kind: "core_pack",
      statement: database
        .prepare(
          `SELECT id,sha256,size_bytes,uncompressed_size_bytes,file_count
           FROM core_packs
           WHERE status='active' AND sha256 IN (${chunk.map(() => "?").join(",")})`,
        )
        .bind(...chunk),
    });
  }
  const ledger: ArchiveObjectLedger = { blobs: new Map(), corePacks: new Map() };
  if (queries.length === 0) return ledger;
  const results = await database.batch(queries.map((query) => query.statement));
  results.forEach((result, index) => {
    if (queries[index].kind === "blob") {
      for (const row of (result.results ?? []) as Array<{ sha256: string; size_bytes: number }>) {
        ledger.blobs.set(row.sha256, { sha256: row.sha256, sizeBytes: row.size_bytes });
      }
      return;
    }
    for (const row of (result.results ?? []) as Array<{
      id: number;
      sha256: string;
      size_bytes: number;
      uncompressed_size_bytes: number;
      file_count: number;
    }>) {
      ledger.corePacks.set(row.sha256, {
        id: row.id,
        sha256: row.sha256,
        sizeBytes: row.size_bytes,
        uncompressedSizeBytes: row.uncompressed_size_bytes,
        fileCount: row.file_count,
      });
    }
  });
  return ledger;
}

function validateManifest(
  manifest: ArchiveManifest,
  metadata: ArchiveCommitMetadata,
): void {
  validateArchiveSourceManifest(sourceManifestFromArchive(manifest));

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

  if (manifest.game.isTranslation !== metadata.game.isTranslation) {
    throw new Error("Manifest game translation declaration does not match metadata");
  }

  const snapshotFields: Array<[unknown, unknown, string]> = [
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
  ];
  for (const [manifestValue, metadataValue, field] of snapshotFields) {
    if (manifestValue !== metadataValue) {
      throw new Error(`Manifest archive ${field} does not match metadata`);
    }
  }

  if (!isSupportedLanguage(metadata.game.language)) {
    throw new Error("Unsupported game language");
  }
}

function validateArchiveSourceManifest(manifest: ArchiveSourceManifest): void {
  if (manifest.schema !== "viprpg-archive.manifest.v1") {
    throw new Error("Unsupported manifest schema");
  }
  if (manifest.archiveVersion.filePolicyVersion !== FILE_POLICY_VERSION) {
    throw new Error("Unsupported file policy version");
  }
  if (manifest.archiveVersion.packerVersion !== PACKER_VERSION) {
    throw new Error("Unsupported packer version");
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
      assertCanonicalSha256(file.storage.blobSha256, `blob hash: ${file.path}`);
      if (file.sha256 !== file.storage.blobSha256) {
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

  const isBrowserUpload =
    manifest.archiveVersion.sourceType === "browser_folder" ||
    manifest.archiveVersion.sourceType === "browser_zip";
  if (
    isBrowserUpload &&
    !manifest.files.some((file) => file.path.toLowerCase() === "rpg_rt.lmt")
  ) {
    throw new Error("游戏根目录缺少 RPG_RT.lmt");
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

export function parseArchiveSourceManifest(value: unknown): ArchiveSourceManifest {
  if (
    !isRecord(value) ||
    !isRecord(value.archiveVersion) ||
    !Array.isArray(value.corePacks) ||
    !Array.isArray(value.files)
  ) {
    throw new HttpError(400, "Source manifest structure is invalid");
  }
  if (value.schema !== "viprpg-archive.manifest.v1") {
    throw new HttpError(400, "Source manifest schema is invalid");
  }

  const archiveVersion = value.archiveVersion;
  if (
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
    throw new HttpError(400, "Source manifest archive fields are invalid");
  }
  for (const corePack of value.corePacks) {
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
      throw new HttpError(400, "Source manifest core pack fields are invalid");
    }
  }
  for (const file of value.files) {
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
      throw new HttpError(400, "Source manifest file fields are invalid");
    }
    if (file.storage.kind === "blob") {
      if (typeof file.storage.blobSha256 !== "string")
        throw new HttpError(400, "Source manifest blob reference is invalid");
    } else if (file.storage.kind === "core_pack") {
      if (
        typeof file.storage.packId !== "string" ||
        typeof file.storage.entry !== "string"
      )
        throw new HttpError(400, "Source manifest core pack reference is invalid");
    } else {
      throw new HttpError(400, "Source manifest storage kind is invalid");
    }
  }

  return value as unknown as ArchiveSourceManifest;
}

function parseManifestJson(manifestJson: string): ArchiveManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    throw new HttpError(400, "Manifest JSON is invalid");
  }

  parseArchiveSourceManifest(parsed);
  if (!isRecord(parsed) || !isRecord(parsed.game)) {
    throw new HttpError(400, "Manifest structure is invalid");
  }
  const game = parsed.game;
  if (
    typeof game.originalTitle !== "string" ||
    (game.chineseTitle !== null && typeof game.chineseTitle !== "string") ||
    typeof game.language !== "string" ||
    typeof game.isOriginal !== "boolean" ||
    typeof game.isTranslation !== "boolean"
  ) {
    throw new HttpError(400, "Manifest game fields are invalid");
  }
  const fullArchiveVersion = parsed.archiveVersion;
  if (
    !isRecord(fullArchiveVersion) ||
    !isNullableString(fullArchiveVersion.sourceName) ||
    !isNullableString(fullArchiveVersion.sourceUrl) ||
    typeof fullArchiveVersion.createdAt !== "string"
  ) {
    throw new HttpError(400, "Manifest archive fields are invalid");
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
      "rpg_maker_2003_maniac",
      "rpg_maker_xp",
      "rpg_maker_vx",
      "rpg_maker_vx_ace",
      "rpg_maker_mv",
      "rpg_maker_mz",
      "rpg_maker_unite",
      "other",
    ] as const) ||
    typeof game.isOriginal !== "boolean" ||
    typeof game.isTranslation !== "boolean" ||
    typeof game.language !== "string" ||
      !isEnum(game.status, ["processing", "published", "hidden"] as const) ||
    !isRecord(game.extra) ||
    !Array.isArray(game.browsingImageBlobSha256s)
  ) {
    throw new HttpError(400, "Upload metadata game fields are invalid");
  }
  if (!isLanguageCode(game.language)) {
    throw new HttpError(400, "Unsupported game language");
  }
  const releaseDate = parseOriginalReleaseDate(game.originalReleaseDate);
  if (
    !releaseDate ||
    releaseDate.precision !== game.originalReleasePrecision
  ) {
    throw new HttpError(400, ORIGINAL_RELEASE_DATE_FORMAT_ERROR);
  }
  if (!isArchiveEngineFamily(game.engineFamily)) {
    throw new HttpError(400, "非 RPG Maker 2000/2003 系游戏不能通过归档上传");
  }
  if (game.isOriginal && game.isTranslation) {
    throw new HttpError(400, "原创声明与翻译声明不能同时选择");
  }

  if (
    !isNullableString(archiveVersion.sourceName) ||
    !isNullableString(archiveVersion.sourceUrl)
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
  if (target.mode === "create" && browsingImageBlobSha256s.length === 0) {
    throw new HttpError(400, "新建游戏必须提供封面图");
  }
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
        ...parseCharacterCreditSelection({
          selection: character.selection,
          portrait: character.portrait,
          faceSheetBlobSha256s: character.faceSheetBlobSha256s,
        }),
        roleKey: character.roleKey,
        spoilerLevel: character.spoilerLevel,
        sortOrder: character.sortOrder ?? index + 1,
        notes: character.notes?.trim() || null,
      };
    });

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
        name: normalizeCreatorName(creator.name),
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
        creatorName: normalizeCreatorName(staff.creatorName),
        roleKey: staff.roleKey,
        roleLabel: staff.roleLabel?.trim() || null,
        notes: staff.notes?.trim() || null,
      };
    })
    .filter((staff) => staff.creatorName)
    .filter((staff) => game.isTranslation || staff.roleKey !== "translator")
    .filter(uniqueStaffEntry());

  if (
    game.isTranslation &&
    !workStaff.some((staff) => staff.roleKey === "translator")
  ) {
    throw new HttpError(400, "翻译作品必须填写译者");
  }

  const referencedCreatorNames = new Set(
    workStaff.map((staff) => creatorNameKey(staff.creatorName)),
  );
  const seenCreatorNames = new Set<string>();
  const effectiveCreators = creators.filter((creator) => {
    const key = creatorNameKey(creator.name);
    if (!referencedCreatorNames.has(key) || seenCreatorNames.has(key)) return false;
    seenCreatorNames.add(key);
    return true;
  });
  if (
    [...referencedCreatorNames].some((name) => !seenCreatorNames.has(name))
  ) {
    throw new HttpError(400, "作品职员缺少对应的 Creator");
  }

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
  assertSingleDownloadLink(workLinks);
  if (workLinks.some((link) => link.linkType === "download_page")) {
    throw new HttpError(400, "本站归档作品不能设置外部下载地址");
  }

  if (!game.originalTitle.trim()) {
    throw new HttpError(400, "游戏原名不能为空");
  }

  return {
    ...metadata,
    game: {
      ...metadata.game,
      originalTitle: game.originalTitle.trim(),
      chineseTitle: normalizeNullableWorkText(game.chineseTitle),
      description: normalizeNullableWorkText(game.description),
      originalReleaseDate: releaseDate.value,
      originalReleasePrecision: releaseDate.precision,
      language: game.language.trim(),
      browsingImageBlobSha256s,
    },
    target: { mode: target.mode, workId: target.workId },
    archiveVersion: {
      ...metadata.archiveVersion,
      sourceName: archiveVersion.sourceName?.trim() || null,
      sourceUrl: normalizeHttpUrl(archiveVersion.sourceUrl, "来源网址"),
    },
    workTitles,
    characters,
    creators: effectiveCreators,
    workStaff,
    tags,
    externalLinks: { work: workLinks },
  };
}

function normalizeNullableWorkText(value: string | null): string | null {
  return value === null ? null : value.trim();
}

function metadataImageBlobHashes(metadata: ArchiveCommitMetadata): string[] {
  return unique(
    [
      ...metadata.game.browsingImageBlobSha256s,
      ...(metadata.characters ?? []).flatMap((credit) =>
        [
          ...credit.faceSheetBlobSha256s,
          ...(credit.portrait ? [credit.portrait.blobSha256] : []),
        ],
      ),
    ],
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
    if (existingJobWorkId !== metadata.target.workId) {
      throw new HttpError(409, "导入任务与更新目标不匹配");
    }
    if (
      !metadata.target.workId ||
      !(await canEditWork(metadata.target.workId, user))
    ) {
      throw new HttpError(403, "无权更新此游戏");
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
        `SELECT original_title,language,is_original,is_translation,status FROM works WHERE id=? LIMIT 1`,
      )
      .bind(existingJobWorkId)
      .first<{
        original_title: string;
        language: string;
        is_original: number;
        is_translation: number;
        status: string;
      }>();
    if (
      !identity ||
      identity.status === "deleted" ||
      identity.original_title !== game.originalTitle ||
      identity.language !== game.language ||
      identity.is_original !== (game.isOriginal ? 1 : 0) ||
      identity.is_translation !== (game.isTranslation ? 1 : 0)
    )
      throw new HttpError(409, "导入任务的游戏身份或语言属性不匹配");
    return existingJobWorkId;
  }

  const database = getD1();
  const result = await database
    .prepare(
      `INSERT INTO works (
        original_title, chinese_title, description, is_original, is_translation, language,
        original_release_date, original_release_precision, engine_family, status, extra_json,
        created_by_user_id, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, NULL)`,
    )
    .bind(
      game.originalTitle,
      game.chineseTitle,
      game.description,
      game.isOriginal ? 1 : 0,
      game.isTranslation ? 1 : 0,
      game.language,
      game.originalReleaseDate,
      game.originalReleasePrecision,
      game.engineFamily,
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
      .prepare(`DELETE FROM works WHERE id = ? AND status = 'processing'`)
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

  // A failed commit can leave processing state after the immutable row is inserted.
  // Only its uploader may resume it; every published row stays immutable.
  if (row.status === "processing" && row.uploader_id === uploaderId) {
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
  actorUserId: number;
}): Promise<void> {
  const database = getD1();
  const game = input.metadata.game;
  const characters = input.metadata.characters ?? [];
  const statements: D1PreparedStatement[] = [];
  const before = await database
    .prepare(`SELECT original_title,status FROM works WHERE id=? LIMIT 1`)
    .bind(input.workId)
    .first<{ original_title: string; status: string }>();

  statements.push(
    database
      .prepare(
      `UPDATE works
       SET original_title = ?,
         chinese_title = ?,
         description = ?,
         is_original = ?,
         is_translation = ?,
         language = ?,
         original_release_date = ?,
         original_release_precision = ?,
         engine_family = ?,
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
        game.originalTitle,
        game.chineseTitle,
        game.description,
        game.isOriginal ? 1 : 0,
        game.isTranslation ? 1 : 0,
        game.language,
        game.originalReleaseDate,
        game.originalReleasePrecision,
        game.engineFamily,
        game.status,
        jsonText(game.extra),
        game.status,
        input.workId,
      ),
  );

  statements.push(
    database
      .prepare(`DELETE FROM work_titles WHERE work_id = ?`)
      .bind(input.workId),
  );
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
  statements.push(
    database
      .prepare(`DELETE FROM work_staff WHERE work_id = ? AND role_key IN ('author', 'translator')`)
      .bind(input.workId),
  );
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

  statements.push(
    ...(await prepareWorkCharacterStatements({
      database,
      workId: input.workId,
      credits: characters,
      source: "user",
      actorUserId: input.actorUserId,
      requirePortrait: true,
    })),
  );

  for (const tag of input.metadata.tags) {
    statements.push(
      database
        .prepare(
          `INSERT OR IGNORE INTO tags (name, namespace) VALUES (?, 'other')`,
        )
        .bind(tag),
    );
  }
  statements.push(
    database
      .prepare(
        `DELETE FROM work_tags WHERE work_id = ? AND source = 'uploader'`,
      )
      .bind(input.workId),
  );
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

  const links = input.metadata.externalLinks.work;
  if (input.metadata.target.mode === "update") {
    statements.push(
      database
        .prepare(
          `DELETE FROM work_external_links
           WHERE work_id = ? AND link_type IN ('download_page', 'source')`,
        )
        .bind(input.workId),
    );
  }
  if (links.length > 0) {
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
  for (const sha256 of browsingImages) {
    statements.push(
      database
        .prepare(
          `INSERT OR IGNORE INTO media_assets (blob_sha256, kind) VALUES (?, 'preview')`,
        )
        .bind(sha256),
    );
  }
  statements.push(
    database
      .prepare(
        `DELETE FROM work_media_assets
           WHERE work_id = ?
             AND media_asset_id IN (SELECT id FROM media_assets WHERE kind = 'preview')`,
      )
      .bind(input.workId),
  );
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
          index === 0 ? 1 : 0,
          sha256,
        ),
    );
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
          source_name = COALESCE(?, source_name),
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
        `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
         SELECT ij.uploader_id,u.email,'archive_work_commit',?
         FROM import_jobs ij
         LEFT JOIN users u ON u.id=ij.uploader_id
         WHERE ij.id=?`,
      )
      .bind(
        JSON.stringify({
          workId: input.workId,
          archiveVersionId: input.archiveVersionId,
          mode: input.metadata.target.mode,
          oldOriginalTitle: before?.original_title ?? null,
          newOriginalTitle: game.originalTitle,
          oldStatus: before?.status ?? null,
          newStatus: game.status,
        }),
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

  const result = await getD1()
    .prepare(
      `INSERT INTO archive_versions (
        work_id,
        source_name,
        source_url,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'processing')`,
    )
    .bind(
      input.workId,
      input.metadata.archiveVersion.sourceName,
      input.metadata.archiveVersion.sourceUrl,
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
  const archiveVersionId = Number(result.meta.last_row_id);
  if (!Number.isSafeInteger(archiveVersionId) || archiveVersionId <= 0) {
    throw new Error("Archive version was not created");
  }
  return archiveVersionId;
}

async function writeArchiveObjectLinks(input: {
  archiveVersionId: number;
  blobHashes: string[],
  corePacks: CorePackMetadata[];
}): Promise<void> {
  const database = getD1();
  const statements: D1PreparedStatement[] = [];
  const blobHashes = unique(input.blobHashes);
  const corePacks = new Map(input.corePacks.map((pack) => [pack.sha256, pack]));
  for (const chunk of chunkArray(blobHashes, 50)) {
    statements.push(
      database.prepare(
        `UPDATE blobs
         SET first_seen_archive_version_id=COALESCE(first_seen_archive_version_id,?)
         WHERE status='active' AND sha256 IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(input.archiveVersionId, ...chunk),
    );
  }
  for (const chunk of chunkArray([...corePacks.keys()], 50)) {
    statements.push(
      database.prepare(
        `UPDATE core_packs
         SET first_seen_archive_version_id=COALESCE(first_seen_archive_version_id,?)
         WHERE status='active' AND sha256 IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(input.archiveVersionId, ...chunk),
    );
  }
  for (const chunk of chunkArray(blobHashes, 50)) {
    const placeholders = chunk.map(() => "(?, ?)").join(", ");
    const values = chunk.flatMap((sha256) => [input.archiveVersionId, sha256]);
    statements.push(
      database.prepare(
        `INSERT OR IGNORE INTO archive_version_blob_refs (
          archive_version_id,
          blob_sha256
        ) VALUES ${placeholders}`,
      )
      .bind(...values),
    );
  }
  const corePackIds = uniqueNumbers([...corePacks.values()].map((pack) => pack.id));
  for (const chunk of chunkArray(corePackIds, 50)) {
    const placeholders = chunk.map(() => "(?, ?)").join(", ");
    const values = chunk.flatMap((corePackId) => [
      input.archiveVersionId,
      corePackId,
    ]);
    statements.push(
      database.prepare(
        `INSERT OR IGNORE INTO archive_version_core_pack_refs (
          archive_version_id,
          core_pack_id
        ) VALUES ${placeholders}`,
      )
      .bind(...values),
    );
  }
  if (statements.length) await database.batch(statements);
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
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function creatorNameKey(value: string): string {
  return value.toLocaleLowerCase();
}

function uniqueStaffEntry(): (
  staff: ArchiveCommitMetadata["workStaff"][number],
) => boolean {
  const seen = new Set<string>();
  return (staff) => {
    const key = `${staff.roleKey}\u0000${creatorNameKey(staff.creatorName)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
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
