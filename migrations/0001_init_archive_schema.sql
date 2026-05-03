CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_auth_id TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT,
  password_updated_at TEXT,
  display_name TEXT NOT NULL,
  role_key TEXT NOT NULL CHECK (
    role_key IN ('super_admin', 'admin', 'uploader', 'user')
  ) DEFAULT 'user',
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')) DEFAULT 'active',
  email_verified_at TEXT,
  last_login_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_role_key
  ON users(role_key, created_at);

CREATE TABLE IF NOT EXISTS email_verification_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'password_reset')),
  code_hash TEXT NOT NULL,
  pending_password_hash TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  send_count INTEGER NOT NULL DEFAULT 1,
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_verification_challenges_email
  ON email_verification_challenges(email, created_at);

CREATE INDEX IF NOT EXISTS idx_email_verification_challenges_expires
  ON email_verification_challenges(expires_at);

CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON user_sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  event_type TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (
    type IN ('role_change_request', 'role_change_notice', 'system_notice')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('open', 'pending', 'approved', 'rejected', 'archived')
  ) DEFAULT 'open',
  sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  audience_min_role_key TEXT CHECK (
    audience_min_role_key IN ('super_admin', 'admin', 'uploader', 'user')
  ),
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_role_key TEXT CHECK (
    requested_role_key IN ('super_admin', 'admin', 'uploader', 'user')
  ),
  old_role_key TEXT CHECK (
    old_role_key IN ('super_admin', 'admin', 'uploader', 'user')
  ),
  new_role_key TEXT CHECK (
    new_role_key IN ('super_admin', 'admin', 'uploader', 'user')
  ),
  resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (recipient_user_id IS NOT NULL OR audience_min_role_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_inbox_items_recipient
  ON inbox_items(recipient_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inbox_items_audience
  ON inbox_items(audience_min_role_key, status, created_at);

CREATE INDEX IF NOT EXISTS idx_inbox_items_target
  ON inbox_items(target_user_id, type, status);

CREATE TABLE IF NOT EXISTS inbox_item_reads (
  item_id INTEGER NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  PRIMARY KEY (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_role_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_role_key TEXT NOT NULL CHECK (
    old_role_key IN ('super_admin', 'admin', 'uploader', 'user')
  ),
  new_role_key TEXT NOT NULL CHECK (
    new_role_key IN ('super_admin', 'admin', 'uploader', 'user')
  ),
  reason TEXT,
  source_inbox_item_id INTEGER REFERENCES inbox_items(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_role_events_target
  ON user_role_events(target_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_user_role_events_actor
  ON user_role_events(actor_user_id, created_at);

CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  original_title TEXT NOT NULL UNIQUE,
  chinese_title TEXT,
  sort_title TEXT,
  description TEXT,
  original_release_date TEXT,
  original_release_precision TEXT NOT NULL CHECK (
    original_release_precision IN ('year', 'month', 'day', 'unknown')
  ) DEFAULT 'unknown',
  engine_family TEXT NOT NULL CHECK (
    engine_family IN ('rpg_maker_2000', 'rpg_maker_2003', 'mixed', 'unknown', 'other')
  ) DEFAULT 'unknown',
  engine_detail TEXT,
  uses_maniacs_patch INTEGER NOT NULL DEFAULT 0,
  icon_blob_sha256 TEXT REFERENCES blobs(sha256),
  thumbnail_blob_sha256 TEXT REFERENCES blobs(sha256),
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'published', 'hidden', 'deleted')
  ) DEFAULT 'draft',
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_works_status_title
  ON works(status, sort_title, original_title);

CREATE TABLE IF NOT EXISTS work_titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  language TEXT,
  title_type TEXT NOT NULL CHECK (
    title_type IN ('alias')
  ),
  is_searchable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (work_id, title, title_type)
);

CREATE INDEX IF NOT EXISTS idx_work_titles_title
  ON work_titles(title);

CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_original TEXT,
  description TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'published', 'hidden', 'deleted')
  ) DEFAULT 'draft',
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_series (
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  position_number REAL,
  position_label TEXT,
  relation_kind TEXT NOT NULL CHECK (
    relation_kind IN ('main', 'side', 'collection_member', 'same_setting', 'other')
  ) DEFAULT 'main',
  notes TEXT,
  PRIMARY KEY (series_id, work_id)
);

CREATE INDEX IF NOT EXISTS idx_work_series_order
  ON work_series(series_id, position_number, position_label);

CREATE TABLE IF NOT EXISTS work_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  to_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN (
      'prequel',
      'sequel',
      'side_story',
      'same_setting',
      'remake',
      'remaster',
      'fan_disc',
      'alternate_version',
      'translation_source',
      'inspired_by',
      'other'
    )
  ),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (from_work_id, to_work_id, relation_type),
  CHECK (from_work_id <> to_work_id)
);

CREATE INDEX IF NOT EXISTS idx_work_relations_from
  ON work_relations(from_work_id, relation_type);

CREATE INDEX IF NOT EXISTS idx_work_relations_to
  ON work_relations(to_work_id, relation_type);

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  release_key TEXT NOT NULL,
  release_label TEXT NOT NULL,
  base_variant TEXT NOT NULL CHECK (
    base_variant IN ('original', 'remake', 'other')
  ) DEFAULT 'original',
  variant_label TEXT NOT NULL DEFAULT 'default',
  release_type TEXT NOT NULL CHECK (
    release_type IN (
      'original',
      'translation',
      'revision',
      'localized_revision',
      'demo',
      'event_submission',
      'patch_applied_full_release',
      'repack',
      'other'
    )
  ) DEFAULT 'original',
  release_date TEXT,
  release_date_precision TEXT NOT NULL CHECK (
    release_date_precision IN ('year', 'month', 'day', 'unknown')
  ) DEFAULT 'unknown',
  source_name TEXT,
  source_url TEXT,
  executable_path TEXT,
  rights_notes TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'published', 'hidden', 'deleted')
  ) DEFAULT 'draft',
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  UNIQUE (work_id, release_key)
);

CREATE INDEX IF NOT EXISTS idx_releases_work_status
  ON releases(work_id, status, release_date);

CREATE TABLE IF NOT EXISTS archive_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  archive_key TEXT NOT NULL,
  archive_label TEXT NOT NULL,
  archive_variant_label TEXT NOT NULL DEFAULT 'default',
  language TEXT NOT NULL,
  is_proofread INTEGER NOT NULL DEFAULT 0,
  is_image_edited INTEGER NOT NULL DEFAULT 0,
  manifest_sha256 TEXT NOT NULL,
  manifest_r2_key TEXT NOT NULL UNIQUE,
  file_policy_version TEXT NOT NULL,
  packer_version TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('browser_folder', 'browser_zip', 'preindexed_manifest')
  ),
  source_name TEXT,
  source_file_count INTEGER NOT NULL DEFAULT 0,
  source_size_bytes INTEGER NOT NULL DEFAULT 0,
  excluded_file_count INTEGER NOT NULL DEFAULT 0,
  excluded_size_bytes INTEGER NOT NULL DEFAULT 0,
  total_files INTEGER NOT NULL DEFAULT 0,
  total_size_bytes INTEGER NOT NULL DEFAULT 0,
  unique_blob_size_bytes INTEGER NOT NULL DEFAULT 0,
  core_pack_count INTEGER NOT NULL DEFAULT 0,
  core_pack_size_bytes INTEGER NOT NULL DEFAULT 0,
  estimated_r2_get_count INTEGER NOT NULL DEFAULT 0,
  is_current INTEGER NOT NULL DEFAULT 0,
  uploader_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL CHECK (
    status IN ('draft', 'published', 'hidden', 'deleted')
  ) DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  deleted_at TEXT,
  UNIQUE (release_id, archive_key, archive_label),
  UNIQUE (release_id, archive_key, manifest_sha256)
);

CREATE INDEX IF NOT EXISTS idx_archive_versions_release
  ON archive_versions(release_id, archive_key, status, is_current);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_versions_one_current
  ON archive_versions(release_id, archive_key)
  WHERE is_current = 1 AND status = 'published';

CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL,
  content_type_hint TEXT,
  observed_ext TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  storage_class TEXT NOT NULL DEFAULT 'standard',
  first_seen_archive_version_id INTEGER REFERENCES archive_versions(id),
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
  first_seen_archive_version_id INTEGER REFERENCES archive_versions(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS archive_version_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_version_id INTEGER NOT NULL REFERENCES archive_versions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  path_sort_key TEXT NOT NULL,
  path_bytes_b64 TEXT,
  role TEXT NOT NULL CHECK (
    role IN ('map', 'database', 'asset', 'runtime', 'metadata', 'other')
  ),
  file_sha256 TEXT NOT NULL,
  crc32 INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('blob', 'core_pack')),
  blob_sha256 TEXT REFERENCES blobs(sha256),
  core_pack_id INTEGER REFERENCES core_packs(id),
  pack_entry_path TEXT,
  mtime_ms INTEGER,
  file_mode INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (archive_version_id, path),
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

CREATE INDEX IF NOT EXISTS idx_archive_version_files_version
  ON archive_version_files(archive_version_id, path_sort_key);

CREATE INDEX IF NOT EXISTS idx_archive_version_files_file_sha256
  ON archive_version_files(file_sha256);

CREATE INDEX IF NOT EXISTS idx_archive_version_files_blob_sha256
  ON archive_version_files(blob_sha256);

CREATE INDEX IF NOT EXISTS idx_archive_version_files_core_pack
  ON archive_version_files(core_pack_id);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  primary_name TEXT NOT NULL,
  original_name TEXT,
  description TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_characters (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (
    role_key IN ('main', 'supporting', 'cameo', 'mentioned', 'other')
  ) DEFAULT 'supporting',
  spoiler_level INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER,
  notes TEXT,
  PRIMARY KEY (work_id, character_id)
);

CREATE TABLE IF NOT EXISTS creators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  original_name TEXT,
  website_url TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_staff (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (
    role_key IN ('author', 'scenario', 'graphics', 'music', 'translator', 'editor', 'publisher', 'other')
  ),
  role_label TEXT,
  notes TEXT,
  PRIMARY KEY (work_id, creator_id, role_key)
);

CREATE TABLE IF NOT EXISTS release_staff (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (
    role_key IN ('author', 'translator', 'proofreader', 'image_editor', 'publisher', 'repacker', 'other')
  ),
  role_label TEXT,
  notes TEXT,
  PRIMARY KEY (release_id, creator_id, role_key)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_original TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('viprpg', 'contest', 'collection', 'personal_release', 'other')
  ) DEFAULT 'viprpg',
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  source_url TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS release_events (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entry_label TEXT,
  entry_number TEXT,
  notes TEXT,
  PRIMARY KEY (release_id, event_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  namespace TEXT NOT NULL CHECK (
    namespace IN ('genre', 'theme', 'character', 'technical', 'content', 'other')
  ) DEFAULT 'other',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_tags (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('admin', 'uploader', 'imported')) DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (work_id, tag_id)
);

CREATE TABLE IF NOT EXISTS release_tags (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('admin', 'uploader', 'imported')) DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (release_id, tag_id)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  kind TEXT NOT NULL CHECK (
    kind IN ('icon', 'cover', 'preview', 'screenshot', 'banner', 'other')
  ),
  title TEXT,
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (blob_sha256, kind)
);

CREATE TABLE IF NOT EXISTS work_media_assets (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  media_asset_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  sort_order INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, media_asset_id)
);

CREATE TABLE IF NOT EXISTS release_media_assets (
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  media_asset_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  sort_order INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, media_asset_id)
);

CREATE TABLE IF NOT EXISTS work_external_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (
    link_type IN ('official', 'wiki', 'source', 'video', 'download_page', 'other')
  ) DEFAULT 'other',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS release_external_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (
    link_type IN ('official', 'source', 'download_page', 'patch_note', 'other')
  ) DEFAULT 'source',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
  release_id INTEGER REFERENCES releases(id) ON DELETE SET NULL,
  archive_version_id INTEGER REFERENCES archive_versions(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_import_jobs_work
  ON import_jobs(work_id, created_at);

CREATE INDEX IF NOT EXISTS idx_import_jobs_release
  ON import_jobs(release_id, created_at);

CREATE INDEX IF NOT EXISTS idx_import_jobs_archive_version
  ON import_jobs(archive_version_id, created_at);

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
  archive_version_id INTEGER NOT NULL REFERENCES archive_versions(id) ON DELETE CASCADE,
  manifest_sha256 TEXT NOT NULL,
  cache_key TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('created', 'building', 'ready', 'failed', 'expired')
  ) DEFAULT 'created',
  size_bytes INTEGER,
  estimated_r2_get_count INTEGER,
  actual_r2_get_count INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT,
  last_cache_put_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_download_builds_archive_version
  ON download_builds(archive_version_id, status, created_at);
