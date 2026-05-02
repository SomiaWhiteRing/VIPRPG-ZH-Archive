ALTER TABLE download_builds ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE import_jobs ADD COLUMN missing_blob_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN missing_core_pack_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN uploaded_blob_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN uploaded_blob_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN uploaded_core_pack_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN uploaded_core_pack_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN manifest_put_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN manifest_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN r2_put_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN preflight_duration_ms INTEGER;
ALTER TABLE import_jobs ADD COLUMN upload_duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_jobs ADD COLUMN commit_duration_ms INTEGER;
ALTER TABLE import_jobs ADD COLUMN failed_stage TEXT;
