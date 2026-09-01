const defaultGcGraceDays = 7;
const processingExpiryHours = 24;
const scheduledGcLimitPerType = 1000;
const maxReturnedIssues = 25;
const canonicalHash = (sha256) => String(sha256).trim().toLowerCase();
const blobKey = (sha256) => {
  const hash = canonicalHash(sha256);
  return `blobs/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
};
const corePackKey = (sha256) => {
  const hash = canonicalHash(sha256);
  return `core-packs/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.zip`;
};
const manifestKey = (sha256) => {
  const hash = canonicalHash(sha256);
  return `manifests/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.json`;
};

export async function runScheduledArchiveGc(env, input = {}) {
  const startedAt = Date.now();
  const graceDays = clampInteger(
    input.graceDays ?? defaultGcGraceDays,
    0,
    3650,
  );
  const limitPerType = clampInteger(
    input.limitPerType ?? scheduledGcLimitPerType,
    1,
    1000,
  );
  const processing = await expireStaleProcessing(env, limitPerType);
  const archiveVersions = await purgeDeletedArchiveVersions(
    env,
    graceDays,
    limitPerType,
  );
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
    processing,
    archiveVersions,
    blobs,
    corePacks,
  };

  await writeGcAuditLog(env.DB, report);

  return report;
}

async function expireStaleProcessing(env, limit) {
  const cutoff = `-${processingExpiryHours} hours`;
  const candidates = await env.DB
    .prepare(
      `SELECT
        av.id AS archive_version_id,
        av.work_id,
        av.manifest_sha256,
        av.created_at AS archive_created_at,
        w.status AS work_status,
        ij.id AS import_job_id,
        ij.updated_at AS import_updated_at
       FROM archive_versions av
       JOIN works w ON w.id = av.work_id
       LEFT JOIN import_jobs ij ON ij.id = (
         SELECT ij2.id
         FROM import_jobs ij2
         WHERE ij2.archive_version_id = av.id
            OR (ij2.work_id = av.work_id AND ij2.archive_version_id IS NULL)
         ORDER BY datetime(ij2.updated_at) DESC, ij2.id DESC
         LIMIT 1
       )
       WHERE av.status = 'processing'
         AND datetime(COALESCE(ij.updated_at, av.created_at)) <= datetime('now', ?)
       ORDER BY datetime(COALESCE(ij.updated_at, av.created_at)) ASC, av.id ASC
       LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all();

  const expired = [];
  const skipped = [];
  const failed = [];

  for (const row of candidates.results ?? []) {
    if (!(await expireProcessingImportJob(env.DB, row.import_job_id, cutoff))) {
      skipped.push({ archiveVersionId: row.archive_version_id });
      continue;
    }

    try {
      if (!(await hasOtherManifestReferences(env.DB, row.manifest_sha256, row.archive_version_id))) {
        await env.ARCHIVE_BUCKET.delete(manifestKey(row.manifest_sha256));
      }

      await env.DB.batch([
        env.DB
          .prepare(`DELETE FROM archive_version_blob_refs WHERE archive_version_id = ?`)
          .bind(row.archive_version_id),
        env.DB
          .prepare(`DELETE FROM archive_version_core_pack_refs WHERE archive_version_id = ?`)
          .bind(row.archive_version_id),
        env.DB
          .prepare(`DELETE FROM archive_versions WHERE id = ? AND status = 'processing'`)
          .bind(row.archive_version_id),
      ]);

      const workCleanup = await env.DB
        .prepare(
          `DELETE FROM works
           WHERE id = ?
             AND status = 'processing'
             AND NOT EXISTS (SELECT 1 FROM archive_versions WHERE work_id = ?)
             AND NOT EXISTS (SELECT 1 FROM work_external_links WHERE work_id = ?)`,
        )
        .bind(row.work_id, row.work_id, row.work_id)
        .run();

      expired.push({
        archiveVersionId: row.archive_version_id,
        workId: row.work_id,
        workDeleted: (workCleanup.meta?.changes ?? 0) > 0,
      });
    } catch (error) {
      failed.push({
        archiveVersionId: row.archive_version_id,
        workId: row.work_id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const orphanWorks = await env.DB
    .prepare(
      `SELECT w.id, ij.id AS import_job_id
       FROM works w
       LEFT JOIN import_jobs ij ON ij.work_id = w.id
       WHERE w.status = 'processing'
         AND NOT EXISTS (SELECT 1 FROM archive_versions av WHERE av.work_id = w.id)
         AND datetime(COALESCE(ij.updated_at, w.updated_at)) <= datetime('now', ?)
       ORDER BY datetime(COALESCE(ij.updated_at, w.updated_at)) ASC, w.id ASC
       LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all();

  for (const row of orphanWorks.results ?? []) {
    if (!(await expireProcessingImportJob(env.DB, row.import_job_id, cutoff))) {
      skipped.push({ workId: row.id });
      continue;
    }

    const result = await env.DB
      .prepare(
        `DELETE FROM works
         WHERE id = ?
           AND status = 'processing'
           AND NOT EXISTS (SELECT 1 FROM archive_versions WHERE work_id = ?)
           AND NOT EXISTS (SELECT 1 FROM work_external_links WHERE work_id = ?)`,
      )
      .bind(row.id, row.id, row.id)
      .run();
    if ((result.meta?.changes ?? 0) > 0) {
      expired.push({ workId: row.id, workDeleted: true });
    }
  }

  // Expire otherwise-unattached upload tasks only after processing archives and
  // provisional works have had a chance to use the original activity timestamp.
  const staleJobs = await env.DB
    .prepare(
      `UPDATE import_jobs
       SET status = 'expired',
           failed_stage = 'upload_expiry',
           error_message = '上传任务超过 24 小时没有活动，已自动失效',
           updated_at = CURRENT_TIMESTAMP,
           completed_at = CURRENT_TIMESTAMP
       WHERE id IN (
         SELECT id FROM import_jobs
         WHERE archive_version_id IS NULL
           AND status IN (
             'created', 'preflighted', 'uploading_source', 'awaiting_metadata',
             'uploading_metadata', 'committing'
           )
           AND datetime(updated_at) <= datetime('now', ?)
         ORDER BY datetime(updated_at) ASC, id ASC
         LIMIT ?
       )`,
    )
    .bind(cutoff, limit)
    .run();

  return {
    expiryHours: processingExpiryHours,
    scannedCount: (staleJobs.meta?.changes ?? 0) + (candidates.results ?? []).length + (orphanWorks.results ?? []).length,
    expiredCount: (staleJobs.meta?.changes ?? 0) + expired.length,
    expiredImportJobCount: staleJobs.meta?.changes ?? 0,
    skippedCount: skipped.length,
    failedCount: failed.length,
    expired: expired.slice(0, maxReturnedIssues),
    skipped: skipped.slice(0, maxReturnedIssues),
    failed: failed.slice(0, maxReturnedIssues),
  };
}

async function expireProcessingImportJob(db, importJobId, cutoff) {
  if (!importJobId) return true;
  const result = await db
    .prepare(
      `UPDATE import_jobs
       SET status = 'expired',
           failed_stage = 'processing_expiry',
           error_message = '归档处理中超过 24 小时，已自动清理',
           updated_at = CURRENT_TIMESTAMP,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN (
           'created', 'preflighted', 'uploading_source', 'awaiting_metadata',
           'uploading_metadata', 'committing', 'failed', 'canceled', 'expired'
         )
         AND datetime(updated_at) <= datetime('now', ?)`,
    )
    .bind(importJobId, cutoff)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

async function listEligibleGcRows(db, type, graceDays, limit) {
  const sql =
    type === "blob"
      ? `SELECT
          b.sha256 AS id,
          b.sha256,
          b.size_bytes
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
          cp.size_bytes
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
  const rows = await db.prepare(sql).bind(`-${graceDays} days`, limit).all();

  return rows.results ?? [];
}

async function listArchiveVersionPurgeCandidates(db, graceDays, limit) {
  const rows = await db
    .prepare(
      `SELECT
        id,
        deleted_at,
        total_files,
        total_size_bytes,
        manifest_sha256
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
  const rows = await listArchiveVersionPurgeCandidates(
    env.DB,
    graceDays,
    limit,
  );
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
      if (
        !(await hasOtherManifestReferences(env.DB, row.manifest_sha256, row.id))
      ) {
        await env.ARCHIVE_BUCKET.delete(manifestKey(row.manifest_sha256));
      }
      await deleteArchiveVersionRefs(env.DB, row.id);
      purged.push(candidate);
    } catch (error) {
      await releaseArchiveVersionPurgeReservation(env.DB, row.id);
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

async function hasOtherManifestReferences(
  db,
  manifestSha256,
  archiveVersionId,
) {
  const row = await db
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

async function releaseArchiveVersionPurgeReservation(db, archiveVersionId) {
  await db
    .prepare(
      `UPDATE archive_versions
       SET purged_at = NULL
       WHERE id = ? AND status = 'deleted'`,
    )
    .bind(archiveVersionId)
    .run();
}

async function deleteArchiveVersionRefs(db, archiveVersionId) {
  await db.batch([
    db.prepare(
      `DELETE FROM archive_version_blob_refs
       WHERE archive_version_id = ?`,
    )
    .bind(archiveVersionId),
    db.prepare(
      `DELETE FROM archive_version_core_pack_refs
       WHERE archive_version_id = ?`,
    )
    .bind(archiveVersionId),
  ]);
}

function mapArchiveVersionPurgeCandidate(row) {
  return {
    id: row.id,
    deletedAt: row.deleted_at,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
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
      r2Key: type === "blob" ? blobKey(row.id) : corePackKey(row.id),
      sizeBytes: row.size_bytes,
    };
    const reserved = await markCandidatePurging(
      env.DB,
      type,
      object.id,
      graceDays,
    );

    if (!reserved) {
      skipped.push(object);
      continue;
    }

    try {
      await env.ARCHIVE_BUCKET.delete(
        type === "blob" ? blobKey(object.id) : corePackKey(object.id),
      );
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
  const result = await db.prepare(sql).bind(id, `-${graceDays} days`).run();

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
        WHERE sha256 = ?
          AND status = 'purging'`;

  const result = await db.prepare(sql).bind(id).run();
  if ((result.meta?.changes ?? 0) === 0) {
    throw new Error("GC reservation was lost before purge completion");
  }
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
        WHERE sha256 = ?
          AND status = 'purging'`;

  await db.prepare(sql).bind(id).run();
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
        processingExpiryHours: report.processing.expiryHours,
        expiredProcessingCount: report.processing.expiredCount,
        expiredImportJobCount: report.processing.expiredImportJobCount,
        skippedProcessingCount: report.processing.skippedCount,
        failedProcessingCount: report.processing.failedCount,
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
