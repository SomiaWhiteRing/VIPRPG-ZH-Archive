/** Reclaim published package bytes without deleting release/build identities. */
export async function sweepToolArtifacts(env, limit) {
  const rows = (await env.DB.prepare(`SELECT * FROM tool_artifact_gc_candidates
    ORDER BY CASE storage_status WHEN 'cleanup' THEN 0 ELSE 1 END, updated_at, id LIMIT ?`)
    .bind(limit).all()).results ?? [];
  const report = { scannedCount: rows.length, purgedCount: 0, purgedSizeBytes: 0, skippedCount: 0, failedCount: 0, failed: [] };
  for (const row of rows) {
    try {
      if (row.storage_status === "ready") {
        // A broken replacement must never cause removal of the working old package.
        const replacement = await env.DB.prepare("SELECT * FROM tool_artifacts WHERE id=? AND storage_status='ready'")
          .bind(row.replacement_id).first();
        const object = replacement && await env.ARCHIVE_BUCKET.head(replacement.object_key);
        const checksum = object?.checksums?.sha256;
        const sha = checksum && Array.from(new Uint8Array(checksum), (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (!object || object.size !== replacement.size_bytes || sha !== replacement.sha256)
          throw new Error("新版安装包缺失或校验失败，保留旧包");
        // Re-evaluate publication/recommendation after the R2 check, atomically.
        // Channel triggers then prevent recommending this package while deleting it.
        const claimed = await env.DB.prepare(`UPDATE tool_artifacts SET storage_status='cleanup',updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND storage_status='ready' AND EXISTS(
            SELECT 1 FROM tool_artifact_gc_candidates c WHERE c.id=tool_artifacts.id AND c.replacement_id=?) RETURNING id`)
          .bind(row.id, row.replacement_id).first();
        if (!claimed) { report.skippedCount++; continue; }
      }
      // Deletion is idempotent. Failures stay in cleanup for the next scheduled run.
      await env.ARCHIVE_BUCKET.delete(row.object_key);
      const result = await env.DB.batch([
        env.DB.prepare(`UPDATE tool_artifacts SET storage_status='cleaned',updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND storage_status='cleanup' RETURNING id`).bind(row.id),
        env.DB.prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
          SELECT NULL,NULL,'resource_artifact_auto_cleaned',? WHERE changes()=1`)
          .bind(JSON.stringify({ resourceId: row.resource_id, releaseId: row.release_id, artifactId: row.id, sha256: row.sha256, sizeBytes: row.size_bytes })),
      ]);
      if (result[0].results?.length) {
        report.purgedCount++;
        report.purgedSizeBytes += row.size_bytes;
      } else report.skippedCount++;
    } catch (error) {
      report.failedCount++;
      if (report.failed.length < 25) report.failed.push({ artifactId: row.id, error: String(error) });
    }
  }
  return report;
}
