import { manifestKey } from "../../../lib/archive/object-keys";

export type ManifestDeletionResult = "deleted" | "retained" | "busy";

/** Include this in the transaction releasing the final archive references. */
export function queueManifestDeletion(db: D1Database, sha256: string): D1PreparedStatement {
  return db.prepare(`INSERT INTO archive_gc_manifest_deletions(sha256)
    SELECT ? WHERE NOT EXISTS (
      SELECT 1 FROM archive_versions WHERE manifest_sha256=? AND purged_at IS NULL
    ) ON CONFLICT(sha256) DO NOTHING`).bind(sha256, sha256);
}

/**
 * Reserve the hash atomically with the last reference check. Schema guards
 * prevent imports/restores until the R2 request settles and the queue is cleared.
 * A crashed in-flight owner is deliberately not stolen: an unconditional R2
 * delete cannot be fenced against a stale worker after a later re-upload.
 */
export async function deleteUnreferencedManifest(
  db: D1Database,
  bucket: Pick<R2Bucket, "delete">,
  sha256: string,
  completion?: D1PreparedStatement,
): Promise<ManifestDeletionResult> {
  const token = crypto.randomUUID();
  const claimed = await db.prepare(`INSERT INTO archive_gc_manifest_deletions(sha256,lock_token,locked_at)
    SELECT ?,?,CURRENT_TIMESTAMP WHERE NOT EXISTS (
      SELECT 1 FROM archive_versions WHERE manifest_sha256=? AND purged_at IS NULL
    ) ON CONFLICT(sha256) DO UPDATE SET lock_token=excluded.lock_token,locked_at=CURRENT_TIMESTAMP,last_error=NULL
      WHERE archive_gc_manifest_deletions.lock_token IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM archive_versions WHERE manifest_sha256=? AND purged_at IS NULL
        )`).bind(sha256, token, sha256, sha256).run();
  if (!(claimed.meta.changes ?? 0)) {
    const reference = await db.prepare(`SELECT 1 FROM archive_versions
      WHERE manifest_sha256=? AND purged_at IS NULL LIMIT 1`).bind(sha256).first();
    return reference ? "retained" : "busy";
  }
  try {
    await bucket.delete(manifestKey(sha256));
    const release = db.prepare(`DELETE FROM archive_gc_manifest_deletions WHERE sha256=? AND lock_token=?
      ${completion ? "AND changes()>0" : ""}`).bind(sha256, token);
    if (completion) {
      // Keep the hash reserved until the caller's progress is durably committed.
      // A failed or fenced completion must not reopen imports before a retry.
      const results = await db.batch([completion, release]);
      if (!(results[0].meta.changes ?? 0)) throw new Error("Manifest deletion completion was not recorded");
    } else await release.run();
    return "deleted";
  } catch (error) {
    // Keep the hash reserved after any uncertain deletion. Only the settled
    // owner releases its token, so another caller may retry idempotently.
    await db.prepare(`UPDATE archive_gc_manifest_deletions SET lock_token=NULL,locked_at=NULL,last_error=?
      WHERE sha256=? AND lock_token=?`)
      .bind(error instanceof Error ? error.message : "Manifest deletion failed", sha256, token).run();
    throw error;
  }
}

export async function retryPendingManifestDeletions(
  db: D1Database,
  bucket: Pick<R2Bucket, "delete">,
  limit: number,
) {
  const result = await db.prepare(`SELECT sha256 FROM archive_gc_manifest_deletions
    WHERE lock_token IS NULL ORDER BY created_at,sha256 LIMIT ?`).bind(limit).all<{ sha256: string }>();
  let deletedCount = 0;
  const failed: Array<{ sha256: string; error: string }> = [];
  for (const { sha256 } of result.results) {
    try {
      if (await deleteUnreferencedManifest(db, bucket, sha256) === "deleted") deletedCount++;
    } catch (error) {
      failed.push({ sha256, error: error instanceof Error ? error.message : "Manifest deletion failed" });
    }
  }
  return { scannedCount: result.results.length, deletedCount, failedCount: failed.length, failed: failed.slice(0, 25) };
}
