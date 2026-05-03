ALTER TABLE archive_versions ADD COLUMN purged_at TEXT;

CREATE INDEX IF NOT EXISTS idx_archive_versions_deleted_purge
  ON archive_versions(status, deleted_at, purged_at);
