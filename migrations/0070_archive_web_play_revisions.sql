-- Unmodified archives use their existing manifest identity without a backfill.
CREATE TABLE archive_web_play_revisions (
  archive_version_id INTEGER NOT NULL REFERENCES archive_versions(id) ON DELETE CASCADE,
  manifest_sha256 TEXT NOT NULL,
  previous_manifest_sha256 TEXT,
  web_play_revision TEXT,
  PRIMARY KEY (archive_version_id, manifest_sha256)
) WITHOUT ROWID;

CREATE TRIGGER archive_versions_track_web_play_revision
AFTER UPDATE OF manifest_sha256 ON archive_versions
WHEN OLD.manifest_sha256 <> NEW.manifest_sha256
BEGIN
  INSERT OR IGNORE INTO archive_web_play_revisions
    VALUES (OLD.id, OLD.manifest_sha256, NULL, OLD.manifest_sha256);
  INSERT OR IGNORE INTO archive_web_play_revisions
    VALUES (NEW.id, NEW.manifest_sha256, OLD.manifest_sha256, NULL);
END;
