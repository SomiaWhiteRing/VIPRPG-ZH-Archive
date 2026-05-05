ALTER TABLE archive_versions
  ADD COLUMN web_play_file_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE archive_versions
  ADD COLUMN web_play_size_bytes INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS archive_version_blob_refs (
  archive_version_id INTEGER NOT NULL
    REFERENCES archive_versions(id) ON DELETE CASCADE,
  blob_sha256 TEXT NOT NULL
    REFERENCES blobs(sha256),
  PRIMARY KEY (archive_version_id, blob_sha256)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_archive_version_blob_refs_blob
  ON archive_version_blob_refs(blob_sha256);

CREATE TABLE IF NOT EXISTS archive_version_core_pack_refs (
  archive_version_id INTEGER NOT NULL
    REFERENCES archive_versions(id) ON DELETE CASCADE,
  core_pack_id INTEGER NOT NULL
    REFERENCES core_packs(id),
  PRIMARY KEY (archive_version_id, core_pack_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_archive_version_core_pack_refs_core_pack
  ON archive_version_core_pack_refs(core_pack_id);

INSERT OR IGNORE INTO archive_version_blob_refs (
  archive_version_id,
  blob_sha256
)
SELECT DISTINCT
  archive_version_id,
  blob_sha256
FROM archive_version_files
WHERE storage_kind = 'blob'
  AND blob_sha256 IS NOT NULL;

INSERT OR IGNORE INTO archive_version_core_pack_refs (
  archive_version_id,
  core_pack_id
)
SELECT DISTINCT
  archive_version_id,
  core_pack_id
FROM archive_version_files
WHERE storage_kind = 'core_pack'
  AND core_pack_id IS NOT NULL;

UPDATE archive_versions
SET
  web_play_file_count = (
    SELECT COUNT(*)
    FROM archive_version_files avf
    WHERE avf.archive_version_id = archive_versions.id
      AND LOWER(avf.path) NOT LIKE '%.dll'
      AND LOWER(avf.path) NOT LIKE '%.exe'
      AND LOWER(avf.path) NOT LIKE '%.txt'
  ),
  web_play_size_bytes = (
    SELECT COALESCE(SUM(avf.size_bytes), 0)
    FROM archive_version_files avf
    WHERE avf.archive_version_id = archive_versions.id
      AND LOWER(avf.path) NOT LIKE '%.dll'
      AND LOWER(avf.path) NOT LIKE '%.exe'
      AND LOWER(avf.path) NOT LIKE '%.txt'
  );

DROP TABLE archive_version_files;
