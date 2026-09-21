-- Pre-launch baseline: initialize an empty database directly with the current model.
-- Built-in roles and permissions are included; development content lives in data/local-seed/.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_auth_id TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT,
  password_updated_at TEXT,
  display_name TEXT NOT NULL,
  avatar_blob_sha256 TEXT REFERENCES blobs(sha256),
  bio TEXT NOT NULL DEFAULT '',
  showcase_revision INTEGER NOT NULL DEFAULT 0 CHECK (showcase_revision >= 0),
  profile_show_bio INTEGER NOT NULL DEFAULT 1 CHECK (profile_show_bio IN (0, 1)),
  profile_show_showcase INTEGER NOT NULL DEFAULT 1 CHECK (profile_show_showcase IN (0, 1)),
  profile_show_favorites INTEGER NOT NULL DEFAULT 1 CHECK (profile_show_favorites IN (0, 1)),
  profile_show_history INTEGER NOT NULL DEFAULT 1 CHECK (profile_show_history IN (0, 1)),
  profile_show_catalogs INTEGER NOT NULL DEFAULT 1 CHECK (profile_show_catalogs IN (0, 1)),
  profile_show_comments INTEGER NOT NULL DEFAULT 1 CHECK (profile_show_comments IN (0, 1)),
  profile_show_discussions INTEGER NOT NULL DEFAULT 0 CHECK (profile_show_discussions IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'deleted')) DEFAULT 'active',
  email_verified_at TEXT,
  last_login_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
SELECT roles.id, value FROM roles, json_each('["work.lookup_non_deleted","relation.create","translation_relation.create","catalog.create","catalog.update_own","catalog.delete_own","catalog.reorder_own"]')
WHERE roles.key = 'user';

INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT roles.id, value FROM roles, json_each('["work.lookup_non_deleted","work.update_own","work.external_create","import_job.create","import_job.cancel_own","import_job.preflight_own","import_job.commit_own","storage_object.upload","archive_version.delete_own","relation.create","translation_relation.create","catalog.create","catalog.update_own","catalog.delete_own","catalog.reorder_own"]')
WHERE roles.key = 'uploader';

INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT roles.id, value FROM roles, json_each('["work.lookup_non_deleted","work.update_own","work.external_create","import_job.create","import_job.cancel_own","import_job.preflight_own","import_job.commit_own","storage_object.upload","archive_version.delete_own","relation.create","translation_relation.create","catalog.create","catalog.update_own","catalog.delete_own","catalog.reorder_own","work.read_private","work.metadata.update_any","work.status.update_any","work.maintainer.manage_any","work.merge_any","relation.create_any","relation.update_any","relation.delete_any","translation_relation.create_any","translation_relation.delete_any","catalog.manage_any","comment.manage_any","emoji.defaults.manage","creator.read_private","creator.metadata.update_any","creator.merge_any","character.metadata.update_any","tag.read_private","tag.metadata.update_any","archive_version.read_private","archive_version.update","archive_version.delete_any","archive_version.restore","archive_version.set_current","user.read","user.status.update","user.role.assign","inbox.role_request.resolve","system.dashboard.read","system.maintenance.run","forum.content.moderate_any","forum.topic.feature_any","forum.tag.manage","character.admin.read","character.create","character.merge_any","character.portrait.manage_any","character.portrait.upload","character_category.create","character_category.update","character_category.delete","character_membership.create","character_membership.update","character_membership.delete","character_index.reorder","character.sources.update_any"]')
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
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'password_reset', 'email_change')),
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

CREATE INDEX IF NOT EXISTS idx_email_verification_challenges_user
  ON email_verification_challenges(user_id, purpose, created_at);

CREATE INDEX IF NOT EXISTS idx_email_verification_challenges_expires
  ON email_verification_challenges(expires_at);

CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
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

CREATE TABLE inbox_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('role_change_request','role_change_notice','system_notice','forum_reply','forum_like')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending','approved','rejected','archived')),
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
  event_key TEXT UNIQUE,
  forum_topic_id INTEGER REFERENCES forum_topics(id),
  forum_post_id INTEGER,
  forum_comment_id INTEGER,
  FOREIGN KEY(forum_post_id,forum_topic_id) REFERENCES forum_posts(id,topic_id),
  FOREIGN KEY(forum_comment_id,forum_post_id) REFERENCES forum_post_comments(id,post_id),
  CHECK(recipient_user_id IS NOT NULL OR required_permission_key IS NOT NULL),
  CHECK(type NOT IN ('forum_reply','forum_like') OR
    (recipient_user_id IS NOT NULL AND required_permission_key IS NULL AND event_key IS NOT NULL
      AND forum_topic_id IS NOT NULL AND forum_post_id IS NOT NULL AND status='open')),
  CHECK(type <> 'forum_like' OR forum_comment_id IS NULL)
);

CREATE INDEX idx_inbox_items_recipient ON inbox_items(recipient_user_id,created_at DESC,id DESC);
CREATE INDEX idx_inbox_items_permission ON inbox_items(required_permission_key,status,created_at DESC,id DESC);
CREATE INDEX idx_inbox_items_target ON inbox_items(target_user_id,type,status);
CREATE UNIQUE INDEX idx_inbox_pending_role_request ON inbox_items(target_user_id,requested_role_id)
  WHERE type='role_change_request' AND status='pending' AND target_user_id IS NOT NULL AND requested_role_id IS NOT NULL;

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
  is_translation INTEGER NOT NULL DEFAULT 0 CHECK (is_translation IN (0, 1)),
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
      'other'
    )
  ) DEFAULT 'other',
  status TEXT NOT NULL CHECK (
    status IN ('processing', 'published', 'hidden', 'deleted')
  ) DEFAULT 'processing',
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  CHECK (NOT (is_original = 1 AND is_translation = 1))
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
  favorited_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (work_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_work_entries_played
  ON user_work_entries(user_id, last_played_at DESC, work_id)
  WHERE last_played_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_work_entries_favorites
  ON user_work_entries(user_id, favorited_at DESC, work_id)
  WHERE favorited_at IS NOT NULL;

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER REFERENCES works(id) ON DELETE CASCADE,
  creator_id INTEGER REFERENCES creators(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned_at TEXT CHECK (pinned_at IS NULL OR (work_id IS NOT NULL AND root_comment_id IS NULL)),
  root_comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  reply_to_comment_id INTEGER REFERENCES comments(id) ON DELETE SET NULL,
  body TEXT,
  request_key TEXT,
  request_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('published', 'hidden', 'deleted')) DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT,
  CHECK (
    (status = 'deleted' AND body IS NULL)
    OR (status <> 'deleted' AND body IS NOT NULL AND length(trim(body)) > 0)
  ),
  CHECK ((work_id IS NOT NULL) + (creator_id IS NOT NULL) + (character_id IS NOT NULL) = 1),
  CHECK (root_comment_id IS NULL OR root_comment_id <> id),
  CHECK (reply_to_comment_id IS NULL OR reply_to_comment_id <> id),
  UNIQUE(user_id,request_key)
);

CREATE TABLE comment_images (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('uploading','ready','uncertain','cleanup','cleaned')),
  object_key TEXT NOT NULL UNIQUE CHECK(object_key = 'comment-images/' || id),
  format TEXT NOT NULL CHECK(format IN ('png','jpeg','webp','gif')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),
  width INTEGER NOT NULL CHECK(typeof(width)='integer' AND width>0),
  height INTEGER NOT NULL CHECK(typeof(height)='integer' AND height>0),
  comment_id INTEGER REFERENCES comments(id) ON DELETE SET NULL,
  position INTEGER CHECK(position IS NULL OR (typeof(position)='integer' AND position BETWEEN 0 AND 9)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,client_id),
  CHECK(comment_id IS NULL OR position IS NOT NULL)
);
CREATE INDEX comment_images_comment ON comment_images(comment_id,position);
CREATE INDEX comment_images_uploads ON comment_images(user_id,updated_at);
CREATE INDEX comment_images_cleanup ON comment_images(status,updated_at);

CREATE INDEX IF NOT EXISTS idx_comments_work_public_roots
  ON comments(work_id, created_at, id)
  WHERE work_id IS NOT NULL AND root_comment_id IS NULL AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_comments_creator_public_roots
  ON comments(creator_id, created_at, id)
  WHERE creator_id IS NOT NULL AND root_comment_id IS NULL AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_comments_replies
  ON comments(root_comment_id, created_at, id)
  WHERE root_comment_id IS NOT NULL AND status = 'published';

CREATE INDEX IF NOT EXISTS idx_comments_author
  ON comments(user_id, updated_at DESC, id);

CREATE INDEX idx_comments_character_public_roots ON comments(character_id,created_at,id)
  WHERE character_id IS NOT NULL AND root_comment_id IS NULL AND status='published';

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TRIGGER IF NOT EXISTS comments_require_matching_root_insert
BEFORE INSERT ON comments
WHEN NEW.root_comment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM comments root
    WHERE root.id = NEW.root_comment_id
      AND root.root_comment_id IS NULL
      AND root.work_id IS NEW.work_id
      AND root.creator_id IS NEW.creator_id
      AND root.character_id IS NEW.character_id
  )
BEGIN
  SELECT RAISE(ABORT, 'comment root must use the same target');
END;

CREATE TRIGGER IF NOT EXISTS comments_require_matching_reply_insert
BEFORE INSERT ON comments
WHEN NEW.reply_to_comment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM comments target
    WHERE target.id = NEW.reply_to_comment_id
      AND target.work_id IS NEW.work_id
      AND target.creator_id IS NEW.creator_id
      AND target.character_id IS NEW.character_id
      AND COALESCE(target.root_comment_id, target.id) = NEW.root_comment_id
  )
BEGIN
  SELECT RAISE(ABORT, 'comment reply must use the same root and target');
END;

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
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_work_id, target_work_id, vice_versa),
  CHECK (source_work_id <> target_work_id)
);

CREATE INDEX IF NOT EXISTS idx_translation_relations_source
  ON translation_relations(source_work_id, target_role);

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
  cover_blob_sha256 TEXT REFERENCES blobs(sha256),
  status TEXT NOT NULL CHECK (status IN ('published', 'deleted')) DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_catalogs_owner_status
  ON catalogs(owner_user_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_catalogs_cover_blob
  ON catalogs(cover_blob_sha256)
  WHERE cover_blob_sha256 IS NOT NULL AND status = 'published';

CREATE TABLE IF NOT EXISTS catalog_items (
  catalog_id INTEGER NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(sort_order) = 'integer' AND sort_order BETWEEN 0 AND 9007199254740991),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (catalog_id, work_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_order
  ON catalog_items(catalog_id, sort_order ASC, work_id DESC);

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

CREATE TRIGGER IF NOT EXISTS users_avatar_require_active_blob
BEFORE UPDATE OF avatar_blob_sha256 ON users
WHEN NEW.avatar_blob_sha256 IS NOT NULL
  AND COALESCE((SELECT status FROM blobs WHERE sha256=NEW.avatar_blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'user avatar blob must be active');
END;

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
  primary_name TEXT NOT NULL COLLATE NOCASE,
  primary_name_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  original_name_key TEXT NOT NULL UNIQUE,
  description TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_characters_primary_name_key
  ON characters(primary_name_key);

CREATE TABLE IF NOT EXISTS character_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('ja', 'zh')),
  source TEXT NOT NULL CHECK (source IN ('base', 'sub', 'user', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (character_id, name_key)
);

CREATE INDEX IF NOT EXISTS idx_character_aliases_name_key
  ON character_aliases(name_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_character_aliases_unique_japanese_name_key
  ON character_aliases(name_key)
  WHERE language = 'ja';

CREATE TRIGGER IF NOT EXISTS trg_characters_original_name_not_alias_insert
BEFORE INSERT ON characters
WHEN EXISTS (
  SELECT 1 FROM character_aliases
  WHERE language = 'ja' AND name_key = NEW.original_name_key
)
BEGIN
  SELECT RAISE(ABORT, 'character original name already belongs to an alias');
END;

CREATE TRIGGER IF NOT EXISTS trg_characters_original_name_not_alias_update
BEFORE UPDATE OF original_name_key ON characters
WHEN EXISTS (
  SELECT 1 FROM character_aliases
  WHERE language = 'ja' AND name_key = NEW.original_name_key
)
BEGIN
  SELECT RAISE(ABORT, 'character original name already belongs to an alias');
END;

CREATE TRIGGER IF NOT EXISTS trg_character_aliases_japanese_name_not_original_insert
BEFORE INSERT ON character_aliases
WHEN NEW.language = 'ja' AND EXISTS (
  SELECT 1 FROM characters WHERE original_name_key = NEW.name_key
)
BEGIN
  SELECT RAISE(ABORT, 'character alias already belongs to an original name');
END;

CREATE TRIGGER IF NOT EXISTS trg_character_aliases_japanese_name_not_original_update
BEFORE UPDATE OF name_key, language ON character_aliases
WHEN NEW.language = 'ja' AND EXISTS (
  SELECT 1 FROM characters WHERE original_name_key = NEW.name_key
)
BEGIN
  SELECT RAISE(ABORT, 'character alias already belongs to an original name');
END;

CREATE TABLE character_categories (
  id TEXT PRIMARY KEY NOT NULL,
  parent_id TEXT REFERENCES character_categories(id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 160),
  original_name TEXT,
  source_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK (parent_id IS NOT id)
);
CREATE INDEX idx_character_categories_parent_order ON character_categories(parent_id,sort_order,id);

CREATE TABLE character_category_memberships (
  category_id TEXT NOT NULL REFERENCES character_categories(id) ON DELETE RESTRICT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  display_name TEXT CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 160),
  original_name TEXT CHECK (original_name IS NULL OR length(trim(original_name)) BETWEEN 1 AND 160),
  PRIMARY KEY (category_id,character_id)
);
CREATE INDEX idx_character_memberships_character ON character_category_memberships(character_id);
CREATE INDEX idx_character_memberships_order ON character_category_memberships(category_id,sort_order,character_id);

CREATE TABLE character_sources (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id,url)
);

CREATE TABLE character_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  kind TEXT NOT NULL CHECK (kind IN ('charset','monster','other')),
  width_px INTEGER NOT NULL CHECK (width_px > 0),
  height_px INTEGER NOT NULL CHECK (height_px > 0),
  UNIQUE (blob_sha256,kind)
);

CREATE TABLE character_material_bindings (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES character_materials(id) ON DELETE CASCADE,
  sort_order INTEGER CHECK (sort_order >= 0),
  PRIMARY KEY (character_id,material_id)
);
CREATE INDEX idx_character_material_bindings_material ON character_material_bindings(material_id);

CREATE TRIGGER character_materials_require_active_blob_insert
BEFORE INSERT ON character_materials
WHEN NOT EXISTS (SELECT 1 FROM blobs WHERE sha256=NEW.blob_sha256 AND status='active')
BEGIN
  SELECT RAISE(ABORT, 'character material blob must be active');
END;

CREATE TRIGGER character_materials_require_active_blob_update
BEFORE UPDATE OF blob_sha256 ON character_materials
WHEN NOT EXISTS (SELECT 1 FROM blobs WHERE sha256=NEW.blob_sha256 AND status='active')
BEGIN
  SELECT RAISE(ABORT, 'character material blob must be active');
END;

CREATE TABLE IF NOT EXISTS face_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blob_sha256 TEXT NOT NULL UNIQUE REFERENCES blobs(sha256),
  width_px INTEGER NOT NULL CHECK (width_px BETWEEN 48 AND 192 AND width_px % 48 = 0),
  height_px INTEGER NOT NULL CHECK (height_px BETWEEN 48 AND 192 AND height_px % 48 = 0),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('atwiki', 'user_upload', 'admin_upload')
  ),
  source_page_url TEXT,
  source_image_url TEXT,
  source_page_title TEXT,
  source_section_title TEXT,
  source_order INTEGER CHECK (
    source_order IS NULL OR (
      typeof(source_order) = 'integer' AND source_order BETWEEN 0 AND 9007199254740991
    )
  ),
  library_status TEXT NOT NULL CHECK (
    library_status IN ('pending', 'approved', 'rejected')
  ) DEFAULT 'pending',
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_face_sheets_library
  ON face_sheets(library_status, source_order, id);

CREATE TRIGGER IF NOT EXISTS face_sheets_require_active_blob_insert
BEFORE INSERT ON face_sheets
WHEN COALESCE((SELECT status FROM blobs WHERE sha256=NEW.blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'face sheet blob must be active');
END;

CREATE TRIGGER IF NOT EXISTS face_sheets_require_active_blob_update
BEFORE UPDATE OF blob_sha256 ON face_sheets
WHEN COALESCE((SELECT status FROM blobs WHERE sha256=NEW.blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'face sheet blob must be active');
END;

CREATE TABLE IF NOT EXISTS character_face_sheet_bindings (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  face_sheet_id INTEGER NOT NULL REFERENCES face_sheets(id) ON DELETE CASCADE,
  sort_order INTEGER,
  PRIMARY KEY (character_id, face_sheet_id)
);

CREATE INDEX IF NOT EXISTS idx_character_face_sheet_bindings_sheet
  ON character_face_sheet_bindings(face_sheet_id, character_id);

CREATE TABLE IF NOT EXISTS character_portrait_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  face_sheet_id INTEGER NOT NULL,
  cell_row INTEGER NOT NULL CHECK (cell_row >= 0),
  cell_column INTEGER NOT NULL CHECK (cell_column >= 0),
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (character_id, face_sheet_id, cell_row, cell_column),
  FOREIGN KEY (character_id, face_sheet_id)
    REFERENCES character_face_sheet_bindings(character_id, face_sheet_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_character_portrait_refs_sheet
  ON character_portrait_refs(face_sheet_id, cell_row, cell_column);

CREATE TRIGGER IF NOT EXISTS character_portrait_refs_require_valid_cell_insert
BEFORE INSERT ON character_portrait_refs
WHEN NOT EXISTS (
  SELECT 1 FROM face_sheets fs
  WHERE fs.id=NEW.face_sheet_id
    AND NEW.cell_row * 48 < fs.height_px
    AND NEW.cell_column * 48 < fs.width_px
)
BEGIN
  SELECT RAISE(ABORT, 'character portrait cell is outside the face sheet');
END;

CREATE TRIGGER IF NOT EXISTS character_portrait_refs_require_valid_cell_update
BEFORE UPDATE OF face_sheet_id, cell_row, cell_column ON character_portrait_refs
WHEN NOT EXISTS (
  SELECT 1 FROM face_sheets fs
  WHERE fs.id=NEW.face_sheet_id
    AND NEW.cell_row * 48 < fs.height_px
    AND NEW.cell_column * 48 < fs.width_px
)
BEGIN
  SELECT RAISE(ABORT, 'character portrait cell is outside the face sheet');
END;

CREATE TABLE IF NOT EXISTS character_default_portraits (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  portrait_ref_id INTEGER NOT NULL UNIQUE REFERENCES character_portrait_refs(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS character_default_portraits_require_matching_character_insert
BEFORE INSERT ON character_default_portraits
WHEN COALESCE((SELECT character_id FROM character_portrait_refs WHERE id=NEW.portrait_ref_id), 0)
  <> NEW.character_id
BEGIN
  SELECT RAISE(ABORT, 'default portrait must belong to the character');
END;

CREATE TRIGGER IF NOT EXISTS character_default_portraits_require_matching_character_update
BEFORE UPDATE OF character_id, portrait_ref_id ON character_default_portraits
WHEN COALESCE((SELECT character_id FROM character_portrait_refs WHERE id=NEW.portrait_ref_id), 0)
  <> NEW.character_id
BEGIN
  SELECT RAISE(ABORT, 'default portrait must belong to the character');
END;

CREATE TABLE IF NOT EXISTS work_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  portrait_ref_id INTEGER REFERENCES character_portrait_refs(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  role_key TEXT NOT NULL CHECK (
    role_key IN ('main', 'supporting', 'cameo', 'mentioned', 'other')
  ) DEFAULT 'supporting',
  spoiler_level INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_work_characters_work
  ON work_characters(work_id, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_work_characters_character
  ON work_characters(character_id, work_id);

CREATE TRIGGER IF NOT EXISTS work_characters_require_matching_portrait_insert
BEFORE INSERT ON work_characters
WHEN NEW.portrait_ref_id IS NOT NULL
  AND COALESCE((SELECT character_id FROM character_portrait_refs WHERE id=NEW.portrait_ref_id), 0)
    <> NEW.character_id
BEGIN
  SELECT RAISE(ABORT, 'work portrait must belong to the character');
END;

CREATE TRIGGER IF NOT EXISTS work_characters_require_matching_portrait_update
BEFORE UPDATE OF character_id, portrait_ref_id ON work_characters
WHEN NEW.portrait_ref_id IS NOT NULL
  AND COALESCE((SELECT character_id FROM character_portrait_refs WHERE id=NEW.portrait_ref_id), 0)
    <> NEW.character_id
BEGIN
  SELECT RAISE(ABORT, 'work portrait must belong to the character');
END;

CREATE TABLE IF NOT EXISTS creators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  name_key TEXT NOT NULL UNIQUE,
  avatar_blob_sha256 TEXT REFERENCES blobs(sha256),
  website_url TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creator_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('user', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_creator_aliases_creator
  ON creator_aliases(creator_id, id);

CREATE TRIGGER IF NOT EXISTS creators_avatar_require_active_blob
BEFORE UPDATE OF avatar_blob_sha256 ON creators
WHEN NEW.avatar_blob_sha256 IS NOT NULL
  AND COALESCE((SELECT status FROM blobs WHERE sha256=NEW.avatar_blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'creator avatar blob must be active');
END;

CREATE TRIGGER IF NOT EXISTS creators_avatar_require_active_blob_insert
BEFORE INSERT ON creators
WHEN NEW.avatar_blob_sha256 IS NOT NULL
  AND COALESCE((SELECT status FROM blobs WHERE sha256=NEW.avatar_blob_sha256), '') <> 'active'
BEGIN
  SELECT RAISE(ABORT, 'creator avatar blob must be active');
END;

CREATE TABLE IF NOT EXISTS work_staff (
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  creator_id INTEGER NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role_key TEXT NOT NULL CHECK (
    role_key IN ('author', 'scenario', 'graphics', 'music', 'planning', 'programming', 'translator', 'other')
  ),
  role_label TEXT,
  notes TEXT,
  PRIMARY KEY (work_id, creator_id, role_key)
);

CREATE TABLE user_showcase_entries (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('work', 'character', 'creator')),
  work_id INTEGER REFERENCES works(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  creator_id INTEGER REFERENCES creators(id) ON DELETE CASCADE,
  portrait_ref_id INTEGER REFERENCES character_portrait_refs(id) ON DELETE SET NULL CHECK (kind='character' OR portrait_ref_id IS NULL),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 2),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  PRIMARY KEY (user_id, kind),
  UNIQUE (user_id, sort_order),
  CHECK (
    (kind='work' AND work_id IS NOT NULL AND character_id IS NULL AND creator_id IS NULL)
    OR (kind='character' AND character_id IS NOT NULL AND work_id IS NULL AND creator_id IS NULL)
    OR (kind='creator' AND creator_id IS NOT NULL AND work_id IS NULL AND character_id IS NULL)
  )
);

CREATE INDEX idx_user_showcase_work ON user_showcase_entries(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX idx_user_showcase_character ON user_showcase_entries(character_id) WHERE character_id IS NOT NULL;
CREATE INDEX idx_user_showcase_creator ON user_showcase_entries(creator_id) WHERE creator_id IS NOT NULL;

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
  title TEXT,
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (blob_sha256)
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
  role TEXT NOT NULL CHECK (role IN ('cover', 'preview')),
  PRIMARY KEY (work_id, media_asset_id)
);

CREATE UNIQUE INDEX work_media_one_cover ON work_media_assets(work_id) WHERE role='cover';

CREATE TRIGGER blobs_purge_requires_unreferenced
BEFORE UPDATE OF status ON blobs
WHEN NEW.status IN ('purging','purged') AND (
  EXISTS (SELECT 1 FROM archive_version_blob_refs WHERE blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM media_assets WHERE blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM face_emoji_refs WHERE blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM users WHERE avatar_blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM creators WHERE avatar_blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM resources WHERE icon_blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM face_sheets WHERE blob_sha256=OLD.sha256)
  OR EXISTS (SELECT 1 FROM character_materials WHERE blob_sha256=OLD.sha256)
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
    link_type IN ('official', 'wiki', 'video', 'download_page', 'other')
  ) DEFAULT 'other',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER REFERENCES works(id) ON DELETE SET NULL,
  archive_version_id INTEGER REFERENCES archive_versions(id) ON DELETE SET NULL,
  uploader_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'created' CHECK (
    status IN (
      'created', 'preflighted', 'uploading_source', 'awaiting_metadata',
      'uploading_metadata', 'committing', 'completed', 'failed', 'canceled', 'expired'
    )
  ),
  source_name TEXT,
  source_size_bytes INTEGER,
  file_count INTEGER NOT NULL DEFAULT 0,
  excluded_file_count INTEGER NOT NULL DEFAULT 0,
  excluded_size_bytes INTEGER NOT NULL DEFAULT 0,
  file_policy_version TEXT,
  source_manifest_sha256 TEXT,
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

CREATE INDEX IF NOT EXISTS idx_import_jobs_uploader
  ON import_jobs(uploader_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_import_jobs_one_active_work
  ON import_jobs(work_id)
  WHERE work_id IS NOT NULL
    AND status IN (
      'created', 'preflighted', 'uploading_source', 'awaiting_metadata',
      'uploading_metadata', 'committing'
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
  last_accessed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_download_builds_archive_version
  ON download_builds(archive_version_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_download_builds_cache_key
  ON download_builds(cache_key);

CREATE TABLE forum_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK(status='deleted' OR length(title) BETWEEN 1 AND 160),
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','deleted')),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  pinned_at TEXT,
  featured_at TEXT,
  featured_by INTEGER REFERENCES users(id),
  view_count INTEGER NOT NULL DEFAULT 0 CHECK(view_count >= 0),
  next_post_number INTEGER NOT NULL DEFAULT 2 CHECK(next_post_number >= 2),
  revision TEXT NOT NULL,
  write_token TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reply_count INTEGER NOT NULL DEFAULT 0 CHECK(reply_count >= 0),
  last_activity_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
  last_post_id INTEGER REFERENCES forum_posts(id),
  last_comment_id INTEGER REFERENCES forum_post_comments(id),
  UNIQUE(user_id,request_key)
);
CREATE TABLE forum_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES forum_topics(id),
  post_number INTEGER NOT NULL CHECK(post_number > 0),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','deleted')),
  revision TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  next_comment_number INTEGER NOT NULL DEFAULT 1 CHECK(next_comment_number > 0),
  UNIQUE(topic_id,post_number),
  UNIQUE(user_id,request_key),
  UNIQUE(id,topic_id)
);
CREATE TABLE forum_post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES forum_posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  reply_to_id INTEGER,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','deleted')),
  revision TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  comment_number INTEGER NOT NULL DEFAULT 1 CHECK(comment_number > 0),
  UNIQUE(id,post_id),
  UNIQUE(user_id,request_key),
  FOREIGN KEY(reply_to_id,post_id) REFERENCES forum_post_comments(id,post_id)
);
CREATE TABLE forum_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','hidden')),
  revision TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE forum_topic_tags (
  topic_id INTEGER NOT NULL REFERENCES forum_topics(id),
  tag_id INTEGER NOT NULL REFERENCES forum_tags(id),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 4),
  PRIMARY KEY(topic_id,tag_id),
  UNIQUE(topic_id,position)
);
CREATE TABLE forum_post_likes (
  post_id INTEGER NOT NULL REFERENCES forum_posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY(post_id,user_id)
);
CREATE TABLE forum_content_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  topic_id INTEGER NOT NULL REFERENCES forum_topics(id),
  post_id INTEGER REFERENCES forum_posts(id),
  comment_id INTEGER REFERENCES forum_post_comments(id),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('topic','post','comment')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
  note TEXT NOT NULL DEFAULT '',
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((target_kind='topic' AND target_id=topic_id AND post_id IS NULL AND comment_id IS NULL)
    OR (target_kind='post' AND post_id IS NOT NULL AND target_id=post_id AND comment_id IS NULL)
    OR (target_kind='comment' AND comment_id IS NOT NULL AND target_id=comment_id AND post_id IS NOT NULL)),
  FOREIGN KEY(post_id,topic_id) REFERENCES forum_posts(id,topic_id),
  FOREIGN KEY(comment_id,post_id) REFERENCES forum_post_comments(id,post_id)
);
CREATE UNIQUE INDEX forum_pending_report ON forum_content_reports(user_id,target_kind,target_id) WHERE status='pending';
CREATE INDEX forum_posts_author_time ON forum_posts(user_id,created_at);
CREATE INDEX forum_comments_author_time ON forum_post_comments(user_id,created_at);
CREATE INDEX forum_comments_order ON forum_post_comments(post_id,created_at,id);
CREATE INDEX forum_tags_topics ON forum_topic_tags(tag_id,topic_id);
CREATE INDEX forum_reports_queue ON forum_content_reports(status,created_at,id);
CREATE INDEX forum_reports_author_time ON forum_content_reports(user_id,created_at);

-- Public projections are views of current source rows, never stale search copies.
CREATE VIEW forum_public_topics AS
SELECT t.* FROM forum_topics t JOIN users u ON u.id=t.user_id
WHERE t.status='published' AND u.status IN ('active','deleted');
CREATE VIEW forum_public_posts AS
SELECT p.* FROM forum_posts p JOIN forum_public_topics t ON t.id=p.topic_id JOIN users u ON u.id=p.user_id
WHERE p.status='published' AND u.status IN ('active','deleted');
CREATE VIEW forum_public_comments AS
SELECT c.*,p.topic_id,p.post_number FROM forum_post_comments c
JOIN forum_posts p ON p.id=c.post_id JOIN forum_public_topics t ON t.id=p.topic_id
JOIN users u ON u.id=c.user_id JOIN users parent_user ON parent_user.id=p.user_id
WHERE c.status='published' AND u.status IN ('active','deleted')
  AND p.status IN ('published','deleted') AND parent_user.status IN ('active','deleted');

CREATE TABLE forum_images (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('uploading','ready','failed','uncertain','cleanup','cleaned')),
  object_key TEXT NOT NULL UNIQUE CHECK(object_key = 'forum-images/' || id),
  format TEXT NOT NULL CHECK(format IN ('png','jpeg','webp','gif')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 2097152),
  width INTEGER NOT NULL CHECK(typeof(width)='integer' AND width>0),
  height INTEGER NOT NULL CHECK(typeof(height)='integer' AND height>0),
  post_id INTEGER REFERENCES forum_posts(id),
  position INTEGER CHECK(typeof(position)='integer' AND position>=0 OR position IS NULL),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  body_offset INTEGER NOT NULL DEFAULT 0 CHECK(body_offset BETWEEN 0 AND 20000),
  UNIQUE(user_id,client_id),
  CHECK((post_id IS NULL) = (position IS NULL))
);
CREATE INDEX forum_images_post ON forum_images(post_id,position);
CREATE INDEX forum_images_uploads ON forum_images(user_id,created_at);

CREATE UNIQUE INDEX forum_comment_numbers ON forum_post_comments(post_id,comment_number);
CREATE INDEX forum_posts_writer_revision ON forum_posts(user_id,revision);
CREATE INDEX forum_comments_writer_revision ON forum_post_comments(user_id,revision);
CREATE INDEX forum_topics_activity ON forum_topics(last_activity_at DESC,id DESC);
CREATE INDEX forum_topics_featured ON forum_topics(featured_at DESC,id DESC) WHERE featured_at IS NOT NULL;

-- Document IDs are publication order, not source IDs. Keep them on deletion.
CREATE TABLE forum_search_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER UNIQUE REFERENCES forum_posts(id),
  comment_id INTEGER UNIQUE REFERENCES forum_post_comments(id),
  CHECK((post_id IS NOT NULL)+(comment_id IS NOT NULL)=1)
);

CREATE VIRTUAL TABLE forum_search_index USING fts5(title,body,scope);

CREATE INDEX idx_character_materials_kind_id ON character_materials(kind,id);

CREATE INDEX idx_face_sheets_library_order ON face_sheets(
  CASE library_status WHEN 'approved' THEN 0 ELSE 1 END,
  source_order IS NULL,source_order,id
) WHERE library_status!='rejected';

CREATE INDEX idx_comments_character_public ON comments(character_id)
  WHERE character_id IS NOT NULL AND status='published';

-- Resources: editorial links and independently published software.
CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('tool','website')),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  links_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(links_json) AND json_type(links_json)='array'),
  source_url TEXT NOT NULL DEFAULT '',
  icon_blob_sha256 TEXT REFERENCES blobs(sha256),
  visibility TEXT NOT NULL DEFAULT 'draft' CHECK(visibility IN ('draft','published','hidden')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  last_release_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_release_sequence>=0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  summary_json TEXT NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}' CHECK(json_valid(summary_json)),
  windows_button_label TEXT NOT NULL DEFAULT '下载 Windows 版' CHECK(length(trim(windows_button_label))>0),
  android_button_label TEXT NOT NULL DEFAULT '下载 Android 版' CHECK(length(trim(android_button_label))>0),
  CHECK(visibility<>'published' OR icon_blob_sha256 IS NOT NULL),
  CHECK(kind<>'website' OR visibility<>'published' OR json_array_length(links_json)>0)
);
CREATE INDEX idx_resources_public ON resources(visibility,sort_order,id);
CREATE TRIGGER resources_identity_immutable BEFORE UPDATE OF id,slug,kind ON resources
WHEN NEW.id<>OLD.id OR NEW.slug<>OLD.slug OR NEW.kind<>OLD.kind
BEGIN SELECT RAISE(ABORT,'resource identity is immutable'); END;
CREATE TRIGGER resources_icon_insert BEFORE INSERT ON resources
WHEN NEW.icon_blob_sha256 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM blobs WHERE sha256=NEW.icon_blob_sha256 AND status='active')
BEGIN SELECT RAISE(ABORT,'resource icon must be active'); END;
CREATE TRIGGER resources_icon_update BEFORE UPDATE OF icon_blob_sha256 ON resources
WHEN NEW.icon_blob_sha256 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM blobs WHERE sha256=NEW.icon_blob_sha256 AND status='active')
BEGIN SELECT RAISE(ABORT,'resource icon must be active'); END;

CREATE TABLE tool_releases (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  channel TEXT NOT NULL DEFAULT 'stable' CHECK(channel='stable'),
  version_label TEXT NOT NULL CHECK(length(version_label) BETWEEN 1 AND 100),
  release_sequence INTEGER CHECK(release_sequence>0),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=30000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','withdrawn')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resource_id,version_label),
  UNIQUE(resource_id,release_sequence),
  CHECK((status='draft' AND release_sequence IS NULL AND published_at IS NULL) OR
        (status<>'draft' AND release_sequence IS NOT NULL AND published_at IS NOT NULL))
);
CREATE TRIGGER tool_releases_tool_only BEFORE INSERT ON tool_releases
WHEN NOT EXISTS(SELECT 1 FROM resources WHERE id=NEW.resource_id AND kind='tool')
BEGIN SELECT RAISE(ABORT,'only tools have releases'); END;
CREATE TRIGGER tool_releases_identity_immutable BEFORE UPDATE ON tool_releases
WHEN NEW.id<>OLD.id OR NEW.resource_id<>OLD.resource_id OR NEW.channel<>OLD.channel OR
 (OLD.published_at IS NOT NULL AND (NEW.release_sequence IS NOT OLD.release_sequence OR NEW.published_at IS NOT OLD.published_at OR NEW.status='draft')) OR
 (OLD.status='withdrawn' AND NEW.status<>'withdrawn')
BEGIN SELECT RAISE(ABORT,'published release identity is immutable'); END;
CREATE TRIGGER tool_releases_keep_history BEFORE DELETE ON tool_releases
WHEN OLD.published_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'published release history must be retained'); END;

CREATE TABLE tool_artifacts (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES tool_releases(id),
  target TEXT NOT NULL CHECK(target IN ('windows-x64','android-universal')),
  format TEXT NOT NULL CHECK(format IN ('zip','exe','apk')),
  application_build_id TEXT CHECK(length(application_build_id) BETWEEN 1 AND 200),
  filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 180),
  object_key TEXT NOT NULL UNIQUE CHECK(object_key='tools/artifacts/' || id || '/' || sha256),
  size_bytes INTEGER NOT NULL CHECK(size_bytes>0 AND size_bytes<=95000000),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  storage_status TEXT NOT NULL DEFAULT 'pending' CHECK(storage_status IN ('pending','uploading','uncertain','ready','cleanup','cleaned')),
  upload_actor_id INTEGER NOT NULL REFERENCES users(id),
  upload_token TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((target='android-universal' AND format='apk') OR (target='windows-x64' AND format IN ('zip','exe')))
);
CREATE UNIQUE INDEX idx_tool_artifact_target ON tool_artifacts(release_id,target) WHERE storage_status<>'cleaned';
CREATE INDEX idx_tool_artifact_build ON tool_artifacts(application_build_id,target);
CREATE TRIGGER tool_artifacts_draft_insert BEFORE INSERT ON tool_artifacts
WHEN NOT EXISTS(SELECT 1 FROM tool_releases WHERE id=NEW.release_id AND status='draft')
BEGIN SELECT RAISE(ABORT,'only drafts accept artifacts'); END;
CREATE TRIGGER tool_artifacts_identity_immutable BEFORE UPDATE ON tool_artifacts
WHEN NEW.id<>OLD.id OR NEW.release_id<>OLD.release_id OR NEW.target<>OLD.target OR NEW.format<>OLD.format OR
 NEW.application_build_id IS NOT OLD.application_build_id OR NEW.filename<>OLD.filename OR NEW.object_key<>OLD.object_key OR NEW.size_bytes<>OLD.size_bytes OR NEW.sha256<>OLD.sha256 OR
 (EXISTS(SELECT 1 FROM tool_releases WHERE id=OLD.release_id AND published_at IS NOT NULL) AND NEW.storage_status<>OLD.storage_status) OR
 (OLD.storage_status IN ('cleanup','cleaned') AND NEW.storage_status NOT IN ('cleanup','cleaned'))
BEGIN SELECT RAISE(ABORT,'artifact identity is immutable'); END;
CREATE TRIGGER tool_artifacts_keep_history BEFORE DELETE ON tool_artifacts
BEGIN SELECT RAISE(ABORT,'artifact records must be retained'); END;
CREATE TRIGGER tool_releases_publish_ready BEFORE UPDATE OF status ON tool_releases
WHEN NEW.status='published' AND OLD.status='draft' AND (
 NOT EXISTS(SELECT 1 FROM tool_artifacts WHERE release_id=NEW.id AND storage_status='ready') OR
 EXISTS(SELECT 1 FROM tool_artifacts WHERE release_id=NEW.id AND storage_status NOT IN ('ready','cleaned')))
BEGIN SELECT RAISE(ABORT,'all release artifacts must be verified'); END;

CREATE TABLE tool_channels (
  resource_id TEXT NOT NULL REFERENCES resources(id),
  channel TEXT NOT NULL CHECK(channel='stable'),
  target TEXT NOT NULL CHECK(target IN ('windows-x64','android-universal')),
  artifact_id TEXT REFERENCES tool_artifacts(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(resource_id,channel,target)
);
CREATE TRIGGER tool_channels_insert_valid BEFORE INSERT ON tool_channels
WHEN NOT EXISTS(SELECT 1 FROM resources WHERE id=NEW.resource_id AND kind='tool') OR (NEW.artifact_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM tool_artifacts a JOIN tool_releases r ON r.id=a.release_id
 WHERE a.id=NEW.artifact_id AND r.resource_id=NEW.resource_id AND r.channel=NEW.channel AND a.target=NEW.target AND r.status='published' AND a.storage_status='ready'))
BEGIN SELECT RAISE(ABORT,'invalid recommended artifact'); END;
CREATE TRIGGER tool_channels_update_valid BEFORE UPDATE ON tool_channels
WHEN NEW.resource_id<>OLD.resource_id OR NEW.channel<>OLD.channel OR NEW.target<>OLD.target OR (NEW.artifact_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM tool_artifacts a JOIN tool_releases r ON r.id=a.release_id
 WHERE a.id=NEW.artifact_id AND r.resource_id=NEW.resource_id AND r.channel=NEW.channel AND a.target=NEW.target AND r.status='published' AND a.storage_status='ready'))
BEGIN SELECT RAISE(ABORT,'invalid recommended artifact'); END;
CREATE TRIGGER tool_releases_withdraw_unselected BEFORE UPDATE OF status ON tool_releases
WHEN NEW.status='withdrawn' AND EXISTS(SELECT 1 FROM tool_channels c JOIN tool_artifacts a ON a.id=c.artifact_id WHERE a.release_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'pause recommendations before withdrawing'); END;


-- A face emoji is an immutable cell, independent of character bindings.
CREATE TABLE face_emoji_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  cell_row INTEGER NOT NULL CHECK(cell_row BETWEEN 0 AND 3),
  cell_column INTEGER NOT NULL CHECK(cell_column BETWEEN 0 AND 3),
  width_px INTEGER NOT NULL CHECK(width_px BETWEEN 48 AND 192 AND width_px % 48 = 0),
  height_px INTEGER NOT NULL CHECK(height_px BETWEEN 48 AND 192 AND height_px % 48 = 0),
  UNIQUE(blob_sha256,cell_row,cell_column),
  CHECK(cell_row * 48 < height_px AND cell_column * 48 < width_px)
);
CREATE TRIGGER face_emoji_refs_immutable BEFORE UPDATE ON face_emoji_refs
BEGIN SELECT RAISE(ABORT,'face emoji reference is immutable'); END;
CREATE VIEW available_face_emojis AS
SELECT e.* FROM face_emoji_refs e JOIN blobs b ON b.sha256=e.blob_sha256
JOIN face_sheets fs ON fs.blob_sha256=e.blob_sha256
WHERE b.status='active' AND fs.library_status='approved'
  AND fs.width_px=e.width_px AND fs.height_px=e.height_px;
CREATE TABLE user_emoji_library_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  initialized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  initialization_token TEXT NOT NULL,
  activity INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE user_face_emojis (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji_id INTEGER NOT NULL REFERENCES face_emoji_refs(id),
  touched_at INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(user_id,emoji_id)
) WITHOUT ROWID;
CREATE INDEX user_face_emojis_order ON user_face_emojis(user_id,touched_at DESC,position,emoji_id);
CREATE TABLE default_face_emojis (
  emoji_id INTEGER PRIMARY KEY REFERENCES face_emoji_refs(id),
  position INTEGER NOT NULL UNIQUE
);

CREATE TABLE comment_face_emojis (
  content_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  emoji_id INTEGER NOT NULL REFERENCES face_emoji_refs(id),
  PRIMARY KEY(content_id,emoji_id)
) WITHOUT ROWID;
CREATE INDEX comment_face_emojis_emoji ON comment_face_emojis(emoji_id,content_id);

CREATE TABLE forum_post_face_emojis (
  content_id INTEGER NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  emoji_id INTEGER NOT NULL REFERENCES face_emoji_refs(id),
  PRIMARY KEY(content_id,emoji_id)
) WITHOUT ROWID;
CREATE INDEX forum_post_face_emojis_emoji ON forum_post_face_emojis(emoji_id,content_id);

CREATE TABLE forum_comment_face_emojis (
  content_id INTEGER NOT NULL REFERENCES forum_post_comments(id) ON DELETE CASCADE,
  emoji_id INTEGER NOT NULL REFERENCES face_emoji_refs(id),
  PRIMARY KEY(content_id,emoji_id)
) WITHOUT ROWID;
CREATE INDEX forum_comment_face_emojis_emoji ON forum_comment_face_emojis(emoji_id,content_id);

CREATE TRIGGER user_face_emojis_available BEFORE INSERT ON user_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;

CREATE TRIGGER default_face_emojis_available BEFORE INSERT ON default_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;

CREATE TRIGGER comment_face_emojis_available BEFORE INSERT ON comment_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;

CREATE TRIGGER forum_post_face_emojis_available BEFORE INSERT ON forum_post_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;

CREATE TRIGGER forum_comment_face_emojis_available BEFORE INSERT ON forum_comment_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;

-- Publication intention and current download availability are separate.
CREATE VIEW public_works AS
SELECT w.* FROM works w WHERE w.status='published' AND (
  (w.engine_family IN ('rpg_maker_2000','rpg_maker_2003','rpg_maker_2003_maniac')
    AND (SELECT COUNT(*) FROM archive_versions av WHERE av.work_id=w.id AND av.status='published' AND av.is_current=1 AND av.purged_at IS NULL)=1
    AND NOT EXISTS (SELECT 1 FROM work_external_links link WHERE link.work_id=w.id AND link.link_type='download_page'))
  OR (w.engine_family IN ('rpg_maker_xp','rpg_maker_vx','rpg_maker_vx_ace','rpg_maker_mv','rpg_maker_mz','rpg_maker_unite','other')
    AND NOT EXISTS (SELECT 1 FROM archive_versions av WHERE av.work_id=w.id AND av.status='published' AND av.is_current=1)
    AND (SELECT COUNT(*) FROM work_external_links link WHERE link.work_id=w.id AND link.link_type='download_page')=1)
);

-- Deleted replies are placeholders only; this view counts readable comment bodies.
CREATE VIEW public_comments AS
SELECT c.* FROM comments c
JOIN users u ON u.id=c.user_id
JOIN comments root ON root.id=COALESCE(c.root_comment_id,c.id)
JOIN users root_user ON root_user.id=root.user_id
WHERE c.status='published' AND root.status='published'
  AND u.status IN ('active','deleted') AND root_user.status IN ('active','deleted')
  AND (EXISTS (SELECT 1 FROM public_works w WHERE w.id=c.work_id)
    OR EXISTS (SELECT 1 FROM work_staff staff JOIN public_works w ON w.id=staff.work_id WHERE staff.creator_id=c.creator_id)
    OR EXISTS (SELECT 1 FROM characters ch WHERE ch.id=c.character_id));
