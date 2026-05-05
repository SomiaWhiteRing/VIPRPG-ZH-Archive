import { FILE_POLICY_VERSION, PACKER_VERSION } from "@/lib/archive/file-policy";
import type {
  ArchiveCommitMetadata,
  ArchiveManifest,
  ExcludedFileTypeSummary,
} from "@/lib/archive/manifest";
import { shouldSkipWebPlayLocalWrite } from "@/lib/archive/web-play-local-policy";
import { normalizeSha256, sha256Hex } from "@/lib/server/crypto/sha256";
import { findExistingObjects } from "@/lib/server/db/archive-objects";
import { getD1 } from "@/lib/server/db/d1";
import { assertImportJobAccess, requiredImportJob } from "@/lib/server/db/import-jobs";
import type { ArchiveUser } from "@/lib/server/db/users";
import { putManifest } from "@/lib/server/storage/archive-bucket";
import { manifestKey } from "@/lib/server/storage/archive-keys";

export type CommitArchiveImportInput = {
  importJobId: number;
  user: ArchiveUser;
  localTaskId: string;
  manifestSha256: string;
  manifestJson: string;
  metadata: ArchiveCommitMetadata;
  excludedFileTypes: ExcludedFileTypeSummary[];
};

export type CommitArchiveImportResult = {
  workId: number;
  releaseId: number;
  archiveVersionId: number;
  manifestSha256: string;
  manifestR2Key: string;
  fileCount: number;
  uniqueBlobCount: number;
  corePackCount: number;
  alreadyExisted: boolean;
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
  total_files: number;
};

type ArchiveVersionLabelRow = {
  id: number;
  status: string;
  manifest_sha256: string;
};

export async function commitArchiveImport(
  input: CommitArchiveImportInput,
): Promise<CommitArchiveImportResult> {
  const job = await requiredImportJob(input.importJobId);
  assertImportJobAccess(job, input.user);

  if (job.status === "canceled") {
    throw new Error("Import job is canceled");
  }

  const manifestSha256 = normalizeSha256(input.manifestSha256);
  const actualManifestSha256 = await sha256Hex(
    new TextEncoder().encode(input.manifestJson).buffer,
  );

  if (actualManifestSha256 !== manifestSha256) {
    throw new Error("Manifest SHA-256 mismatch");
  }

  const manifest = JSON.parse(input.manifestJson) as ArchiveManifest;
  const metadata = normalizeMetadata(input.metadata);
  validateManifest(manifest, metadata);

  const blobHashes = unique(
    manifest.files
      .filter((file) => file.storage.kind === "blob")
      .map((file) => normalizeSha256(file.storage.kind === "blob" ? file.storage.blobSha256 : "")),
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
  const missingBlobs = allBlobHashes.filter((sha256) => !existing.blobs.has(sha256));
  const missingCorePacks = corePackHashes.filter(
    (sha256) => !existing.corePacks.has(sha256),
  );

  if (missingBlobs.length > 0 || missingCorePacks.length > 0) {
    throw new Error(
      `Commit blocked by missing objects: ${missingBlobs.length} blobs, ${missingCorePacks.length} core packs`,
    );
  }

  const manifestR2Key = manifestKey(manifestSha256);

  await putManifest(manifestSha256, input.manifestJson);

  const workId = await upsertWork(metadata, input.user.id);
  await insertWorkTitles(workId, metadata);
  await upsertCreators(metadata);
  await insertWorkStaff(workId, metadata);
  await insertWorkCharacters(workId, metadata);
  await insertWorkTags(workId, metadata.tags);
  await insertWorkExternalLinks(workId, metadata);
  await insertWorkMediaAssets(workId, metadata);

  const releaseId = await upsertRelease(workId, metadata, input.user.id);
  await insertReleaseStaff(releaseId, metadata);
  await insertReleaseTags(releaseId, metadata.tags);
  await insertReleaseExternalLinks(releaseId, metadata);

  const existingArchiveVersion = await findReusableArchiveVersionByManifest(
    releaseId,
    metadata.archiveVersion.key,
    manifestSha256,
    manifest.files.length,
  );

  if (existingArchiveVersion) {
    await publishExistingArchiveVersion({
      importJobId: input.importJobId,
      workId,
      releaseId,
      archiveKey: metadata.archiveVersion.key,
      archiveVersionId: existingArchiveVersion,
      manifestSha256,
      excludedFileTypes: input.excludedFileTypes,
    });

    return {
      workId,
      releaseId,
      archiveVersionId: existingArchiveVersion,
      manifestSha256,
      manifestR2Key,
      fileCount: manifest.files.length,
      uniqueBlobCount: blobHashes.length,
      corePackCount: corePackHashes.length,
      alreadyExisted: true,
    };
  }

  await deleteReplaceableArchiveVersionByLabel(
    releaseId,
    metadata.archiveVersion.key,
    metadata.archiveVersion.label,
    manifestSha256,
  );

  await getD1()
    .prepare(`UPDATE archive_versions SET is_current = 0 WHERE release_id = ? AND archive_key = ?`)
    .bind(releaseId, metadata.archiveVersion.key)
    .run();

  const archiveVersionId = await insertArchiveVersion({
    releaseId,
    manifest,
    metadata,
    manifestSha256,
    manifestR2Key,
    uniqueBlobSizeBytes: sumUniqueBlobBytes(manifest),
    corePackSizeBytes: manifest.corePacks.reduce((sum, item) => sum + item.size, 0),
    estimatedR2GetCount: corePackHashes.length + blobHashes.length,
    uploaderId: input.user.id,
  });

  const corePackIds = await loadCorePackIds(corePackHashes);
  await updateObjectFirstSeen(archiveVersionId, blobHashes, corePackHashes);
  await insertArchiveVersionRefs({
    archiveVersionId,
    manifest,
    corePackIds,
  });
  await getD1()
    .prepare(
      `UPDATE archive_versions
      SET status = 'published',
        is_current = 1,
        published_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(archiveVersionId)
    .run();
  await completeImportJob({
    importJobId: input.importJobId,
    workId,
    releaseId,
    archiveVersionId,
    manifest,
    filePolicyVersion: manifest.archiveVersion.filePolicyVersion,
    missingBlobCount: blobHashes.length,
    missingCorePackCount: corePackHashes.length,
  });
  await insertExcludedFileTypes(input.importJobId, input.excludedFileTypes);

  return {
    workId,
    releaseId,
    archiveVersionId,
    manifestSha256,
    manifestR2Key,
    fileCount: manifest.files.length,
    uniqueBlobCount: blobHashes.length,
    corePackCount: corePackHashes.length,
    alreadyExisted: false,
  };
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

  if (manifest.work.slug !== metadata.work.slug) {
    throw new Error("Manifest work slug does not match metadata");
  }

  if (manifest.work.originalTitle !== metadata.work.originalTitle) {
    throw new Error("Manifest work original title does not match metadata");
  }

  if (manifest.release.label !== metadata.release.label) {
    throw new Error("Manifest release label does not match metadata");
  }

  if (manifest.release.key !== metadata.release.key) {
    throw new Error("Manifest release key does not match metadata");
  }

  if (!metadata.release.key || !metadata.release.variantLabel) {
    throw new Error("Release key and variant label are required");
  }

  if (
    manifest.archiveVersion.key !== metadata.archiveVersion.key ||
    manifest.archiveVersion.label !== metadata.archiveVersion.label
  ) {
    throw new Error("Manifest archive version identity does not match metadata");
  }

  if (!metadata.archiveVersion.key || !metadata.archiveVersion.language) {
    throw new Error("Archive version key and language are required");
  }

  if (manifest.corePacks.length !== 1) {
    throw new Error("Exactly one core pack is required");
  }

  const paths = new Set<string>();

  for (const file of manifest.files) {
    validateManifestPath(file.path);
    normalizeSha256(file.sha256);
    validateCrc32(file.crc32, file.path);

    if (paths.has(file.path)) {
      throw new Error(`Duplicate file path: ${file.path}`);
    }

    paths.add(file.path);

    if (file.storage.kind === "blob") {
      normalizeSha256(file.storage.blobSha256);
    } else {
      if (file.storage.packId !== "core-main") {
        throw new Error("Unsupported core pack id");
      }

      validateManifestPath(file.storage.entry);
    }
  }
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

function normalizeMetadata(metadata: ArchiveCommitMetadata): ArchiveCommitMetadata {
  const tags = unique(metadata.tags.map((tag) => tag.trim()).filter(Boolean));
  const browsingImageBlobSha256s = unique(
    metadata.work.browsingImageBlobSha256s
      .map((sha256) => sha256.trim())
      .filter(Boolean)
      .map((sha256) => normalizeSha256(sha256)),
  );

  return {
    ...metadata,
    work: {
      ...metadata.work,
      slug: metadata.work.slug.trim(),
      originalTitle: metadata.work.originalTitle.trim(),
      chineseTitle: metadata.work.chineseTitle?.trim() || null,
      sortTitle: metadata.work.sortTitle?.trim() || null,
      iconBlobSha256: metadata.work.iconBlobSha256
        ? normalizeSha256(metadata.work.iconBlobSha256)
        : null,
      thumbnailBlobSha256: metadata.work.thumbnailBlobSha256
        ? normalizeSha256(metadata.work.thumbnailBlobSha256)
        : null,
      browsingImageBlobSha256s,
    },
    release: {
      ...metadata.release,
      key: metadata.release.key.trim(),
      label: metadata.release.label.trim(),
      variantLabel: metadata.release.variantLabel.trim(),
    },
    archiveVersion: {
      ...metadata.archiveVersion,
      key: metadata.archiveVersion.key.trim(),
      label: metadata.archiveVersion.label.trim(),
      variantLabel: metadata.archiveVersion.variantLabel.trim(),
      language: metadata.archiveVersion.language.trim(),
    },
    tags,
    workTitles: metadata.workTitles
      .map((title) => ({
        ...title,
        title: title.title.trim(),
        language: title.language?.trim() || null,
      }))
      .filter((title) => title.title.trim()),
    characters: (metadata.characters ?? [])
      .map((character, index) => ({
        ...character,
        name: character.name.trim(),
        originalName: character.originalName?.trim() || null,
        roleKey: character.roleKey || "supporting",
        spoilerLevel: Number.isSafeInteger(character.spoilerLevel)
          ? character.spoilerLevel
          : 0,
        sortOrder:
          character.sortOrder !== null && Number.isFinite(character.sortOrder)
            ? character.sortOrder
            : index + 1,
        notes: character.notes?.trim() || null,
      }))
      .filter((character) => character.name),
    creators: metadata.creators.filter((creator) => creator.slug.trim() && creator.name.trim()),
    workStaff: metadata.workStaff.filter((staff) => staff.creatorSlug.trim()),
    releaseStaff: metadata.releaseStaff.filter((staff) => staff.creatorSlug.trim()),
    externalLinks: {
      work: metadata.externalLinks.work.filter((link) => link.label.trim() && link.url.trim()),
      release: metadata.externalLinks.release.filter(
        (link) => link.label.trim() && link.url.trim(),
      ),
    },
  };
}

function metadataImageBlobHashes(metadata: ArchiveCommitMetadata): string[] {
  return unique(
    [
      metadata.work.iconBlobSha256,
      metadata.work.thumbnailBlobSha256,
      ...metadata.work.browsingImageBlobSha256s,
    ].filter((sha256): sha256 is string => Boolean(sha256)),
  );
}

async function upsertWork(
  metadata: ArchiveCommitMetadata,
  userId: number,
): Promise<number> {
  const work = metadata.work;

  await getD1()
    .prepare(
      `INSERT OR IGNORE INTO works (
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
        status,
        extra_json,
        created_by_user_id,
        published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
    )
    .bind(
      work.slug,
      work.originalTitle,
      work.chineseTitle,
      work.sortTitle,
      work.description,
      work.originalReleaseDate,
      work.originalReleasePrecision,
      work.engineFamily,
      work.engineDetail,
      work.usesManiacsPatch ? 1 : 0,
      work.iconBlobSha256,
      work.thumbnailBlobSha256,
      work.status,
      jsonText(work.extra),
      userId,
      work.status,
    )
    .run();

  await getD1()
    .prepare(
      `UPDATE works
      SET slug = ?,
        chinese_title = ?,
        sort_title = ?,
        description = ?,
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
      WHERE original_title = ?`,
    )
    .bind(
      work.slug,
      work.chineseTitle,
      work.sortTitle,
      work.description,
      work.originalReleaseDate,
      work.originalReleasePrecision,
      work.engineFamily,
      work.engineDetail,
      work.usesManiacsPatch ? 1 : 0,
      work.iconBlobSha256,
      work.thumbnailBlobSha256,
      work.status,
      jsonText(work.extra),
      work.status,
      work.originalTitle,
    )
    .run();

  return requiredId(`SELECT id FROM works WHERE original_title = ?`, [work.originalTitle]);
}

async function insertWorkTitles(
  workId: number,
  metadata: ArchiveCommitMetadata,
): Promise<void> {
  const titles = [
    ...metadata.workTitles,
  ];

  for (const title of titles) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO work_titles (
          work_id,
          title,
          language,
          title_type,
          is_searchable
        ) VALUES (?, ?, ?, ?, 1)`,
      )
      .bind(workId, title.title, title.language, title.titleType)
      .run();
  }
}

async function upsertRelease(
  workId: number,
  metadata: ArchiveCommitMetadata,
  userId: number,
): Promise<number> {
  const release = metadata.release;

  await getD1()
    .prepare(
      `INSERT OR IGNORE INTO releases (
        work_id,
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
        rights_notes,
        status,
        extra_json,
        created_by_user_id,
        published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
    )
    .bind(
      workId,
      release.key,
      release.label,
      release.baseVariant,
      release.variantLabel,
      release.type,
      release.releaseDate,
      release.releaseDatePrecision,
      release.sourceName,
      release.sourceUrl,
      release.executablePath,
      release.rightsNotes,
      release.status,
      jsonText(release.extra),
      userId,
      release.status,
    )
    .run();

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
        extra_json = ?,
        updated_at = CURRENT_TIMESTAMP,
        published_at = CASE
          WHEN ? = 'published' THEN COALESCE(published_at, CURRENT_TIMESTAMP)
          ELSE published_at
        END
      WHERE work_id = ?
        AND release_key = ?`,
    )
    .bind(
      release.label,
      release.baseVariant,
      release.variantLabel,
      release.type,
      release.releaseDate,
      release.releaseDatePrecision,
      release.sourceName,
      release.sourceUrl,
      release.executablePath,
      release.rightsNotes,
      release.status,
      jsonText(release.extra),
      release.status,
      workId,
      release.key,
    )
    .run();

  return requiredId(`SELECT id FROM releases WHERE work_id = ? AND release_key = ?`, [
    workId,
    release.key,
  ]);
}

async function upsertCreators(metadata: ArchiveCommitMetadata): Promise<void> {
  for (const creator of metadata.creators) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO creators (
          slug,
          name,
          original_name,
          website_url,
          extra_json
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        creator.slug,
        creator.name,
        creator.originalName,
        creator.websiteUrl,
        jsonText(creator.extra),
      )
      .run();

    await getD1()
      .prepare(
        `UPDATE creators
        SET name = ?,
          original_name = ?,
          website_url = ?,
          extra_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE slug = ?`,
      )
      .bind(
        creator.name,
        creator.originalName,
        creator.websiteUrl,
        jsonText(creator.extra),
        creator.slug,
      )
      .run();
  }
}

async function insertWorkStaff(
  workId: number,
  metadata: ArchiveCommitMetadata,
): Promise<void> {
  for (const staff of metadata.workStaff) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO work_staff (
          work_id,
          creator_id,
          role_key,
          role_label,
          notes
        ) VALUES (
          ?,
          (SELECT id FROM creators WHERE slug = ?),
          ?,
          ?,
          ?
        )`,
      )
      .bind(workId, staff.creatorSlug, staff.roleKey, staff.roleLabel, staff.notes)
      .run();
  }
}

async function insertWorkCharacters(
  workId: number,
  metadata: ArchiveCommitMetadata,
): Promise<void> {
  for (const character of metadata.characters ?? []) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO characters (
          slug,
          primary_name,
          original_name,
          extra_json
        ) VALUES (?, ?, ?, '{}')`,
      )
      .bind(characterSlug(character.name), character.name, character.originalName)
      .run();
    await getD1()
      .prepare(
        `UPDATE characters
        SET primary_name = ?,
          original_name = COALESCE(?, original_name),
          updated_at = CURRENT_TIMESTAMP
        WHERE slug = ?`,
      )
      .bind(character.name, character.originalName, characterSlug(character.name))
      .run();
    await getD1()
      .prepare(
        `INSERT OR REPLACE INTO work_characters (
          work_id,
          character_id,
          role_key,
          spoiler_level,
          sort_order,
          notes
        ) VALUES (
          ?,
          (SELECT id FROM characters WHERE slug = ?),
          ?,
          ?,
          ?,
          ?
        )`,
      )
      .bind(
        workId,
        characterSlug(character.name),
        character.roleKey,
        character.spoilerLevel,
        character.sortOrder,
        character.notes,
      )
      .run();
  }
}

async function insertReleaseStaff(
  releaseId: number,
  metadata: ArchiveCommitMetadata,
): Promise<void> {
  for (const staff of metadata.releaseStaff) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO release_staff (
          release_id,
          creator_id,
          role_key,
          role_label,
          notes
        ) VALUES (
          ?,
          (SELECT id FROM creators WHERE slug = ?),
          ?,
          ?,
          ?
        )`,
      )
      .bind(releaseId, staff.creatorSlug, staff.roleKey, staff.roleLabel, staff.notes)
      .run();
  }
}

async function insertWorkTags(workId: number, tags: string[]): Promise<void> {
  await upsertTags(tags);

  for (const tag of tags) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO work_tags (work_id, tag_id, source)
        VALUES (?, (SELECT id FROM tags WHERE slug = ?), 'uploader')`,
      )
      .bind(workId, tagSlug(tag))
      .run();
  }
}

async function insertReleaseTags(releaseId: number, tags: string[]): Promise<void> {
  await upsertTags(tags);

  for (const tag of tags) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO release_tags (release_id, tag_id, source)
        VALUES (?, (SELECT id FROM tags WHERE slug = ?), 'uploader')`,
      )
      .bind(releaseId, tagSlug(tag))
      .run();
  }
}

async function upsertTags(tags: string[]): Promise<void> {
  for (const tag of tags) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO tags (slug, name, namespace)
        VALUES (?, ?, 'other')`,
      )
      .bind(tagSlug(tag), tag)
      .run();
  }
}

async function insertWorkExternalLinks(
  workId: number,
  metadata: ArchiveCommitMetadata,
): Promise<void> {
  for (const link of metadata.externalLinks.work) {
    await getD1()
      .prepare(
        `INSERT INTO work_external_links (work_id, label, url, link_type)
        SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM work_external_links WHERE work_id = ? AND url = ?
        )`,
      )
      .bind(workId, link.label, link.url, link.linkType, workId, link.url)
      .run();
  }
}

async function insertWorkMediaAssets(
  workId: number,
  metadata: ArchiveCommitMetadata,
): Promise<void> {
  const browsingImages = metadata.work.browsingImageBlobSha256s;

  if (browsingImages.length === 0) {
    return;
  }

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

  for (const [index, sha256] of browsingImages.entries()) {
    const mediaAssetId = await ensureMediaAsset(sha256, "preview");
    await getD1()
      .prepare(
        `INSERT OR REPLACE INTO work_media_assets (
          work_id,
          media_asset_id,
          sort_order,
          is_primary
        ) VALUES (?, ?, ?, ?)`,
      )
      .bind(workId, mediaAssetId, index + 1, index === 0 ? 1 : 0)
      .run();
  }
}

async function ensureMediaAsset(sha256: string, kind: string): Promise<number> {
  const existing = await getD1()
    .prepare(`SELECT id FROM media_assets WHERE blob_sha256 = ? AND kind = ? LIMIT 1`)
    .bind(sha256, kind)
    .first<IdRow>();

  if (existing) {
    return existing.id;
  }

  await getD1()
    .prepare(
      `INSERT INTO media_assets (
        blob_sha256,
        kind
      ) VALUES (?, ?)`,
    )
    .bind(sha256, kind)
    .run();

  return requiredId(`SELECT id FROM media_assets WHERE blob_sha256 = ? AND kind = ?`, [
    sha256,
    kind,
  ]);
}

async function insertReleaseExternalLinks(
  releaseId: number,
  metadata: ArchiveCommitMetadata,
): Promise<void> {
  for (const link of metadata.externalLinks.release) {
    await getD1()
      .prepare(
        `INSERT INTO release_external_links (release_id, label, url, link_type)
        SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM release_external_links WHERE release_id = ? AND url = ?
        )`,
      )
      .bind(releaseId, link.label, link.url, link.linkType, releaseId, link.url)
      .run();
  }
}

async function findReusableArchiveVersionByManifest(
  releaseId: number,
  archiveKey: string,
  manifestSha256: string,
  expectedFileCount: number,
): Promise<number | null> {
  const row = await getD1()
    .prepare(
      `SELECT
        av.id,
        av.status,
        av.total_files
      FROM archive_versions av
      WHERE av.release_id = ?
        AND av.archive_key = ?
        AND av.manifest_sha256 = ?
      LIMIT 1`,
    )
    .bind(releaseId, archiveKey, manifestSha256)
    .first<ArchiveVersionLookupRow>();

  if (!row) {
    return null;
  }

  if (row.status === "published" && row.total_files === expectedFileCount) {
    return row.id;
  }

  await deleteArchiveVersionDraft(row.id);

  return null;
}

async function deleteReplaceableArchiveVersionByLabel(
  releaseId: number,
  archiveKey: string,
  archiveLabel: string,
  manifestSha256: string,
): Promise<void> {
  const row = await getD1()
    .prepare(
      `SELECT id, status, manifest_sha256
      FROM archive_versions
      WHERE release_id = ?
        AND archive_key = ?
        AND archive_label = ?
      LIMIT 1`,
    )
    .bind(releaseId, archiveKey, archiveLabel)
    .first<ArchiveVersionLabelRow>();

  if (!row) {
    return;
  }

  if (row.status === "draft") {
    await deleteArchiveVersionDraft(row.id);
    return;
  }

  if (row.status === "published" && row.manifest_sha256 === manifestSha256) {
    return;
  }

  throw new Error(`Archive label already exists for this release: ${archiveLabel}`);
}

async function deleteArchiveVersionDraft(archiveVersionId: number): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE blobs
      SET first_seen_archive_version_id = NULL
      WHERE first_seen_archive_version_id = ?`,
    )
    .bind(archiveVersionId)
    .run();
  await getD1()
    .prepare(
      `UPDATE core_packs
      SET first_seen_archive_version_id = NULL
      WHERE first_seen_archive_version_id = ?`,
    )
    .bind(archiveVersionId)
    .run();
  await deleteArchiveVersionRefs(archiveVersionId);
  await getD1()
    .prepare(`DELETE FROM archive_versions WHERE id = ?`)
    .bind(archiveVersionId)
    .run();
}

async function publishExistingArchiveVersion(input: {
  importJobId: number;
  workId: number;
  releaseId: number;
  archiveKey: string;
  archiveVersionId: number;
  manifestSha256: string;
  excludedFileTypes: ExcludedFileTypeSummary[];
}): Promise<void> {
  await getD1()
    .prepare(`UPDATE archive_versions SET is_current = 0 WHERE release_id = ? AND archive_key = ?`)
    .bind(input.releaseId, input.archiveKey)
    .run();
  await getD1()
    .prepare(
      `UPDATE archive_versions
      SET status = 'published',
        is_current = 1,
        published_at = COALESCE(published_at, CURRENT_TIMESTAMP)
      WHERE id = ?`,
    )
    .bind(input.archiveVersionId)
    .run();
  await getD1()
    .prepare(
      `UPDATE import_jobs
      SET work_id = ?,
        release_id = ?,
        archive_version_id = ?,
        status = 'completed',
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(input.workId, input.releaseId, input.archiveVersionId, input.importJobId)
    .run();
  await insertExcludedFileTypes(input.importJobId, input.excludedFileTypes);
}

async function insertArchiveVersion(input: {
  releaseId: number;
  manifest: ArchiveManifest;
  metadata: ArchiveCommitMetadata;
  manifestSha256: string;
  manifestR2Key: string;
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
        release_id,
        archive_key,
        archive_label,
        archive_variant_label,
        language,
        is_proofread,
        is_image_edited,
        manifest_sha256,
        manifest_r2_key,
        file_policy_version,
        packer_version,
        source_type,
        source_name,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'draft')`,
    )
    .bind(
      input.releaseId,
      input.metadata.archiveVersion.key,
      input.metadata.archiveVersion.label,
      input.metadata.archiveVersion.variantLabel,
      input.metadata.archiveVersion.language,
      input.metadata.archiveVersion.isProofread ? 1 : 0,
      input.metadata.archiveVersion.isImageEdited ? 1 : 0,
      input.manifestSha256,
      input.manifestR2Key,
      manifest.archiveVersion.filePolicyVersion,
      manifest.archiveVersion.packerVersion,
      manifest.archiveVersion.sourceType,
      manifest.archiveVersion.sourceName,
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
    `SELECT id FROM archive_versions WHERE release_id = ? AND archive_key = ? AND manifest_sha256 = ?`,
    [input.releaseId, input.metadata.archiveVersion.key, input.manifestSha256],
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
      .map((file) => (file.storage.kind === "blob" ? file.storage.blobSha256 : "")),
  );
  const corePackIds = uniqueNumbers(
    input.manifest.corePacks.map((corePack) => {
      const id = input.corePackIds.get(corePack.sha256);

      if (!id) {
        throw new Error(`Core pack id missing: ${corePack.sha256}`);
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
    const values = chunk.flatMap((corePackId) => [input.archiveVersionId, corePackId]);

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

async function deleteArchiveVersionRefs(archiveVersionId: number): Promise<void> {
  await getD1()
    .prepare(`DELETE FROM archive_version_blob_refs WHERE archive_version_id = ?`)
    .bind(archiveVersionId)
    .run();
  await getD1()
    .prepare(`DELETE FROM archive_version_core_pack_refs WHERE archive_version_id = ?`)
    .bind(archiveVersionId)
    .run();
}

async function completeImportJob(input: {
  importJobId: number;
  workId: number;
  releaseId: number;
  archiveVersionId: number;
  manifest: ArchiveManifest;
  filePolicyVersion: string;
  missingBlobCount: number;
  missingCorePackCount: number;
}): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE import_jobs
      SET work_id = ?,
        release_id = ?,
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
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(
      input.workId,
      input.releaseId,
      input.archiveVersionId,
      input.manifest.archiveVersion.sourceName,
      input.manifest.archiveVersion.sourceSize,
      input.manifest.archiveVersion.includedFileCount,
      input.manifest.archiveVersion.excludedFileCount,
      input.manifest.archiveVersion.excludedSize,
      input.filePolicyVersion,
      input.missingBlobCount,
      input.missingCorePackCount,
      input.importJobId,
    )
    .run();
}

async function insertExcludedFileTypes(
  importJobId: number,
  excludedFileTypes: ExcludedFileTypeSummary[],
): Promise<void> {
  await getD1()
    .prepare(`DELETE FROM import_job_excluded_file_types WHERE import_job_id = ?`)
    .bind(importJobId)
    .run();

  for (const item of excludedFileTypes) {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO import_job_excluded_file_types (
          import_job_id,
          file_type,
          file_count,
          total_size_bytes,
          example_path
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        importJobId,
        item.fileType,
        item.fileCount,
        item.totalSizeBytes,
        item.examplePath,
      )
      .run();
  }
}

async function requiredId(
  sql: string,
  bindings: Array<string | number | null>,
): Promise<number> {
  const row = await getD1().prepare(sql).bind(...bindings).first<IdRow>();

  if (!row) {
    throw new Error("Expected row id was not found");
  }

  return row.id;
}

function sumUniqueBlobBytes(manifest: ArchiveManifest): number {
  const seen = new Set<string>();
  let total = 0;

  for (const file of manifest.files) {
    if (file.storage.kind !== "blob" || seen.has(file.storage.blobSha256)) {
      continue;
    }

    seen.add(file.storage.blobSha256);
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

function tagSlug(tag: string): string {
  const normalized = tag
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `tag-${hashCode(tag)}`;
}

function characterSlug(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `character-${hashCode(name)}`;
}

function hashCode(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

function jsonText(value: Record<string, unknown>): string {
  return JSON.stringify(value ?? {});
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
