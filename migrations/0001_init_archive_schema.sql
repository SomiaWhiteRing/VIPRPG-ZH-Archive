CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_auth_id TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT,
  password_updated_at TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')) DEFAULT 'active',
  email_verified_at TEXT,
  last_login_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('built_in', 'bootstrap_admin', 'custom')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (kind <> 'custom' OR priority BETWEEN 101 AND 699)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id, user_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_key, role_id);

INSERT OR IGNORE INTO roles (key, name, description, priority, kind)
VALUES
  ('user', '普通用户', '基础账户', 100, 'built_in'),
  ('uploader', '上传者', '可提交上传任务', 400, 'built_in'),
  ('admin', '管理员', '管理业务内容和用户角色', 700, 'built_in'),
  ('super_admin', '超级管理员', '唯一根账户', 1000, 'bootstrap_admin');

INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT roles.id, value FROM roles, json_each('["work.lookup_non_deleted","relation.create","relation.update_own","relation.delete_own","translation_relation.create","translation_relation.update_own","translation_relation.delete_own","catalog.create","catalog.update_own","catalog.delete_own","catalog.reorder_own"]')
WHERE roles.key = 'user';

INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT roles.id, value FROM roles, json_each('["work.lookup_non_deleted","work.update_own","work.external_create","import_job.create","import_job.cancel_own","import_job.preflight_own","import_job.commit_own","storage_object.upload","archive_version.delete_own","relation.create","relation.update_own","relation.delete_own","translation_relation.create","translation_relation.update_own","translation_relation.delete_own","catalog.create","catalog.update_own","catalog.delete_own","catalog.reorder_own"]')
WHERE roles.key = 'uploader';

INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT roles.id, value FROM roles, json_each('["work.lookup_non_deleted","work.update_own","work.external_create","import_job.create","import_job.cancel_own","import_job.preflight_own","import_job.commit_own","storage_object.upload","archive_version.delete_own","relation.create","relation.update_own","relation.delete_own","translation_relation.create","translation_relation.update_own","translation_relation.delete_own","catalog.create","catalog.update_own","catalog.delete_own","catalog.reorder_own","work.read_private","work.update","relation.manage_any","translation_relation.manage_any","catalog.manage_any","work_comment.manage_any","custom_emoji.manage","creator.read_private","creator.update","character.read_private","character.update","tag.read_private","tag.update","archive_version.read_private","archive_version.update","archive_version.delete_any","archive_version.restore","archive_version.set_current","user.read","user.status.update","user.role.assign","inbox.role_request.resolve","system.dashboard.read","system.maintenance.run"]')
WHERE roles.key IN ('admin', 'super_admin');

INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT roles.id, value FROM roles, json_each('["storage.gc.sweep","audit.read"]')
WHERE roles.key = 'super_admin';

CREATE TRIGGER IF NOT EXISTS users_assign_base_role
AFTER INSERT ON users
BEGIN
  INSERT OR IGNORE INTO user_roles (user_id, role_id)
  SELECT NEW.id, id FROM roles WHERE key = 'user';
END;

CREATE TRIGGER IF NOT EXISTS user_roles_unique_bootstrap_admin
BEFORE INSERT ON user_roles
WHEN (SELECT kind FROM roles WHERE id = NEW.role_id) = 'bootstrap_admin'
  AND EXISTS (
    SELECT 1 FROM user_roles existing
    JOIN roles r ON r.id = existing.role_id
    WHERE r.kind = 'bootstrap_admin' AND existing.user_id <> NEW.user_id
  )
BEGIN
  SELECT RAISE(ABORT, 'bootstrap admin already assigned');
END;

CREATE TRIGGER IF NOT EXISTS user_roles_require_active_role
BEFORE INSERT ON user_roles
WHEN (SELECT status FROM roles WHERE id = NEW.role_id) <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'inactive role cannot be assigned');
END;

CREATE TRIGGER IF NOT EXISTS user_roles_protect_base_role
BEFORE DELETE ON user_roles
WHEN (SELECT key FROM roles WHERE id = OLD.role_id) = 'user'
BEGIN
  SELECT RAISE(ABORT, 'base user role cannot be removed');
END;

CREATE TRIGGER IF NOT EXISTS roles_protect_identity
BEFORE UPDATE OF key, kind ON roles
BEGIN
  SELECT RAISE(ABORT, 'role identity cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS roles_protect_system_definition
BEFORE UPDATE ON roles
WHEN OLD.kind <> 'custom'
BEGIN
  SELECT RAISE(ABORT, 'system role cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS roles_protect_delete
BEFORE DELETE ON roles
BEGIN
  SELECT RAISE(ABORT, 'roles cannot be deleted; disable custom roles');
END;

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
  required_permission_key TEXT,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  requested_role_key_snapshot TEXT,
  requested_role_name_snapshot TEXT,
  role_event_id INTEGER REFERENCES user_role_events(id) ON DELETE SET NULL,
  resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (recipient_user_id IS NOT NULL OR required_permission_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_inbox_items_recipient
  ON inbox_items(recipient_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inbox_items_permission
  ON inbox_items(required_permission_key, status, created_at);

CREATE INDEX IF NOT EXISTS idx_inbox_items_target
  ON inbox_items(target_user_id, type, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_pending_role_request
  ON inbox_items(target_user_id, requested_role_id)
  WHERE type = 'role_change_request'
    AND status = 'pending'
    AND target_user_id IS NOT NULL
    AND requested_role_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inbox_item_reads (
  item_id INTEGER NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  PRIMARY KEY (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_role_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('assigned', 'removed')),
  role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  role_key_snapshot TEXT NOT NULL,
  role_name_snapshot TEXT NOT NULL,
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
  original_title TEXT NOT NULL,
  chinese_title TEXT,
  description TEXT,
  is_original INTEGER NOT NULL DEFAULT 0 CHECK (is_original IN (0, 1)),
  language TEXT NOT NULL DEFAULT 'zh-CN' CHECK (
    language IN ('zh-CN', 'ja', 'en', 'zh-TW', 'ko', 'fr', 'de', 'es', 'ru', 'pt-BR', 'it', 'th', 'vi')
  ),
  original_release_date TEXT,
  original_release_precision TEXT NOT NULL CHECK (
    original_release_precision IN ('year', 'month', 'day', 'unknown')
  ) DEFAULT 'unknown',
  engine_family TEXT NOT NULL CHECK (
    engine_family IN (
      'rpg_maker_2000', 'rpg_maker_2003', 'rpg_maker_2003_maniac',
      'rpg_maker_xp', 'rpg_maker_vx', 'rpg_maker_vx_ace',
      'rpg_maker_mv', 'rpg_maker_mz', 'rpg_maker_unite',
      'mixed', 'unknown', 'other'
    )
  ) DEFAULT 'unknown',
  status TEXT NOT NULL CHECK (
    status IN ('processing', 'published', 'hidden', 'deleted')
  ) DEFAULT 'processing',
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_works_original_title
  ON works(original_title);

CREATE TABLE IF NOT EXISTS work_engagement_stats (
  work_id INTEGER PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_work_entries (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_played_at TEXT,
  wishlisted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (work_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_work_entries_played
  ON user_work_entries(user_id, last_played_at DESC, work_id)
  WHERE last_played_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_work_entries_wishlist
  ON user_work_entries(user_id, wishlisted_at DESC, work_id)
  WHERE wishlisted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS work_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  root_comment_id INTEGER REFERENCES work_comments(id) ON DELETE CASCADE,
  reply_to_comment_id INTEGER REFERENCES work_comments(id) ON DELETE SET NULL,
  body TEXT,
  status TEXT NOT NULL CHECK (status IN ('published', 'hidden', 'deleted')) DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT,
  CHECK (
    (status = 'deleted' AND body IS NULL)
    OR (status <> 'deleted' AND body IS NOT NULL AND length(trim(body)) > 0)
  ),
  CHECK (root_comment_id IS NULL OR root_comment_id <> id),
  CHECK (reply_to_comment_id IS NULL OR reply_to_comment_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_work_comments_public_roots
  ON work_comments(work_id, created_at, id)
  WHERE root_comment_id IS NULL AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_work_comments_root_replies
  ON work_comments(root_comment_id, created_at, id)
  WHERE root_comment_id IS NOT NULL AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_work_comments_author
  ON work_comments(user_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS work_comment_likes (
  comment_id INTEGER NOT NULL REFERENCES work_comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS work_uploaders (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (work_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_work_uploaders_user
  ON work_uploaders(user_id, work_id);

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

CREATE TABLE IF NOT EXISTS work_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  to_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (
    relation_type IN (
      'adaptation',
      'prequel',
      'sequel',
      'same_setting',
      'alternative_setting',
      'alternative_version',
      'character',
      'collaboration',
      'version',
      'main_version',
      'collection',
      'in_collection'
    )
  ),
  vice_versa INTEGER NOT NULL DEFAULT 0 CHECK (vice_versa IN (0, 1)),
  relation_order REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (from_work_id, to_work_id, relation_type, vice_versa),
  CHECK (from_work_id <> to_work_id)
);

CREATE INDEX IF NOT EXISTS idx_work_relations_from
  ON work_relations(from_work_id, relation_type);

CREATE INDEX IF NOT EXISTS idx_work_relations_to
  ON work_relations(to_work_id, relation_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_relations_logical_source
  ON work_relations(
    CASE WHEN from_work_id < to_work_id THEN from_work_id ELSE to_work_id END,
    CASE WHEN from_work_id < to_work_id THEN to_work_id ELSE from_work_id END,
    CASE
      WHEN relation_type IN ('prequel', 'sequel') THEN 'prequel_sequel'
      WHEN relation_type IN ('version', 'main_version') THEN 'version'
      WHEN relation_type IN ('collection', 'in_collection') THEN 'collection'
      ELSE relation_type
    END
  )
  WHERE vice_versa = 0 AND relation_type <> 'collaboration';

CREATE TABLE IF NOT EXISTS translation_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  target_role TEXT NOT NULL CHECK (target_role IN ('original', 'translation')),
  target_work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  vice_versa INTEGER NOT NULL DEFAULT 0 CHECK (vice_versa IN (0, 1)),
  relation_order REAL NOT NULL DEFAULT 0,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_work_id, target_work_id, vice_versa),
  CHECK (source_work_id <> target_work_id)
);

CREATE INDEX IF NOT EXISTS idx_translation_relations_source
  ON translation_relations(source_work_id, target_role, relation_order);

CREATE INDEX IF NOT EXISTS idx_translation_relations_target
  ON translation_relations(target_work_id, target_role);

CREATE UNIQUE INDEX IF NOT EXISTS idx_translation_relations_one_original
  ON translation_relations(source_work_id)
  WHERE target_role = 'original';

CREATE UNIQUE INDEX IF NOT EXISTS idx_translation_relations_logical_source
  ON translation_relations(
    CASE WHEN source_work_id < target_work_id THEN source_work_id ELSE target_work_id END,
    CASE WHEN source_work_id < target_work_id THEN target_work_id ELSE source_work_id END
  )
  WHERE vice_versa = 0;

CREATE TRIGGER IF NOT EXISTS translation_relations_require_distinct_languages
BEFORE INSERT ON translation_relations
WHEN (SELECT language FROM works WHERE id = NEW.source_work_id) =
  (SELECT language FROM works WHERE id = NEW.target_work_id)
BEGIN
  SELECT RAISE(ABORT, 'translation languages must differ');
END;

CREATE TRIGGER IF NOT EXISTS translation_relations_update_require_distinct_languages
BEFORE UPDATE OF source_work_id, target_work_id ON translation_relations
WHEN (SELECT language FROM works WHERE id = NEW.source_work_id) =
  (SELECT language FROM works WHERE id = NEW.target_work_id)
BEGIN
  SELECT RAISE(ABORT, 'translation languages must differ');
END;

CREATE TRIGGER IF NOT EXISTS translation_relations_require_consistent_roles
BEFORE INSERT ON translation_relations
WHEN EXISTS (
  SELECT 1 FROM translation_relations existing
  WHERE (
    existing.source_work_id = NEW.source_work_id
    AND (CASE WHEN existing.target_role = 'original' THEN 'translation' ELSE 'original' END)
      <> (CASE WHEN NEW.target_role = 'original' THEN 'translation' ELSE 'original' END)
  ) OR (
    existing.target_work_id = NEW.source_work_id
    AND existing.target_role <> (CASE WHEN NEW.target_role = 'original' THEN 'translation' ELSE 'original' END)
  ) OR (
    existing.source_work_id = NEW.target_work_id
    AND (CASE WHEN existing.target_role = 'original' THEN 'translation' ELSE 'original' END) <> NEW.target_role
  ) OR (
    existing.target_work_id = NEW.target_work_id
    AND existing.target_role <> NEW.target_role
  )
)
BEGIN
  SELECT RAISE(ABORT, 'translation role conflict');
END;

CREATE TRIGGER IF NOT EXISTS translation_relations_update_require_consistent_roles
BEFORE UPDATE OF source_work_id, target_work_id, target_role ON translation_relations
WHEN EXISTS (
  SELECT 1 FROM translation_relations existing
  WHERE existing.id <> NEW.id
  AND (
    (
      existing.source_work_id = NEW.source_work_id
      AND (CASE WHEN existing.target_role = 'original' THEN 'translation' ELSE 'original' END)
        <> (CASE WHEN NEW.target_role = 'original' THEN 'translation' ELSE 'original' END)
    ) OR (
      existing.target_work_id = NEW.source_work_id
      AND existing.target_role <> (CASE WHEN NEW.target_role = 'original' THEN 'translation' ELSE 'original' END)
    ) OR (
      existing.source_work_id = NEW.target_work_id
      AND (CASE WHEN existing.target_role = 'original' THEN 'translation' ELSE 'original' END) <> NEW.target_role
    ) OR (
      existing.target_work_id = NEW.target_work_id
      AND existing.target_role <> NEW.target_role
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'translation role conflict');
END;

CREATE TRIGGER IF NOT EXISTS works_translation_language_update_guard
BEFORE UPDATE OF language ON works
WHEN EXISTS (
  SELECT 1
  FROM translation_relations relation
  JOIN works other ON other.id = CASE
    WHEN relation.source_work_id = NEW.id THEN relation.target_work_id
    ELSE relation.source_work_id
  END
  WHERE (relation.source_work_id = NEW.id OR relation.target_work_id = NEW.id)
    AND other.language = NEW.language
)
BEGIN
  SELECT RAISE(ABORT, 'translation languages must differ');
END;

CREATE TABLE IF NOT EXISTS catalogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('published', 'deleted')) DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_catalogs_owner_status
  ON catalogs(owner_user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS catalog_items (
  catalog_id INTEGER NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  sort_order REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (catalog_id, work_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_order
  ON catalog_items(catalog_id, sort_order, work_id);

CREATE TABLE IF NOT EXISTS archive_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  source_name TEXT,
  source_url TEXT,
  manifest_sha256 TEXT NOT NULL,
  file_policy_version TEXT NOT NULL,
  packer_version TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('browser_folder', 'browser_zip', 'preindexed_manifest')
  ),
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
  web_play_file_count INTEGER NOT NULL DEFAULT 0,
  web_play_size_bytes INTEGER NOT NULL DEFAULT 0,
  is_current INTEGER NOT NULL DEFAULT 0,
  uploader_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL CHECK (
    status IN ('processing', 'published', 'hidden', 'deleted')
  ) DEFAULT 'processing',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  deleted_at TEXT,
  purged_at TEXT,
  UNIQUE (work_id, manifest_sha256)
);

CREATE INDEX IF NOT EXISTS idx_archive_versions_work
  ON archive_versions(work_id, status, is_current, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_versions_one_current
  ON archive_versions(work_id)
  WHERE is_current = 1 AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_archive_versions_deleted_purge
  ON archive_versions(status, deleted_at, purged_at);

CREATE TRIGGER IF NOT EXISTS archive_versions_current_insert_guard
BEFORE INSERT ON archive_versions
WHEN NEW.is_current = 1 AND (NEW.status <> 'published' OR NEW.purged_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'only published archive versions can be current');
END;

CREATE TRIGGER IF NOT EXISTS archive_versions_current_update_guard
BEFORE UPDATE OF is_current, status, purged_at ON archive_versions
WHEN NEW.is_current = 1 AND (NEW.status <> 'published' OR NEW.purged_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'only published archive versions can be current');
END;

CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL,
  content_type_hint TEXT,
  observed_ext TEXT,
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
  format TEXT NOT NULL DEFAULT 'zip',
  compression TEXT NOT NULL DEFAULT 'deflate-low',
  storage_class TEXT NOT NULL DEFAULT 'standard',
  first_seen_archive_version_id INTEGER REFERENCES archive_versions(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS custom_emojis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shortcode TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '站点',
  visible_in_picker INTEGER NOT NULL DEFAULT 1 CHECK (visible_in_picker IN (0, 1)),
  image_blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (length(shortcode) BETWEEN 1 AND 64),
  CHECK (shortcode NOT GLOB '*[^A-Za-z0-9_+-]*')
);

CREATE INDEX IF NOT EXISTS idx_custom_emojis_picker
  ON custom_emojis(category, shortcode)
  WHERE status = 'active' AND visible_in_picker = 1;

CREATE INDEX IF NOT EXISTS idx_custom_emojis_blob
  ON custom_emojis(image_blob_sha256, status);

CREATE TABLE IF NOT EXISTS archive_version_blob_refs (
  archive_version_id INTEGER NOT NULL REFERENCES archive_versions(id) ON DELETE CASCADE,
  blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  PRIMARY KEY (archive_version_id, blob_sha256)
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS archive_version_blob_refs_require_active_blob
BEFORE INSERT ON archive_version_blob_refs
WHEN COALESCE((SELECT status FROM blobs WHERE sha256 = NEW.blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'archive version blob must be active');
END;

CREATE TRIGGER IF NOT EXISTS archive_version_blob_refs_update_require_active_blob
BEFORE UPDATE OF blob_sha256 ON archive_version_blob_refs
WHEN COALESCE((SELECT status FROM blobs WHERE sha256 = NEW.blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'archive version blob must be active');
END;

CREATE INDEX IF NOT EXISTS idx_archive_version_blob_refs_blob
  ON archive_version_blob_refs(blob_sha256);

CREATE TABLE IF NOT EXISTS archive_version_core_pack_refs (
  archive_version_id INTEGER NOT NULL REFERENCES archive_versions(id) ON DELETE CASCADE,
  core_pack_id INTEGER NOT NULL REFERENCES core_packs(id),
  PRIMARY KEY (archive_version_id, core_pack_id)
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS archive_version_core_pack_refs_require_active_pack
BEFORE INSERT ON archive_version_core_pack_refs
WHEN COALESCE((SELECT status FROM core_packs WHERE id = NEW.core_pack_id), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'archive version core pack must be active');
END;

CREATE TRIGGER IF NOT EXISTS archive_version_core_pack_refs_update_require_active_pack
BEFORE UPDATE OF core_pack_id ON archive_version_core_pack_refs
WHEN COALESCE((SELECT status FROM core_packs WHERE id = NEW.core_pack_id), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'archive version core pack must be active');
END;

CREATE INDEX IF NOT EXISTS idx_archive_version_core_pack_refs_core_pack
  ON archive_version_core_pack_refs(core_pack_id);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
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
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
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
    role_key IN ('author', 'scenario', 'graphics', 'music', 'translator', 'editor', 'publisher', 'proofreader', 'image_editor', 'other')
  ),
  role_label TEXT,
  notes TEXT,
  PRIMARY KEY (work_id, creator_id, role_key)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
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

CREATE TRIGGER IF NOT EXISTS media_assets_require_active_blob
BEFORE INSERT ON media_assets
WHEN COALESCE((SELECT status FROM blobs WHERE sha256 = NEW.blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'media asset blob must be active');
END;

CREATE TRIGGER IF NOT EXISTS media_assets_update_require_active_blob
BEFORE UPDATE OF blob_sha256 ON media_assets
WHEN COALESCE((SELECT status FROM blobs WHERE sha256 = NEW.blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'media asset blob must be active');
END;

CREATE TABLE IF NOT EXISTS work_media_assets (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  media_asset_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  sort_order INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, media_asset_id)
);

CREATE TRIGGER IF NOT EXISTS blobs_purge_requires_unreferenced
BEFORE UPDATE OF status ON blobs
WHEN NEW.status IN ('purging', 'purged')
  AND EXISTS (
    SELECT 1 FROM archive_version_blob_refs
    WHERE blob_sha256 = OLD.sha256
  )
  OR NEW.status IN ('purging', 'purged')
  AND EXISTS (
    SELECT 1 FROM media_assets
    WHERE blob_sha256 = OLD.sha256
  )
  OR NEW.status IN ('purging', 'purged')
  AND EXISTS (
    SELECT 1 FROM custom_emojis
    WHERE image_blob_sha256 = OLD.sha256
  )
BEGIN
  SELECT RAISE(ABORT, 'referenced blob cannot be purged');
END;

CREATE TRIGGER IF NOT EXISTS core_packs_purge_requires_unreferenced
BEFORE UPDATE OF status ON core_packs
WHEN NEW.status IN ('purging', 'purged')
  AND EXISTS (
    SELECT 1 FROM archive_version_core_pack_refs
    WHERE core_pack_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'referenced core pack cannot be purged');
END;

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

CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
  archive_version_id INTEGER REFERENCES archive_versions(id) ON DELETE SET NULL,
  uploader_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'created' CHECK (
    status IN ('created', 'preflighted', 'uploading', 'completed', 'failed', 'canceled')
  ),
  source_name TEXT,
  source_size_bytes INTEGER,
  file_count INTEGER NOT NULL DEFAULT 0,
  excluded_file_count INTEGER NOT NULL DEFAULT 0,
  excluded_size_bytes INTEGER NOT NULL DEFAULT 0,
  file_policy_version TEXT,
  missing_blob_count INTEGER NOT NULL DEFAULT 0,
  missing_core_pack_count INTEGER NOT NULL DEFAULT 0,
  missing_blob_size_bytes INTEGER NOT NULL DEFAULT 0,
  missing_core_pack_size_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_blob_count INTEGER NOT NULL DEFAULT 0,
  uploaded_blob_size_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_core_pack_count INTEGER NOT NULL DEFAULT 0,
  uploaded_core_pack_size_bytes INTEGER NOT NULL DEFAULT 0,
  manifest_put_count INTEGER NOT NULL DEFAULT 0,
  manifest_size_bytes INTEGER NOT NULL DEFAULT 0,
  r2_put_count INTEGER NOT NULL DEFAULT 0,
  preflight_duration_ms INTEGER,
  upload_duration_ms INTEGER NOT NULL DEFAULT 0,
  commit_duration_ms INTEGER,
  failed_stage TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_work
  ON import_jobs(work_id, created_at);

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
  cache_hit_count INTEGER NOT NULL DEFAULT 0,
  cache_miss_count INTEGER NOT NULL DEFAULT 0,
  cache_bypass_count INTEGER NOT NULL DEFAULT 0,
  total_r2_get_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_cache_status TEXT,
  last_duration_ms INTEGER,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT,
  last_cache_put_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_download_builds_archive_version
  ON download_builds(archive_version_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_download_builds_cache_key
  ON download_builds(cache_key);
