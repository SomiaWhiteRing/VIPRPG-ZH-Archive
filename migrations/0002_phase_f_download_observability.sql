ALTER TABLE download_builds ADD COLUMN cache_hit_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN cache_miss_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN cache_bypass_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN total_r2_get_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE download_builds ADD COLUMN last_cache_status TEXT;
ALTER TABLE download_builds ADD COLUMN last_duration_ms INTEGER;
ALTER TABLE download_builds ADD COLUMN last_error_message TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_download_builds_cache_key
  ON download_builds(cache_key);
