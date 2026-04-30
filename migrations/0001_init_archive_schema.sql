CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_auth_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'uploader')) DEFAULT 'uploader',
  upload_status TEXT NOT NULL CHECK (upload_status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  approved_by_user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_original TEXT,
  author TEXT,
  original_release_date TEXT,
  original_release_precision TEXT NOT NULL CHECK (original_release_precision IN ('year', 'month', 'day', 'unknown')) DEFAULT 'unknown',
  description TEXT,
  tags_text TEXT,
  icon_blob_sha256 TEXT REFERENCES blobs(sha256),
  preview_blob_sha256 TEXT REFERENCES blobs(sha256),
  uses_maniacs_patch INTEGER NOT NULL DEFAULT 0,
  is_proofread INTEGER NOT NULL DEFAULT 0,
  is_image_edited INTEGER NOT NULL DEFAULT 0,
  engine_version TEXT,
  source_name TEXT,
  source_url TEXT,
  language TEXT,
  executable_path TEXT,
  rights_notes TEXT,
  uploader_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS game_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT,
  manifest_sha256 TEXT NOT NULL,
  file_policy_version TEXT NOT NULL,
  source_file_count INTEGER NOT NULL DEFAULT 0,
  source_size_bytes INTEGER NOT NULL DEFAULT 0,
  excluded_file_count INTEGER NOT NULL DEFAULT 0,
  excluded_size_bytes INTEGER NOT NULL DEFAULT 0,
  total_files INTEGER NOT NULL DEFAULT 0,
  total_size_bytes INTEGER NOT NULL DEFAULT 0,
  unique_size_bytes INTEGER NOT NULL DEFAULT 0,
  core_pack_count INTEGER NOT NULL DEFAULT 0,
  core_pack_size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  UNIQUE (game_id, version_label)
);

CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL,
  content_type_hint TEXT,
  observed_ext TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  storage_class TEXT NOT NULL DEFAULT 'standard',
  first_seen_game_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS core_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  uncompressed_size_bytes INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL DEFAULT 'zip',
  compression TEXT NOT NULL DEFAULT 'deflate-low',
  storage_class TEXT NOT NULL DEFAULT 'standard',
  first_seen_game_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS game_version_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  path_sort_key TEXT NOT NULL,
  path_bytes_b64 TEXT,
  role TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('blob', 'core_pack')),
  blob_sha256 TEXT REFERENCES blobs(sha256),
  core_pack_id INTEGER REFERENCES core_packs(id),
  pack_entry_path TEXT,
  mtime_ms INTEGER,
  file_mode INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (game_version_id, path),
  CHECK (
    (storage_kind = 'blob'
      AND blob_sha256 IS NOT NULL
      AND core_pack_id IS NULL
      AND pack_entry_path IS NULL)
    OR
    (storage_kind = 'core_pack'
      AND blob_sha256 IS NULL
      AND core_pack_id IS NOT NULL
      AND pack_entry_path IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_game_version_files_version
  ON game_version_files(game_version_id, path_sort_key);

CREATE INDEX IF NOT EXISTS idx_game_version_files_file_sha256
  ON game_version_files(file_sha256);

CREATE INDEX IF NOT EXISTS idx_game_version_files_blob_sha256
  ON game_version_files(blob_sha256);

CREATE INDEX IF NOT EXISTS idx_game_version_files_core_pack
  ON game_version_files(core_pack_id);

CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  game_version_id INTEGER REFERENCES game_versions(id) ON DELETE SET NULL,
  uploader_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'created',
  source_name TEXT,
  source_size_bytes INTEGER,
  file_count INTEGER NOT NULL DEFAULT 0,
  excluded_file_count INTEGER NOT NULL DEFAULT 0,
  excluded_size_bytes INTEGER NOT NULL DEFAULT 0,
  file_policy_version TEXT,
  missing_blob_count INTEGER NOT NULL DEFAULT 0,
  missing_core_pack_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS import_job_excluded_file_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_job_id INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  file_type TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_size_bytes INTEGER NOT NULL DEFAULT 0,
  example_path TEXT,
  UNIQUE (import_job_id, file_type)
);

CREATE TABLE IF NOT EXISTS download_builds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_version_id INTEGER NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  manifest_sha256 TEXT NOT NULL,
  cache_key TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  size_bytes INTEGER,
  estimated_r2_get_count INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT,
  last_cache_put_at TEXT
);
