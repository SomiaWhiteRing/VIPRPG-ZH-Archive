ALTER TABLE users ADD COLUMN role_key TEXT NOT NULL DEFAULT 'user'
  CHECK (role_key IN ('super_admin', 'admin', 'uploader', 'user'));

UPDATE users
SET role_key = CASE
  WHEN role = 'admin' THEN 'admin'
  WHEN upload_status = 'approved' THEN 'uploader'
  ELSE 'user'
END;

CREATE INDEX IF NOT EXISTS idx_users_role_key
  ON users(role_key, created_at);

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
