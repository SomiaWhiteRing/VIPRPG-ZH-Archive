import { getD1 } from "@/lib/server/db/d1";

export type DownloadCacheStatus = "HIT" | "MISS" | "BYPASS";

export async function recordDownloadAccess(input: {
  archiveVersionId: number;
  manifestSha256: string;
  cacheKey: string;
  cacheStatus: DownloadCacheStatus;
  sizeBytes: number;
  estimatedR2GetCount: number;
  actualR2GetCount: number;
  durationMs: number;
}): Promise<void> {
  const hitIncrement = input.cacheStatus === "HIT" ? 1 : 0;
  const missIncrement = input.cacheStatus === "MISS" ? 1 : 0;
  const bypassIncrement = input.cacheStatus === "BYPASS" ? 1 : 0;

  await getD1()
    .prepare(
      `INSERT INTO download_builds (
        archive_version_id,
        manifest_sha256,
        cache_key,
        status,
        size_bytes,
        estimated_r2_get_count,
        actual_r2_get_count,
        download_count,
        cache_hit_count,
        cache_miss_count,
        cache_bypass_count,
        total_r2_get_count,
        last_cache_status,
        last_duration_ms,
        created_at,
        last_accessed_at
      ) VALUES (?, ?, ?, 'ready', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET
        status = 'ready',
        size_bytes = excluded.size_bytes,
        estimated_r2_get_count = excluded.estimated_r2_get_count,
        actual_r2_get_count = COALESCE(download_builds.actual_r2_get_count, 0) + excluded.actual_r2_get_count,
        download_count = download_builds.download_count + 1,
        cache_hit_count = download_builds.cache_hit_count + excluded.cache_hit_count,
        cache_miss_count = download_builds.cache_miss_count + excluded.cache_miss_count,
        cache_bypass_count = download_builds.cache_bypass_count + excluded.cache_bypass_count,
        total_r2_get_count = download_builds.total_r2_get_count + excluded.total_r2_get_count,
        last_cache_status = excluded.last_cache_status,
        last_duration_ms = excluded.last_duration_ms,
        last_error_message = NULL,
        last_accessed_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      input.archiveVersionId,
      input.manifestSha256,
      input.cacheKey,
      input.sizeBytes,
      input.estimatedR2GetCount,
      input.actualR2GetCount,
      hitIncrement,
      missIncrement,
      bypassIncrement,
      input.actualR2GetCount,
      input.cacheStatus,
      input.durationMs,
    )
    .run();
}

export async function markDownloadCachePut(cacheKey: string): Promise<void> {
  await getD1()
    .prepare(
      `UPDATE download_builds
      SET last_cache_put_at = CURRENT_TIMESTAMP
      WHERE cache_key = ?`,
    )
    .bind(cacheKey)
    .run();
}

export async function recordDownloadFailure(input: {
  archiveVersionId: number;
  manifestSha256: string;
  cacheKey: string;
  estimatedR2GetCount: number;
  durationMs: number;
  errorMessage: string;
}): Promise<void> {
  await getD1()
    .prepare(
      `INSERT INTO download_builds (
        archive_version_id,
        manifest_sha256,
        cache_key,
        status,
        estimated_r2_get_count,
        download_count,
        failure_count,
        last_duration_ms,
        last_error_message,
        created_at,
        last_accessed_at
      ) VALUES (?, ?, ?, 'failed', ?, 0, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(cache_key) DO UPDATE SET
        status = 'failed',
        estimated_r2_get_count = excluded.estimated_r2_get_count,
        failure_count = download_builds.failure_count + 1,
        last_duration_ms = excluded.last_duration_ms,
        last_error_message = excluded.last_error_message,
        last_accessed_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      input.archiveVersionId,
      input.manifestSha256,
      input.cacheKey,
      input.estimatedR2GetCount,
      Math.max(0, input.durationMs),
      input.errorMessage.slice(0, 1000),
    )
    .run();
}

export function cacheKeyFromRequest(request: Request): string {
  const url = new URL(request.url);

  return `${url.pathname}${url.search}`;
}
