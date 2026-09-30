-- Keep historical request counters. Their response ranges and error causes were
-- not retained, so new classified counters start at zero rather than guessing.
ALTER TABLE download_builds ADD COLUMN full_download_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN range_download_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN full_cache_hit_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN interrupted_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN server_failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN total_bytes_served INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN cached_bytes_served INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN observed_r2_get_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN last_failure_kind TEXT
  CHECK (last_failure_kind IN ('interrupted', 'server', 'unknown'));
ALTER TABLE download_builds ADD COLUMN last_failure_at TEXT;
ALTER TABLE download_builds ADD COLUMN last_failure_duration_ms INTEGER;
ALTER TABLE download_builds ADD COLUMN last_success_at TEXT;
ALTER TABLE download_builds ADD COLUMN last_failure_message TEXT;

UPDATE download_builds SET
  last_failure_kind = 'unknown',
  last_failure_at = CASE WHEN status = 'failed' THEN last_accessed_at END,
  last_failure_message = last_error_message,
  last_failure_duration_ms = CASE WHEN status = 'failed' THEN last_duration_ms END
WHERE failure_count > 0;

UPDATE download_builds SET last_success_at = last_accessed_at
WHERE status = 'ready' AND download_count > 0;
