const defaultGcGraceDays = 7;
const scheduledGcLimitPerType = 1000;
const maxReturnedIssues = 25;

export async function runScheduledArchiveGc(env, input = {}) {
  const startedAt = Date.now();
  const graceDays = clampInteger(input.graceDays ?? defaultGcGraceDays, 0, 3650);
  const limitPerType = clampInteger(input.limitPerType ?? scheduledGcLimitPerType, 1, 1000);
  const archiveVersions = await purgeDeletedArchiveVersions(env, graceDays, limitPerType);
  const [blobRows, corePackRows] = await Promise.all([
    listEligibleGcRows(env.DB, "blob", graceDays, limitPerType),
    listEligibleGcRows(env.DB, "core_pack", graceDays, limitPerType),
  ]);
  const [blobs, corePacks] = await Promise.all([
    sweepRows(env, "blob", blobRows, graceDays),
    sweepRows(env, "core_pack", corePackRows, graceDays),
  ]);
  const report = {
    checkedAt: new Date().toISOString(),
    trigger: input.trigger ?? "scheduled",
    cron: input.cron ?? null,
    graceDays,
    limitPerType,
    durationMs: Date.now() - startedAt,
    archiveVersions,
    blobs,
    corePacks,
  };

  await writeGcAuditLog(env.DB, report);

  return report;
}

async function listEligibleGcRows(db, type, graceDays, limit) {
  const sql =
    type === "blob"
      ? `SELECT
          b.sha256 AS id,
          b.r2_key,
          b.size_bytes
        FROM blobs b
        WHERE b.status = 'active'
          AND datetime(b.created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_blob_refs avbr
            WHERE avbr.blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM works w
            WHERE w.icon_blob_sha256 = b.sha256
              OR w.thumbnail_blob_sha256 = b.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM media_assets ma
            WHERE ma.blob_sha256 = b.sha256
          )
        ORDER BY b.created_at ASC, b.sha256 ASC
        LIMIT ?`
      : `SELECT
          CAST(cp.id AS TEXT) AS id,
          cp.r2_key,
          cp.size_bytes
        FROM core_packs cp
        WHERE cp.status = 'active'
          AND datetime(cp.created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_core_pack_refs avcpr
            WHERE avcpr.core_pack_id = cp.id
          )
        ORDER BY cp.created_at ASC, cp.id ASC
        LIMIT ?`;
  const rows = await db.prepare(sql).bind(`-${graceDays} days`, limit).all();

  return rows.results ?? [];
}

async function listArchiveVersionPurgeCandidates(db, graceDays, limit) {
  const rows = await db
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
    .all();

  return rows.results ?? [];
}

async function purgeDeletedArchiveVersions(env, graceDays, limit) {
  const rows = await listArchiveVersionPurgeCandidates(env.DB, graceDays, limit);
  const purged = [];
  const skipped = [];
  const failed = [];

  for (const row of rows) {
    const candidate = mapArchiveVersionPurgeCandidate(row);
    const reserved = await markArchiveVersionPurged(env.DB, row.id, graceDays);

    if (!reserved) {
      skipped.push(candidate);
      continue;
    }

    try {
      await env.DB.prepare(
        `DELETE FROM archive_version_blob_refs
        WHERE archive_version_id = ?`,
      )
        .bind(row.id)
        .run();
      await env.DB.prepare(
        `DELETE FROM archive_version_core_pack_refs
        WHERE archive_version_id = ?`,
      )
        .bind(row.id)
        .run();
      await env.ARCHIVE_BUCKET.delete(row.manifest_r2_key);
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

async function markArchiveVersionPurged(db, archiveVersionId, graceDays) {
  const result = await db
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

  return (result.meta?.changes ?? 0) > 0;
}

function mapArchiveVersionPurgeCandidate(row) {
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

async function sweepRows(env, type, rows, graceDays) {
  const purged = [];
  const skipped = [];
  const failed = [];

  for (const row of rows) {
    const object = {
      type,
      id: String(row.id),
      r2Key: row.r2_key,
      sizeBytes: row.size_bytes,
    };
    const reserved = await markCandidatePurging(env.DB, type, object.id, graceDays);

    if (!reserved) {
      skipped.push(object);
      continue;
    }

    try {
      await env.ARCHIVE_BUCKET.delete(object.r2Key);
      await markCandidatePurged(env.DB, type, object.id);
      purged.push(object);
    } catch (error) {
      await restoreCandidateActive(env.DB, type, object.id);
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

async function markCandidatePurging(db, type, id, graceDays) {
  const sql =
    type === "blob"
      ? `UPDATE blobs
        SET status = 'purging'
        WHERE sha256 = ?
          AND status = 'active'
          AND datetime(created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_blob_refs avbr
            WHERE avbr.blob_sha256 = blobs.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM works w
            WHERE w.icon_blob_sha256 = blobs.sha256
              OR w.thumbnail_blob_sha256 = blobs.sha256
          )
          AND NOT EXISTS (
            SELECT 1
            FROM media_assets ma
            WHERE ma.blob_sha256 = blobs.sha256
          )`
      : `UPDATE core_packs
        SET status = 'purging'
        WHERE id = ?
          AND status = 'active'
          AND datetime(created_at) <= datetime('now', ?)
          AND NOT EXISTS (
            SELECT 1
            FROM archive_version_core_pack_refs avcpr
            WHERE avcpr.core_pack_id = core_packs.id
          )`;
  const result = await db
    .prepare(sql)
    .bind(type === "blob" ? id : Number(id), `-${graceDays} days`)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

async function markCandidatePurged(db, type, id) {
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

  await db.prepare(sql).bind(type === "blob" ? id : Number(id)).run();
}

async function restoreCandidateActive(db, type, id) {
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

  await db.prepare(sql).bind(type === "blob" ? id : Number(id)).run();
}

async function writeGcAuditLog(db, report) {
  await db
    .prepare(
      `INSERT INTO auth_audit_logs (
        user_id,
        email,
        event_type,
        detail_json
      ) VALUES (NULL, NULL, 'scheduled_gc_sweep', ?)`,
    )
    .bind(
      JSON.stringify({
        trigger: report.trigger,
        cron: report.cron,
        graceDays: report.graceDays,
        limitPerType: report.limitPerType,
        durationMs: report.durationMs,
        purgedArchiveVersionCount: report.archiveVersions.purgedCount,
        purgedArchiveVersionFileCount: report.archiveVersions.purgedFileCount,
        purgedArchiveVersionSizeBytes: report.archiveVersions.purgedSizeBytes,
        failedArchiveVersionCount: report.archiveVersions.failedCount,
        purgedBlobCount: report.blobs.purgedCount,
        purgedCorePackCount: report.corePacks.purgedCount,
        purgedBlobSizeBytes: report.blobs.purgedSizeBytes,
        purgedCorePackSizeBytes: report.corePacks.purgedSizeBytes,
        failedBlobCount: report.blobs.failedCount,
        failedCorePackCount: report.corePacks.failedCount,
      }),
    )
    .run();
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}
