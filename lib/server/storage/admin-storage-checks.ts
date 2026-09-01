import {
  gcDefaultArchiveVersionPurgeLimit,
  gcDefaultGraceDays,
  gcDefaultSweepLimitPerType,
  gcMaxSweepLimitPerType,
} from "@/lib/archive/gc-policy";
import { chunkArray } from "@/lib/server/db/chunks";
import { getD1 } from "@/lib/server/db/d1";
import { getArchiveBucket } from "@/lib/server/storage/archive-bucket";
import {
  blobKey,
  corePackKey,
  manifestKey,
} from "@/lib/server/storage/archive-keys";

type D1ObjectRow = {
  sha256: string;
  r2Key: string;
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
  deletedAt: string;
  totalFiles: number;
  totalSizeBytes: number;
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
  sha256: string;
  size_bytes: number;
  created_at: string;
  total_reference_count: number;
  live_reference_count: number;
  deleted_reference_count: number;
};

type GcArchiveVersionPurgeCandidateRow = {
  id: number;
  deleted_at: string;
  total_files: number;
  total_size_bytes: number;
  manifest_sha256: string;
};

type GcArchiveVersionPurgeSummaryRow = {
  count: number | null;
  file_count: number | null;
  size_bytes: number | null;
};

const maxReturnedIssues = 50;

export async function runStorageConsistencyCheck(
  input: {
    dbSampleLimit?: number;
    r2ScanLimit?: number;
  } = {},
): Promise<StorageConsistencyReport> {
  const dbSampleLimit = clampInteger(input.dbSampleLimit ?? 100, 1, 300);
  const r2ScanLimit = clampInteger(input.r2ScanLimit ?? 1000, 1, 3000);
  const database = getD1();
  const [blobResult, corePackResult, manifestResult] = await database.batch([
    database
      .prepare(
        `SELECT sha256,size_bytes FROM blobs
         WHERE status='active' ORDER BY sha256 LIMIT ?`,
      )
      .bind(dbSampleLimit),
    database
      .prepare(
        `SELECT sha256,size_bytes FROM core_packs
         WHERE status='active' ORDER BY sha256 LIMIT ?`,
      )
      .bind(dbSampleLimit),
    database
      .prepare(
        `SELECT manifest_sha256 AS sha256,NULL AS size_bytes
         FROM archive_versions WHERE status<>'deleted'
         GROUP BY manifest_sha256 ORDER BY manifest_sha256 LIMIT ?`,
      )
      .bind(dbSampleLimit),
  ]);
  const blobRows = (blobResult.results ?? []) as D1ObjectRow[];
  const corePackRows = (corePackResult.results ?? []) as D1ObjectRow[];
  const manifestRows = (manifestResult.results ?? []) as D1ObjectRow[];
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

export async function runGcDryRun(
  input: {
    graceDays?: number;
    sampleLimit?: number;
  } = {},
): Promise<GcDryRunReport> {
  const graceDays = clampInteger(
    input.graceDays ?? gcDefaultGraceDays,
    0,
    3650,
  );
  const sampleLimit = clampInteger(input.sampleLimit ?? 50, 1, 200);

  const database = getD1();
  const results = await database.batch([
    archiveVersionPurgeSummaryStatement(database, graceDays),
    archiveVersionPurgeCandidatesStatement(database, graceDays, sampleLimit),
    eligibleGcSummaryStatement(database, "blob", graceDays),
    deletedOnlyGcSummaryStatement(database, "blob"),
    gcCandidateRowsStatement(database, "blob", sampleLimit),
    eligibleGcSummaryStatement(database, "core_pack", graceDays),
    deletedOnlyGcSummaryStatement(database, "core_pack"),
    gcCandidateRowsStatement(database, "core_pack", sampleLimit),
  ]);
  const archiveVersionSummary = mapArchiveVersionPurgeSummary(
    (results[0].results?.[0] ?? {}) as GcArchiveVersionPurgeSummaryRow,
    (results[1].results ?? []) as GcArchiveVersionPurgeCandidateRow[],
  );
  const blobSummary = mapGcObjectSummary(
    "blob",
    (results[2].results?.[0] ?? {}) as GcSummaryRow,
    (results[3].results?.[0] ?? {}) as GcSummaryRow,
    normalizeGcCandidateRows((results[4].results ?? []) as GcCandidateRow[]),
    graceDays,
  );
  const corePackSummary = mapGcObjectSummary(
    "core_pack",
    (results[5].results?.[0] ?? {}) as GcSummaryRow,
    (results[6].results?.[0] ?? {}) as GcSummaryRow,
    normalizeGcCandidateRows((results[7].results ?? []) as GcCandidateRow[]),
    graceDays,
  );

  return {
    checkedAt: new Date().toISOString(),
    graceDays,
    sampleLimit,
    archiveVersions: archiveVersionSummary,
    blobs: blobSummary,
    corePacks: corePackSummary,
  };
}

export async function runGcSweep(
  input: {
    graceDays?: number;
    limitPerType?: number;
  } = {},
): Promise<GcSweepReport> {
  const graceDays = clampInteger(
    input.graceDays ?? gcDefaultGraceDays,
    0,
    3650,
  );
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
    const r2Key =
      type === "blob"
        ? blobKey(row.sha256)
        : type === "core_pack"
          ? corePackKey(row.sha256)
          : manifestKey(row.sha256);
    const object = await bucket.head(r2Key);

    if (!object) {
      missing.push({
        type,
        sha256: row.sha256,
        r2Key,
      });
      continue;
    }

    if (
      type !== "manifest" &&
      row.size_bytes !== null &&
      object.size !== row.size_bytes
    ) {
      sizeMismatches.push({
        type,
        sha256: row.sha256,
        r2Key,
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

async function scanR2Objects(
  limit: number,
): Promise<StorageConsistencyReport["r2ToD1"]> {
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

    if (
      object.key.endsWith(".zip") &&
      !object.key.startsWith("core-packs/sha256/")
    ) {
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

  const database = getD1();
  const queries: Array<{
    type: "blob" | "core_pack" | "manifest";
    statement: D1PreparedStatement;
  }> = [];
  for (const [type, table, column] of [
    ["blob", "blobs", "sha256"],
    ["core_pack", "core_packs", "sha256"],
    ["manifest", "archive_versions", "manifest_sha256"],
  ] as const) {
    for (const chunk of chunkArray([...hashes[type]], 100)) {
      queries.push({
        type,
        statement: database
          .prepare(
            `SELECT ${column} AS sha256
             FROM ${table}
             WHERE ${column} IN (${chunk.map(() => "?").join(",")})`,
          )
          .bind(...chunk),
      });
    }
  }
  const existing = {
    blob: new Set<string>(),
    core_pack: new Set<string>(),
    manifest: new Set<string>(),
  };
  if (!queries.length) return existing;
  const results = await database.batch(queries.map((query) => query.statement));
  results.forEach((result, index) => {
    for (const row of (result.results ?? []) as Array<{ sha256: string }>) {
      existing[queries[index].type].add(row.sha256);
    }
  });
  return existing;
}

function mapGcObjectSummary(
  type: "blob" | "core_pack",
  eligible: GcSummaryRow,
  deletedOnly: GcSummaryRow,
  sampleRows: GcCandidateRow[],
  graceDays: number,
): GcObjectSummary {
  return {
    eligibleCount: eligible.count ?? 0,
    eligibleSizeBytes: eligible.size_bytes ?? 0,
    deletedOnlyReferenceCount: deletedOnly.count ?? 0,
    deletedOnlyReferenceSizeBytes: deletedOnly.size_bytes ?? 0,
    sample: sampleRows.map((row) => ({
      type,
      id: row.id,
      r2Key: type === "blob" ? blobKey(row.id) : corePackKey(row.id),
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      totalReferenceCount: row.total_reference_count,
      liveReferenceCount: row.live_reference_count,
      deletedReferenceCount: row.deleted_reference_count,
      eligibleNow:
        row.total_reference_count === 0 &&
        isOlderThanGrace(row.created_at, graceDays),
    })),
  };
}

function mapArchiveVersionPurgeSummary(
  summary: GcArchiveVersionPurgeSummaryRow,
  sample: GcArchiveVersionPurgeCandidateRow[],
): GcArchiveVersionPurgeSummary {
  return {
    eligibleCount: summary.count ?? 0,
    eligibleFileCount: summary.file_count ?? 0,
    eligibleSizeBytes: summary.size_bytes ?? 0,
    sample: sample.map(mapArchiveVersionPurgeCandidate),
  };
}

async function listArchiveVersionPurgeCandidates(
  graceDays: number,
  limit: number,
): Promise<GcArchiveVersionPurgeCandidateRow[]> {
  const rows = await archiveVersionPurgeCandidatesStatement(getD1(), graceDays, limit)
    .all<GcArchiveVersionPurgeCandidateRow>();

  return rows.results ?? [];
}

function archiveVersionPurgeSummaryStatement(
  database: D1Database,
  graceDays: number,
): D1PreparedStatement {
  return database
    .prepare(
      `SELECT COUNT(*) AS count,
         COALESCE(SUM(total_files),0) AS file_count,
         COALESCE(SUM(total_size_bytes),0) AS size_bytes
       FROM archive_versions
       WHERE status='deleted' AND purged_at IS NULL AND deleted_at IS NOT NULL
         AND datetime(deleted_at)<=datetime('now',?)`,
    )
    .bind(`-${graceDays} days`);
}

function archiveVersionPurgeCandidatesStatement(
  database: D1Database,
  graceDays: number,
  limit: number,
): D1PreparedStatement {
  return database
    .prepare(
      `SELECT id,deleted_at,total_files,total_size_bytes,manifest_sha256
       FROM archive_versions
       WHERE status='deleted' AND purged_at IS NULL AND deleted_at IS NOT NULL
         AND datetime(deleted_at)<=datetime('now',?)
       ORDER BY datetime(deleted_at) ASC,id ASC
       LIMIT ?`,
    )
    .bind(`-${graceDays} days`, limit);
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
      if (!(await hasOtherManifestReferences(row.manifest_sha256, row.id))) {
        await bucket.delete(manifestKey(row.manifest_sha256));
      }
      await deleteArchiveVersionRefs(row.id);
      purged.push(candidate);
    } catch (error) {
      await releaseArchiveVersionPurgeReservation(row.id);
      failed.push({
        ...candidate,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    scannedCount: rows.length,
    purgedCount: purged.length,
    purgedFileCount: purged.reduce(
      (sum, candidate) => sum + candidate.totalFiles,
      0,
    ),
    purgedSizeBytes: purged.reduce(
      (sum, candidate) => sum + candidate.totalSizeBytes,
      0,
    ),
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

async function hasOtherManifestReferences(
  manifestSha256: string,
  archiveVersionId: number,
): Promise<boolean> {
  const row = await getD1()
    .prepare(
      `SELECT 1
       FROM archive_versions
       WHERE manifest_sha256 = ?
         AND id <> ?
         AND purged_at IS NULL
       LIMIT 1`,
    )
    .bind(manifestSha256, archiveVersionId)
    .first();
  return Boolean(row);
}

async function releaseArchiveVersionPurgeReservation(
  archiveVersionId: number,
): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE archive_versions
       SET purged_at = NULL
       WHERE id = ? AND status = 'deleted'`,
    )
    .bind(archiveVersionId)
    .run();
}

async function deleteArchiveVersionRefs(
  archiveVersionId: number,
): Promise<void> {
  const database = getD1();
  await database.batch([
    database.prepare(
      `DELETE FROM archive_version_blob_refs
      WHERE archive_version_id = ?`,
    )
    .bind(archiveVersionId),
    database.prepare(
      `DELETE FROM archive_version_core_pack_refs
      WHERE archive_version_id = ?`,
    )
    .bind(archiveVersionId),
  ]);
}

function mapArchiveVersionPurgeCandidate(
  row: GcArchiveVersionPurgeCandidateRow,
): GcArchiveVersionPurgeCandidate {
  return {
    id: row.id,
    deletedAt: row.deleted_at,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
  };
}

function eligibleGcSummaryStatement(
  database: D1Database,
  type: "blob" | "core_pack",
  graceDays: number,
): D1PreparedStatement {
  const sql =
    type === "blob"
      ? `SELECT COUNT(*) AS count, SUM(b.size_bytes) AS size_bytes
        FROM blobs b
        WHERE b.status IN ('active', 'purging')
          AND datetime(b.created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_blob_refs avbr
            WHERE avbr.blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM media_assets ma
            WHERE ma.blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM users u WHERE u.avatar_blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM characters ch WHERE ch.portrait_blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM custom_emojis ce WHERE ce.image_blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM catalogs c
            WHERE c.cover_blob_sha256 = b.sha256 AND c.status = 'published'
          )`
      : `SELECT COUNT(*) AS count, SUM(cp.size_bytes) AS size_bytes
        FROM core_packs cp
        WHERE cp.status IN ('active', 'purging')
          AND datetime(cp.created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_core_pack_refs avcpr
            WHERE avcpr.core_pack_id = cp.id
          )`;

  return database.prepare(sql).bind(`-${graceDays} days`);
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
          b.sha256,
          b.size_bytes,
          b.created_at,
          0 AS total_reference_count,
          0 AS live_reference_count,
          0 AS deleted_reference_count
        FROM blobs b
        WHERE b.status IN ('active', 'purging')
          AND datetime(b.created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_blob_refs avbr
            WHERE avbr.blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM media_assets ma
            WHERE ma.blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM users u WHERE u.avatar_blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM characters ch WHERE ch.portrait_blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM custom_emojis ce WHERE ce.image_blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM catalogs c
            WHERE c.cover_blob_sha256 = b.sha256 AND c.status = 'published'
          )
        ORDER BY b.created_at ASC, b.sha256 ASC
        LIMIT ?`
      : `SELECT
          cp.sha256 AS id,
          cp.sha256,
          cp.size_bytes,
          cp.created_at,
          0 AS total_reference_count,
          0 AS live_reference_count,
          0 AS deleted_reference_count
        FROM core_packs cp
        WHERE cp.status IN ('active', 'purging')
          AND datetime(cp.created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_core_pack_refs avcpr
            WHERE avcpr.core_pack_id = cp.id
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
      r2Key: type === "blob" ? blobKey(row.id) : corePackKey(row.id),
      sizeBytes: row.size_bytes,
    };
    const reserved = await markGcCandidatePurging(type, row.id, graceDays);

    if (!reserved) {
      skipped.push(object);
      continue;
    }

    try {
      await bucket.delete(
        type === "blob" ? blobKey(row.id) : corePackKey(row.id),
      );
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
          AND status IN ('active', 'purging')
          AND datetime(created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_blob_refs avbr
            WHERE avbr.blob_sha256 = blobs.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM media_assets ma
            WHERE ma.blob_sha256 = blobs.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM users u WHERE u.avatar_blob_sha256 = blobs.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM characters ch WHERE ch.portrait_blob_sha256 = blobs.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM custom_emojis ce WHERE ce.image_blob_sha256 = blobs.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM catalogs c
            WHERE c.cover_blob_sha256 = blobs.sha256 AND c.status = 'published'
          )`
      : `UPDATE core_packs
        SET status = 'purging'
        WHERE sha256 = ?
          AND status IN ('active', 'purging')
          AND datetime(created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_core_pack_refs avcpr
            WHERE avcpr.core_pack_id = core_packs.id
          )`;

  const result = await getD1()
    .prepare(sql)
    .bind(id, `-${graceDays} days`)
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
        WHERE sha256 = ?
          AND status = 'purging'`;

  const result = await getD1().prepare(sql).bind(id).run();
  if ((result.meta.changes ?? 0) === 0) {
    throw new Error("GC reservation was lost before purge completion");
  }
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
        WHERE sha256 = ?
          AND status = 'purging'`;

  await getD1().prepare(sql).bind(id).run();
}

function deletedOnlyGcSummaryStatement(
  database: D1Database,
  type: "blob" | "core_pack",
): D1PreparedStatement {
  const sql =
    type === "blob"
      ? `SELECT COUNT(*) AS count, SUM(size_bytes) AS size_bytes
        FROM (
          SELECT b.sha256, b.size_bytes
          FROM blobs b
          JOIN archive_version_blob_refs avbr
            ON avbr.blob_sha256 = b.sha256
          JOIN archive_versions av ON av.id = avbr.archive_version_id
          WHERE b.status = 'active'
            AND NOT EXISTS (
              SELECT 1
              FROM media_assets ma
              WHERE ma.blob_sha256 = b.sha256
            )
            AND NOT EXISTS (
              SELECT 1 FROM users u WHERE u.avatar_blob_sha256 = b.sha256
            )
            AND NOT EXISTS (
              SELECT 1 FROM characters ch WHERE ch.portrait_blob_sha256 = b.sha256
            )
            AND NOT EXISTS (
              SELECT 1 FROM custom_emojis ce WHERE ce.image_blob_sha256 = b.sha256
            )
            AND NOT EXISTS (
              SELECT 1
              FROM catalogs c
              WHERE c.cover_blob_sha256 = b.sha256 AND c.status = 'published'
            )
          GROUP BY b.sha256
          HAVING SUM(CASE WHEN av.status <> 'deleted' THEN 1 ELSE 0 END) = 0
        )`
      : `SELECT COUNT(*) AS count, SUM(size_bytes) AS size_bytes
        FROM (
          SELECT cp.id, cp.size_bytes
          FROM core_packs cp
          JOIN archive_version_core_pack_refs avcpr
            ON avcpr.core_pack_id = cp.id
          JOIN archive_versions av ON av.id = avcpr.archive_version_id
          WHERE cp.status = 'active'
          GROUP BY cp.id
          HAVING SUM(CASE WHEN av.status <> 'deleted' THEN 1 ELSE 0 END) = 0
        )`;

  return database.prepare(sql);
}

function gcCandidateRowsStatement(
  database: D1Database,
  type: "blob" | "core_pack",
  limit: number,
): D1PreparedStatement {
  const sql =
    type === "blob"
      ? `SELECT
          b.sha256 AS id,
          b.sha256,
          b.size_bytes,
          b.created_at,
          COUNT(avbr.blob_sha256) AS total_reference_count,
          COALESCE(SUM(CASE WHEN av.status <> 'deleted' THEN 1 ELSE 0 END), 0) AS live_reference_count,
          COALESCE(SUM(CASE WHEN av.status = 'deleted' THEN 1 ELSE 0 END), 0) AS deleted_reference_count
        FROM blobs b
        LEFT JOIN archive_version_blob_refs avbr
          ON avbr.blob_sha256 = b.sha256
        LEFT JOIN archive_versions av ON av.id = avbr.archive_version_id
        WHERE b.status IN ('active', 'purging')
          AND NOT EXISTS (
            SELECT 1
            FROM media_assets ma
            WHERE ma.blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM users u WHERE u.avatar_blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM characters ch WHERE ch.portrait_blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1 FROM custom_emojis ce WHERE ce.image_blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM catalogs c
            WHERE c.cover_blob_sha256 = b.sha256 AND c.status = 'published'
          )
        GROUP BY b.sha256
        HAVING live_reference_count = 0
        ORDER BY total_reference_count ASC, b.created_at ASC
        LIMIT ?`
      : `SELECT
          cp.sha256 AS id,
          cp.sha256,
          cp.size_bytes,
          cp.created_at,
          COUNT(avcpr.core_pack_id) AS total_reference_count,
          COALESCE(SUM(CASE WHEN av.status <> 'deleted' THEN 1 ELSE 0 END), 0) AS live_reference_count,
          COALESCE(SUM(CASE WHEN av.status = 'deleted' THEN 1 ELSE 0 END), 0) AS deleted_reference_count
        FROM core_packs cp
        LEFT JOIN archive_version_core_pack_refs avcpr
          ON avcpr.core_pack_id = cp.id
        LEFT JOIN archive_versions av ON av.id = avcpr.archive_version_id
        WHERE cp.status IN ('active', 'purging')
        GROUP BY cp.id
        HAVING live_reference_count = 0
        ORDER BY total_reference_count ASC, cp.created_at ASC
        LIMIT ?`;

  return database.prepare(sql).bind(limit);
}

function normalizeGcCandidateRows(rows: GcCandidateRow[]): GcCandidateRow[] {
  return rows.map((row) => ({
    ...row,
    live_reference_count: row.live_reference_count ?? 0,
    deleted_reference_count: row.deleted_reference_count ?? 0,
  }));
}

function parseR2Key(key: string): R2KeyInfo {
  const blobMatch =
    /^blobs\/sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{64})$/i.exec(key);

  if (blobMatch?.[1]) {
    return {
      type: "blob",
      sha256: blobMatch[1].toLowerCase(),
    };
  }

  const corePackMatch =
    /^core-packs\/sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{64})\.zip$/i.exec(
      key,
    );

  if (corePackMatch?.[1]) {
    return {
      type: "core_pack",
      sha256: corePackMatch[1].toLowerCase(),
    };
  }

  const manifestMatch =
    /^manifests\/sha256\/[a-f0-9]{2}\/[a-f0-9]{2}\/([a-f0-9]{64})\.json$/i.exec(
      key,
    );

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

function toR2OrphanObject(
  object: R2ListedObject,
  info: R2KeyInfo,
): R2OrphanObject {
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
