import {
  gcDefaultArchiveVersionPurgeLimit,
  gcDefaultGraceDays,
  gcDefaultSweepLimitPerType,
  gcMaxSweepLimitPerType,
} from "@/lib/archive/gc-policy";
import { chunkArray } from "@/lib/server/db/chunks";
import { getD1 } from "@/lib/server/db/d1";
import { getArchiveBucket } from "@/lib/server/storage/archive-bucket";

type D1ObjectRow = {
  sha256: string;
  r2_key: string;
  size_bytes: number | null;
};

export type MissingR2Object = {
  type: "blob" | "core_pack" | "manifest";
  sha256: string;
  r2Key: string;
};

export type R2SizeMismatch = {
  type: "blob" | "core_pack";
  sha256: string;
  r2Key: string;
  d1SizeBytes: number;
  r2SizeBytes: number;
};

export type R2OrphanObject = {
  type: "blob" | "core_pack" | "manifest" | "unknown";
  key: string;
  sizeBytes: number;
};

export type StorageConsistencyReport = {
  checkedAt: string;
  dbSampleLimit: number;
  r2ScanLimit: number;
  dbToR2: {
    checked: {
      blobs: number;
      corePacks: number;
      manifests: number;
    };
    missing: MissingR2Object[];
    sizeMismatches: R2SizeMismatch[];
  };
  r2ToD1: {
    scannedObjects: number;
    scanComplete: boolean;
    orphanObjects: R2OrphanObject[];
    nonCanonicalObjects: R2OrphanObject[];
    zipOutsideCorePack: R2OrphanObject[];
  };
};

export type GcDryRunReport = {
  checkedAt: string;
  graceDays: number;
  sampleLimit: number;
  archiveVersions: GcArchiveVersionPurgeSummary;
  blobs: GcObjectSummary;
  corePacks: GcObjectSummary;
};

export type GcSweepReport = {
  checkedAt: string;
  graceDays: number;
  limitPerType: number;
  archiveVersions: GcArchiveVersionPurgeResult;
  blobs: GcSweepObjectSummary;
  corePacks: GcSweepObjectSummary;
};

export type GcArchiveVersionPurgeSummary = {
  eligibleCount: number;
  eligibleFileCount: number;
  eligibleSizeBytes: number;
  sample: GcArchiveVersionPurgeCandidate[];
};

export type GcArchiveVersionPurgeCandidate = {
  id: number;
  archiveLabel: string;
  archiveKey: string;
  deletedAt: string;
  totalFiles: number;
  totalSizeBytes: number;
  manifestR2Key: string;
};

export type GcArchiveVersionPurgeResult = {
  scannedCount: number;
  purgedCount: number;
  purgedFileCount: number;
  purgedSizeBytes: number;
  skippedCount: number;
  failedCount: number;
  purged: GcArchiveVersionPurgeCandidate[];
  skipped: GcArchiveVersionPurgeCandidate[];
  failed: Array<GcArchiveVersionPurgeCandidate & { error: string }>;
};

export type GcObjectSummary = {
  eligibleCount: number;
  eligibleSizeBytes: number;
  deletedOnlyReferenceCount: number;
  deletedOnlyReferenceSizeBytes: number;
  sample: GcObjectCandidate[];
};

export type GcObjectCandidate = {
  type: "blob" | "core_pack";
  id: string;
  r2Key: string;
  sizeBytes: number;
  createdAt: string;
  totalReferenceCount: number;
  liveReferenceCount: number;
  deletedReferenceCount: number;
  eligibleNow: boolean;
};

export type GcSweepObjectSummary = {
  scannedCount: number;
  purgedCount: number;
  purgedSizeBytes: number;
  skippedCount: number;
  failedCount: number;
  purged: GcSweepObject[];
  skipped: GcSweepObject[];
  failed: GcSweepFailure[];
};

export type GcSweepObject = {
  type: "blob" | "core_pack";
  id: string;
  r2Key: string;
  sizeBytes: number;
};

export type GcSweepFailure = GcSweepObject & {
  error: string;
};

type R2KeyInfo =
  | {
      type: "blob" | "core_pack" | "manifest";
      sha256: string;
    }
  | {
      type: "unknown";
      sha256: null;
    };

type R2ListedObject = {
  key: string;
  size: number;
};

type GcSummaryRow = {
  count: number | null;
  size_bytes: number | null;
};

type GcCandidateRow = {
  id: string;
  r2_key: string;
  size_bytes: number;
  created_at: string;
  total_reference_count: number;
  live_reference_count: number;
  deleted_reference_count: number;
};

type GcArchiveVersionPurgeCandidateRow = {
  id: number;
  archive_label: string;
  archive_key: string;
  deleted_at: string;
  total_files: number;
  total_size_bytes: number;
  manifest_r2_key: string;
};

type GcArchiveVersionPurgeSummaryRow = {
  count: number | null;
  file_count: number | null;
  size_bytes: number | null;
};

const maxReturnedIssues = 50;

export async function runStorageConsistencyCheck(input: {
  dbSampleLimit?: number;
  r2ScanLimit?: number;
} = {}): Promise<StorageConsistencyReport> {
  const dbSampleLimit = clampInteger(input.dbSampleLimit ?? 100, 1, 300);
  const r2ScanLimit = clampInteger(input.r2ScanLimit ?? 1000, 1, 3000);
  const [blobRows, corePackRows, manifestRows] = await Promise.all([
    listBlobRows(dbSampleLimit),
    listCorePackRows(dbSampleLimit),
    listManifestRows(dbSampleLimit),
  ]);
  const [blobCheck, corePackCheck, manifestCheck, r2Scan] = await Promise.all([
    checkD1ObjectsInR2("blob", blobRows),
    checkD1ObjectsInR2("core_pack", corePackRows),
    checkD1ObjectsInR2("manifest", manifestRows),
    scanR2Objects(r2ScanLimit),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    dbSampleLimit,
    r2ScanLimit,
    dbToR2: {
      checked: {
        blobs: blobRows.length,
        corePacks: corePackRows.length,
        manifests: manifestRows.length,
      },
      missing: [
        ...blobCheck.missing,
        ...corePackCheck.missing,
        ...manifestCheck.missing,
      ].slice(0, maxReturnedIssues),
      sizeMismatches: [
        ...blobCheck.sizeMismatches,
        ...corePackCheck.sizeMismatches,
      ].slice(0, maxReturnedIssues),
    },
    r2ToD1: r2Scan,
  };
}

export async function runGcDryRun(input: {
  graceDays?: number;
  sampleLimit?: number;
} = {}): Promise<GcDryRunReport> {
  const graceDays = clampInteger(input.graceDays ?? gcDefaultGraceDays, 0, 3650);
  const sampleLimit = clampInteger(input.sampleLimit ?? 50, 1, 200);

  const [archiveVersionSummary, blobSummary, corePackSummary] = await Promise.all([
    getArchiveVersionPurgeSummary(graceDays, sampleLimit),
    getGcObjectSummary("blob", graceDays, sampleLimit),
    getGcObjectSummary("core_pack", graceDays, sampleLimit),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    graceDays,
    sampleLimit,
    archiveVersions: archiveVersionSummary,
    blobs: blobSummary,
    corePacks: corePackSummary,
  };
}

export async function runGcSweep(input: {
  graceDays?: number;
  limitPerType?: number;
} = {}): Promise<GcSweepReport> {
  const graceDays = clampInteger(input.graceDays ?? gcDefaultGraceDays, 0, 3650);
  const limitPerType = clampInteger(
    input.limitPerType ?? gcDefaultSweepLimitPerType,
    1,
    gcMaxSweepLimitPerType,
  );
  const archiveVersions = await purgeDeletedArchiveVersions(
    graceDays,
    Math.max(limitPerType, gcDefaultArchiveVersionPurgeLimit),
  );
  const [blobRows, corePackRows] = await Promise.all([
    listEligibleGcRows("blob", graceDays, limitPerType),
    listEligibleGcRows("core_pack", graceDays, limitPerType),
  ]);

  const [blobs, corePacks] = await Promise.all([
    sweepGcRows("blob", blobRows, graceDays),
    sweepGcRows("core_pack", corePackRows, graceDays),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    graceDays,
    limitPerType,
    archiveVersions,
    blobs,
    corePacks,
  };
}

async function listBlobRows(limit: number): Promise<D1ObjectRow[]> {
  const rows = await getD1()
    .prepare(
      `SELECT sha256, r2_key, size_bytes
      FROM blobs
      WHERE status = 'active'
      ORDER BY sha256
      LIMIT ?`,
    )
    .bind(limit)
    .all<D1ObjectRow>();

  return rows.results ?? [];
}

async function listCorePackRows(limit: number): Promise<D1ObjectRow[]> {
  const rows = await getD1()
    .prepare(
      `SELECT sha256, r2_key, size_bytes
      FROM core_packs
      WHERE status = 'active'
      ORDER BY sha256
      LIMIT ?`,
    )
    .bind(limit)
    .all<D1ObjectRow>();

  return rows.results ?? [];
}

async function listManifestRows(limit: number): Promise<D1ObjectRow[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        manifest_sha256 AS sha256,
        manifest_r2_key AS r2_key,
        NULL AS size_bytes
      FROM archive_versions
      WHERE status <> 'deleted'
      GROUP BY manifest_sha256, manifest_r2_key
      ORDER BY manifest_sha256
      LIMIT ?`,
    )
    .bind(limit)
    .all<D1ObjectRow>();

  return rows.results ?? [];
}

async function checkD1ObjectsInR2(
  type: "blob" | "core_pack" | "manifest",
  rows: D1ObjectRow[],
): Promise<{
  missing: MissingR2Object[];
  sizeMismatches: R2SizeMismatch[];
}> {
  const bucket = getArchiveBucket();
  const missing: MissingR2Object[] = [];
  const sizeMismatches: R2SizeMismatch[] = [];

  for (const row of rows) {
    const object = await bucket.head(row.r2_key);

    if (!object) {
      missing.push({
        type,
        sha256: row.sha256,
        r2Key: row.r2_key,
      });
      continue;
    }

    if (type !== "manifest" && row.size_bytes !== null && object.size !== row.size_bytes) {
      sizeMismatches.push({
        type,
        sha256: row.sha256,
        r2Key: row.r2_key,
        d1SizeBytes: row.size_bytes,
        r2SizeBytes: object.size,
      });
    }
  }

  return {
    missing,
    sizeMismatches,
  };
}

async function scanR2Objects(limit: number): Promise<StorageConsistencyReport["r2ToD1"]> {
  const listedObjects = await listR2Objects(limit);
  const known = await findKnownR2Sha256(listedObjects.objects);
  const orphanObjects: R2OrphanObject[] = [];
  const nonCanonicalObjects: R2OrphanObject[] = [];
  const zipOutsideCorePack: R2OrphanObject[] = [];

  for (const object of listedObjects.objects) {
    const info = parseR2Key(object.key);

    if (info.type === "unknown") {
      if (nonCanonicalObjects.length < maxReturnedIssues) {
        nonCanonicalObjects.push(toR2OrphanObject(object, info));
      }
    } else if (!known[info.type].has(info.sha256)) {
      if (orphanObjects.length < maxReturnedIssues) {
        orphanObjects.push(toR2OrphanObject(object, info));
      }
    }

    if (object.key.endsWith(".zip") && !object.key.startsWith("core-packs/sha256/")) {
      if (zipOutsideCorePack.length < maxReturnedIssues) {
        zipOutsideCorePack.push(toR2OrphanObject(object, info));
      }
    }
  }

  return {
    scannedObjects: listedObjects.objects.length,
    scanComplete: listedObjects.complete,
    orphanObjects,
    nonCanonicalObjects,
    zipOutsideCorePack,
  };
}

async function listR2Objects(limit: number): Promise<{
  objects: R2ListedObject[];
  complete: boolean;
}> {
  const bucket = getArchiveBucket();
  const objects: R2ListedObject[] = [];
  let cursor: string | undefined;
  let complete = true;

  while (objects.length < limit) {
    const page = await bucket.list({
      cursor,
      limit: Math.min(1000, limit - objects.length),
    });

    for (const object of page.objects) {
      objects.push({
        key: object.key,
        size: object.size,
      });
    }

    if (!page.truncated || !page.cursor) {
      complete = true;
      break;
    }

    cursor = page.cursor;
    complete = false;
  }

  if (objects.length >= limit) {
    complete = false;
  }

  return {
    objects,
    complete,
  };
}

async function findKnownR2Sha256(objects: R2ListedObject[]): Promise<{
  blob: Set<string>;
  core_pack: Set<string>;
  manifest: Set<string>;
}> {
  const hashes = {
    blob: new Set<string>(),
    core_pack: new Set<string>(),
    manifest: new Set<string>(),
  };

  for (const object of objects) {
    const info = parseR2Key(object.key);

    if (info.type !== "unknown") {
      hashes[info.type].add(info.sha256);
    }
  }

  return {
    blob: await findExistingHashes("blobs", "sha256", [...hashes.blob]),
    core_pack: await findExistingHashes("core_packs", "sha256", [...hashes.core_pack]),
    manifest: await findExistingHashes(
      "archive_versions",
      "manifest_sha256",
      [...hashes.manifest],
    ),
  };
}

async function findExistingHashes(
  tableName: "blobs" | "core_packs" | "archive_versions",
  columnName: "sha256" | "manifest_sha256",
  hashes: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();

  for (const chunk of chunkArray([...new Set(hashes)], 100)) {
    if (chunk.length === 0) {
      continue;
    }

    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await getD1()
      .prepare(
        `SELECT ${columnName} AS sha256
        FROM ${tableName}
        WHERE ${columnName} IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ sha256: string }>();

    for (const row of rows.results ?? []) {
      existing.add(row.sha256);
    }
  }

  return existing;
}

async function getGcObjectSummary(
  type: "blob" | "core_pack",
  graceDays: number,
  sampleLimit: number,
): Promise<GcObjectSummary> {
  const [eligible, deletedOnly, sampleRows] = await Promise.all([
    getEligibleGcSummary(type, graceDays),
    getDeletedOnlyGcSummary(type),
    listGcCandidateRows(type, sampleLimit),
  ]);

  return {
    eligibleCount: eligible.count ?? 0,
    eligibleSizeBytes: eligible.size_bytes ?? 0,
    deletedOnlyReferenceCount: deletedOnly.count ?? 0,
    deletedOnlyReferenceSizeBytes: deletedOnly.size_bytes ?? 0,
    sample: sampleRows.map((row) => ({
      type,
      id: row.id,
      r2Key: row.r2_key,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      totalReferenceCount: row.total_reference_count,
      liveReferenceCount: row.live_reference_count,
      deletedReferenceCount: row.deleted_reference_count,
      eligibleNow:
        row.total_reference_count === 0 && isOlderThanGrace(row.created_at, graceDays),
    })),
  };
}

async function getArchiveVersionPurgeSummary(
  graceDays: number,
  sampleLimit: number,
): Promise<GcArchiveVersionPurgeSummary> {
  const [summary, sample] = await Promise.all([
    getArchiveVersionPurgeSummaryRow(graceDays),
    listArchiveVersionPurgeCandidates(graceDays, sampleLimit),
  ]);

  return {
    eligibleCount: summary.count ?? 0,
    eligibleFileCount: summary.file_count ?? 0,
    eligibleSizeBytes: summary.size_bytes ?? 0,
    sample: sample.map(mapArchiveVersionPurgeCandidate),
  };
}

async function getArchiveVersionPurgeSummaryRow(
  graceDays: number,
): Promise<GcArchiveVersionPurgeSummaryRow> {
  const row = await getD1()
    .prepare(
      `SELECT
        COUNT(*) AS count,
        COALESCE(SUM(total_files), 0) AS file_count,
        COALESCE(SUM(total_size_bytes), 0) AS size_bytes
      FROM archive_versions
      WHERE status = 'deleted'
        AND purged_at IS NULL
        AND deleted_at IS NOT NULL
        AND datetime(deleted_at) <= datetime('now', ?)`,
    )
    .bind(`-${graceDays} days`)
    .first<GcArchiveVersionPurgeSummaryRow>();

  return row ?? { count: 0, file_count: 0, size_bytes: 0 };
}

async function listArchiveVersionPurgeCandidates(
  graceDays: number,
  limit: number,
): Promise<GcArchiveVersionPurgeCandidateRow[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        id,
        archive_label,
        archive_key,
        deleted_at,
        total_files,
        total_size_bytes,
        manifest_r2_key
      FROM archive_versions
      WHERE status = 'deleted'
        AND purged_at IS NULL
        AND deleted_at IS NOT NULL
        AND datetime(deleted_at) <= datetime('now', ?)
      ORDER BY datetime(deleted_at) ASC, id ASC
      LIMIT ?`,
    )
    .bind(`-${graceDays} days`, limit)
    .all<GcArchiveVersionPurgeCandidateRow>();

  return rows.results ?? [];
}

async function purgeDeletedArchiveVersions(
  graceDays: number,
  limit: number,
): Promise<GcArchiveVersionPurgeResult> {
  const rows = await listArchiveVersionPurgeCandidates(graceDays, limit);
  const bucket = getArchiveBucket();
  const purged: GcArchiveVersionPurgeCandidate[] = [];
  const skipped: GcArchiveVersionPurgeCandidate[] = [];
  const failed: Array<GcArchiveVersionPurgeCandidate & { error: string }> = [];

  for (const row of rows) {
    const candidate = mapArchiveVersionPurgeCandidate(row);
    const reserved = await markArchiveVersionPurged(row.id, graceDays);

    if (!reserved) {
      skipped.push(candidate);
      continue;
    }

    try {
      await deleteArchiveVersionFiles(row.id);
      await bucket.delete(row.manifest_r2_key);
      purged.push(candidate);
    } catch (error) {
      failed.push({
        ...candidate,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    scannedCount: rows.length,
    purgedCount: purged.length,
    purgedFileCount: purged.reduce((sum, candidate) => sum + candidate.totalFiles, 0),
    purgedSizeBytes: purged.reduce((sum, candidate) => sum + candidate.totalSizeBytes, 0),
    skippedCount: skipped.length,
    failedCount: failed.length,
    purged: purged.slice(0, maxReturnedIssues),
    skipped: skipped.slice(0, maxReturnedIssues),
    failed: failed.slice(0, maxReturnedIssues),
  };
}

async function markArchiveVersionPurged(
  archiveVersionId: number,
  graceDays: number,
): Promise<boolean> {
  const result = await getD1()
    .prepare(
      `UPDATE archive_versions
      SET purged_at = CURRENT_TIMESTAMP,
        is_current = 0
      WHERE id = ?
        AND status = 'deleted'
        AND purged_at IS NULL
        AND deleted_at IS NOT NULL
        AND datetime(deleted_at) <= datetime('now', ?)`,
    )
    .bind(archiveVersionId, `-${graceDays} days`)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function deleteArchiveVersionFiles(archiveVersionId: number): Promise<void> {
  await getD1()
    .prepare(
      `DELETE FROM archive_version_files
      WHERE archive_version_id = ?`,
    )
    .bind(archiveVersionId)
    .run();
}

function mapArchiveVersionPurgeCandidate(
  row: GcArchiveVersionPurgeCandidateRow,
): GcArchiveVersionPurgeCandidate {
  return {
    id: row.id,
    archiveLabel: row.archive_label,
    archiveKey: row.archive_key,
    deletedAt: row.deleted_at,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
    manifestR2Key: row.manifest_r2_key,
  };
}

async function getEligibleGcSummary(
  type: "blob" | "core_pack",
  graceDays: number,
): Promise<GcSummaryRow> {
  const sql =
    type === "blob"
      ? `SELECT COUNT(*) AS count, SUM(b.size_bytes) AS size_bytes
        FROM blobs b
        WHERE b.status = 'active'
          AND datetime(b.created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_files avf
            WHERE avf.storage_kind = 'blob'
              AND avf.blob_sha256 = b.sha256
          )`
      : `SELECT COUNT(*) AS count, SUM(cp.size_bytes) AS size_bytes
        FROM core_packs cp
        WHERE cp.status = 'active'
          AND datetime(cp.created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_files avf
            WHERE avf.storage_kind = 'core_pack'
              AND avf.core_pack_id = cp.id
          )`;

  const row = await getD1()
    .prepare(sql)
    .bind(`-${graceDays} days`)
    .first<GcSummaryRow>();

  return row ?? { count: 0, size_bytes: 0 };
}

async function listEligibleGcRows(
  type: "blob" | "core_pack",
  graceDays: number,
  limit: number,
): Promise<GcCandidateRow[]> {
  const sql =
    type === "blob"
      ? `SELECT
          b.sha256 AS id,
          b.r2_key,
          b.size_bytes,
          b.created_at,
          0 AS total_reference_count,
          0 AS live_reference_count,
          0 AS deleted_reference_count
        FROM blobs b
        WHERE b.status = 'active'
          AND datetime(b.created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_files avf
            WHERE avf.storage_kind = 'blob'
              AND avf.blob_sha256 = b.sha256
          )
        ORDER BY b.created_at ASC, b.sha256 ASC
        LIMIT ?`
      : `SELECT
          CAST(cp.id AS TEXT) AS id,
          cp.r2_key,
          cp.size_bytes,
          cp.created_at,
          0 AS total_reference_count,
          0 AS live_reference_count,
          0 AS deleted_reference_count
        FROM core_packs cp
        WHERE cp.status = 'active'
          AND datetime(cp.created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_files avf
            WHERE avf.storage_kind = 'core_pack'
              AND avf.core_pack_id = cp.id
          )
        ORDER BY cp.created_at ASC, cp.id ASC
        LIMIT ?`;

  const rows = await getD1()
    .prepare(sql)
    .bind(`-${graceDays} days`, limit)
    .all<GcCandidateRow>();

  return rows.results ?? [];
}

async function sweepGcRows(
  type: "blob" | "core_pack",
  rows: GcCandidateRow[],
  graceDays: number,
): Promise<GcSweepObjectSummary> {
  const bucket = getArchiveBucket();
  const purged: GcSweepObject[] = [];
  const skipped: GcSweepObject[] = [];
  const failed: GcSweepFailure[] = [];

  for (const row of rows) {
    const object = {
      type,
      id: row.id,
      r2Key: row.r2_key,
      sizeBytes: row.size_bytes,
    };
    const reserved = await markGcCandidatePurging(type, row.id, graceDays);

    if (!reserved) {
      skipped.push(object);
      continue;
    }

    try {
      await bucket.delete(row.r2_key);
      await markGcCandidatePurged(type, row.id);
      purged.push(object);
    } catch (error) {
      await restoreGcCandidateActive(type, row.id);
      failed.push({
        ...object,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    scannedCount: rows.length,
    purgedCount: purged.length,
    purgedSizeBytes: purged.reduce((sum, object) => sum + object.sizeBytes, 0),
    skippedCount: skipped.length,
    failedCount: failed.length,
    purged: purged.slice(0, maxReturnedIssues),
    skipped: skipped.slice(0, maxReturnedIssues),
    failed: failed.slice(0, maxReturnedIssues),
  };
}

async function markGcCandidatePurging(
  type: "blob" | "core_pack",
  id: string,
  graceDays: number,
): Promise<boolean> {
  const sql =
    type === "blob"
      ? `UPDATE blobs
        SET status = 'purging'
        WHERE sha256 = ?
          AND status = 'active'
          AND datetime(created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_files avf
            WHERE avf.storage_kind = 'blob'
              AND avf.blob_sha256 = blobs.sha256
          )`
      : `UPDATE core_packs
        SET status = 'purging'
        WHERE id = ?
          AND status = 'active'
          AND datetime(created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_files avf
            WHERE avf.storage_kind = 'core_pack'
              AND avf.core_pack_id = core_packs.id
          )`;

  const result = await getD1()
    .prepare(sql)
    .bind(type === "blob" ? id : Number(id), `-${graceDays} days`)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function markGcCandidatePurged(
  type: "blob" | "core_pack",
  id: string,
): Promise<void> {
  const sql =
    type === "blob"
      ? `UPDATE blobs
        SET status = 'purged'
        WHERE sha256 = ?
          AND status = 'purging'`
      : `UPDATE core_packs
        SET status = 'purged'
        WHERE id = ?
          AND status = 'purging'`;

  await getD1()
    .prepare(sql)
    .bind(type === "blob" ? id : Number(id))
    .run();
}

async function restoreGcCandidateActive(
  type: "blob" | "core_pack",
  id: string,
): Promise<void> {
  const sql =
    type === "blob"
      ? `UPDATE blobs
        SET status = 'active'
        WHERE sha256 = ?
          AND status = 'purging'`
      : `UPDATE core_packs
        SET status = 'active'
        WHERE id = ?
          AND status = 'purging'`;

  await getD1()
    .prepare(sql)
    .bind(type === "blob" ? id : Number(id))
    .run();
}

async function getDeletedOnlyGcSummary(
  type: "blob" | "core_pack",
): Promise<GcSummaryRow> {
  const sql =
    type === "blob"
      ? `SELECT COUNT(*) AS count, SUM(size_bytes) AS size_bytes
        FROM (
          SELECT b.sha256, b.size_bytes
          FROM blobs b
          JOIN archive_version_files avf
            ON avf.storage_kind = 'blob'
            AND avf.blob_sha256 = b.sha256
          JOIN archive_versions av ON av.id = avf.archive_version_id
          WHERE b.status = 'active'
          GROUP BY b.sha256
          HAVING SUM(CASE WHEN av.status <> 'deleted' THEN 1 ELSE 0 END) = 0
        )`
      : `SELECT COUNT(*) AS count, SUM(size_bytes) AS size_bytes
        FROM (
          SELECT cp.id, cp.size_bytes
          FROM core_packs cp
          JOIN archive_version_files avf
            ON avf.storage_kind = 'core_pack'
            AND avf.core_pack_id = cp.id
          JOIN archive_versions av ON av.id = avf.archive_version_id
          WHERE cp.status = 'active'
          GROUP BY cp.id
          HAVING SUM(CASE WHEN av.status <> 'deleted' THEN 1 ELSE 0 END) = 0
        )`;

  const row = await getD1().prepare(sql).first<GcSummaryRow>();

  return row ?? { count: 0, size_bytes: 0 };
}

async function listGcCandidateRows(
  type: "blob" | "core_pack",
  limit: number,
): Promise<GcCandidateRow[]> {
  const sql =
    type === "blob"
      ? `SELECT
          b.sha256 AS id,
          b.r2_key,
          b.size_bytes,
          b.created_at,
          COUNT(avf.id) AS total_reference_count,
          SUM(CASE WHEN av.status <> 'deleted' THEN 1 ELSE 0 END) AS live_reference_count,
          SUM(CASE WHEN av.status = 'deleted' THEN 1 ELSE 0 END) AS deleted_reference_count
        FROM blobs b
        LEFT JOIN archive_version_files avf
          ON avf.storage_kind = 'blob'
          AND avf.blob_sha256 = b.sha256
        LEFT JOIN archive_versions av ON av.id = avf.archive_version_id
        WHERE b.status = 'active'
        GROUP BY b.sha256
        HAVING live_reference_count = 0
        ORDER BY total_reference_count ASC, b.created_at ASC
        LIMIT ?`
      : `SELECT
          CAST(cp.id AS TEXT) AS id,
          cp.r2_key,
          cp.size_bytes,
          cp.created_at,
          COUNT(avf.id) AS total_reference_count,
          SUM(CASE WHEN av.status <> 'deleted' THEN 1 ELSE 0 END) AS live_reference_count,
          SUM(CASE WHEN av.status = 'deleted' THEN 1 ELSE 0 END) AS deleted_reference_count
        FROM core_packs cp
        LEFT JOIN archive_version_files avf
          ON avf.storage_kind = 'core_pack'
          AND avf.core_pack_id = cp.id
        LEFT JOIN archive_versions av ON av.id = avf.archive_version_id
        WHERE cp.status = 'active'
        GROUP BY cp.id
        HAVING live_reference_count = 0
        ORDER BY total_reference_count ASC, cp.created_at ASC
        LIMIT ?`;

  const rows = await getD1().prepare(sql).bind(limit).all<GcCandidateRow>();

  return (rows.results ?? []).map((row) => ({
    ...row,
    live_reference_count: row.live_reference_count ?? 0,
    deleted_reference_count: row.deleted_reference_count ?? 0,
  }));
}

function parseR2Key(key: string): R2KeyInfo {
  const blobMatch = /^blobs\/sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{64})$/i.exec(key);

  if (blobMatch?.[1]) {
    return {
      type: "blob",
      sha256: blobMatch[1].toLowerCase(),
    };
  }

  const corePackMatch =
    /^core-packs\/sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{64})\.zip$/i.exec(key);

  if (corePackMatch?.[1]) {
    return {
      type: "core_pack",
      sha256: corePackMatch[1].toLowerCase(),
    };
  }

  const manifestMatch =
    /^manifests\/sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{64})\.json$/i.exec(key);

  if (manifestMatch?.[1]) {
    return {
      type: "manifest",
      sha256: manifestMatch[1].toLowerCase(),
    };
  }

  return {
    type: "unknown",
    sha256: null,
  };
}

function toR2OrphanObject(object: R2ListedObject, info: R2KeyInfo): R2OrphanObject {
  return {
    type: info.type,
    key: object.key,
    sizeBytes: object.size,
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function isOlderThanGrace(createdAt: string, graceDays: number): boolean {
  const createdAtMs = Date.parse(createdAt);

  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  return createdAtMs <= Date.now() - graceDays * 24 * 60 * 60 * 1000;
}
