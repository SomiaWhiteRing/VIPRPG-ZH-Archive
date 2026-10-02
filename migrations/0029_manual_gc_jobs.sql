-- A durable, actor-owned snapshot for the two-stage manual cleanup. Scanning
-- writes only this bookkeeping; it never reserves or changes business objects.
CREATE TABLE archive_gc_jobs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('scanning','ready','running','needs_retry','completed','cancelled')),
  phase TEXT NOT NULL CHECK (phase IN ('archives','blobs','core_packs','manifests')),
  cursor TEXT NOT NULL DEFAULT '',
  grace_days INTEGER NOT NULL CHECK (grace_days BETWEEN 0 AND 3650),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TEXT,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  lock_token TEXT,
  locked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX archive_gc_jobs_owner ON archive_gc_jobs(user_id,created_at DESC);
CREATE UNIQUE INDEX archive_gc_jobs_active_owner ON archive_gc_jobs(user_id)
  WHERE status IN ('scanning','ready','running','needs_retry');
CREATE TABLE archive_gc_job_items (
  job_id TEXT NOT NULL REFERENCES archive_gc_jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('archive','blob','core_pack','manifest')),
  object_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  object_exists INTEGER NOT NULL DEFAULT 0 CHECK (object_exists IN (0,1)),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','deleting','deleted','skipped','failed')),
  error TEXT,
  PRIMARY KEY(job_id,type,object_id)
) WITHOUT ROWID;
CREATE INDEX archive_gc_job_items_work ON archive_gc_job_items(job_id,state,type,object_id);
-- Used by the scheduler and storage/reference guards to avoid taking over a
-- manual deletion whose R2 result is uncertain and must be safely retried.
CREATE UNIQUE INDEX archive_gc_job_items_reserved ON archive_gc_job_items(type,object_id) WHERE state='deleting';

-- All manifest-deletion paths share this durable queue. A row without an owner
-- is retryable; an owned row is never stolen while an R2 request may be running.
CREATE TABLE archive_gc_manifest_deletions (
  sha256 TEXT PRIMARY KEY,
  lock_token TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT
);

-- A reference created after the final reference check must not revive a blob
-- while its R2 deletion is in flight. The other reference tables already have
-- active-object guards in the baseline; add only the missing entry points.
CREATE TRIGGER users_avatar_require_active_blob_insert
BEFORE INSERT ON users
WHEN NEW.avatar_blob_sha256 IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM blobs WHERE sha256=NEW.avatar_blob_sha256 AND status='active')
BEGIN
  SELECT RAISE(ABORT, 'user avatar blob must be active');
END;

CREATE TRIGGER face_emoji_refs_require_active_blob_insert
BEFORE INSERT ON face_emoji_refs
WHEN NOT EXISTS (SELECT 1 FROM blobs WHERE sha256=NEW.blob_sha256 AND status='active')
BEGIN
  SELECT RAISE(ABORT, 'face emoji blob must be active');
END;

CREATE TRIGGER catalogs_cover_require_active_blob_insert
BEFORE INSERT ON catalogs
WHEN NEW.status='published' AND NEW.cover_blob_sha256 IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM blobs WHERE sha256=NEW.cover_blob_sha256 AND status='active')
BEGIN
  SELECT RAISE(ABORT, 'published catalog cover blob must be active');
END;

CREATE TRIGGER catalogs_cover_require_active_blob_update
BEFORE UPDATE OF status,cover_blob_sha256 ON catalogs
WHEN NEW.status='published' AND NEW.cover_blob_sha256 IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM blobs WHERE sha256=NEW.cover_blob_sha256 AND status='active')
BEGIN
  SELECT RAISE(ABORT, 'published catalog cover blob must be active');
END;

CREATE TRIGGER blobs_purge_requires_unreferenced_catalog
BEFORE UPDATE OF status ON blobs
WHEN NEW.status IN ('purging','purged') AND EXISTS (
  SELECT 1 FROM catalogs WHERE cover_blob_sha256=OLD.sha256 AND status='published'
)
BEGIN
  SELECT RAISE(ABORT, 'referenced catalog cover blob cannot be purged');
END;

-- The archive reservation and reference release are one transaction. A late
-- import/link write must not add references back to the reserved archive.
CREATE TRIGGER archive_version_blob_refs_require_available_archive_insert
BEFORE INSERT ON archive_version_blob_refs
WHEN NOT EXISTS (SELECT 1 FROM archive_versions WHERE id=NEW.archive_version_id AND purged_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'purged archive version cannot accept blob references');
END;

CREATE TRIGGER archive_version_blob_refs_require_available_archive_update
BEFORE UPDATE OF archive_version_id ON archive_version_blob_refs
WHEN NOT EXISTS (SELECT 1 FROM archive_versions WHERE id=NEW.archive_version_id AND purged_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'purged archive version cannot accept blob references');
END;

CREATE TRIGGER archive_version_core_pack_refs_require_available_archive_insert
BEFORE INSERT ON archive_version_core_pack_refs
WHEN NOT EXISTS (SELECT 1 FROM archive_versions WHERE id=NEW.archive_version_id AND purged_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'purged archive version cannot accept core pack references');
END;

CREATE TRIGGER archive_version_core_pack_refs_require_available_archive_update
BEFORE UPDATE OF archive_version_id ON archive_version_core_pack_refs
WHEN NOT EXISTS (SELECT 1 FROM archive_versions WHERE id=NEW.archive_version_id AND purged_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'purged archive version cannot accept core pack references');
END;

-- A manifest has no separate business ledger. Its shared deletion queue entry
-- reserves the hash through both scheduled and manual R2 deletion attempts.
CREATE TRIGGER archive_versions_manifest_gc_insert_guard
BEFORE INSERT ON archive_versions
WHEN NEW.purged_at IS NULL AND EXISTS (
  SELECT 1 FROM archive_gc_manifest_deletions WHERE sha256=NEW.manifest_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'archive manifest is being garbage-collected; retry the import');
END;

CREATE TRIGGER archive_versions_manifest_gc_update_guard
BEFORE UPDATE OF manifest_sha256,purged_at ON archive_versions
WHEN NEW.purged_at IS NULL AND EXISTS (
  SELECT 1 FROM archive_gc_manifest_deletions WHERE sha256=NEW.manifest_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'archive manifest is being garbage-collected; retry the import');
END;
