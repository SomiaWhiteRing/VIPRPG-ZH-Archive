-- Rebuild the CHECK constraint while preserving reads and role-event references.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE inbox_reads_migration AS SELECT * FROM inbox_item_reads;
CREATE TABLE inbox_sources_migration AS
  SELECT id, source_inbox_item_id FROM user_role_events WHERE source_inbox_item_id IS NOT NULL;

CREATE TABLE inbox_items_new (
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
INSERT INTO inbox_items_new (
  id,type,status,sender_user_id,recipient_user_id,required_permission_key,target_user_id,
  requested_role_id,requested_role_key_snapshot,requested_role_name_snapshot,role_event_id,
  resolved_by_user_id,resolved_at,title,body,metadata_json,created_at
) SELECT id,type,status,sender_user_id,recipient_user_id,required_permission_key,target_user_id,
  requested_role_id,requested_role_key_snapshot,requested_role_name_snapshot,role_event_id,
  resolved_by_user_id,resolved_at,title,body,metadata_json,created_at FROM inbox_items;
DROP TABLE inbox_items;
ALTER TABLE inbox_items_new RENAME TO inbox_items;
INSERT OR IGNORE INTO inbox_item_reads SELECT * FROM inbox_reads_migration;
UPDATE user_role_events SET source_inbox_item_id=(
  SELECT source_inbox_item_id FROM inbox_sources_migration s WHERE s.id=user_role_events.id
) WHERE id IN (SELECT id FROM inbox_sources_migration);
DROP TABLE inbox_reads_migration;
DROP TABLE inbox_sources_migration;

CREATE INDEX idx_inbox_items_recipient ON inbox_items(recipient_user_id,created_at DESC,id DESC);
CREATE INDEX idx_inbox_items_permission ON inbox_items(required_permission_key,status,created_at DESC,id DESC);
CREATE INDEX idx_inbox_items_target ON inbox_items(target_user_id,type,status);
CREATE UNIQUE INDEX idx_inbox_pending_role_request ON inbox_items(target_user_id,requested_role_id)
  WHERE type='role_change_request' AND status='pending' AND target_user_id IS NOT NULL AND requested_role_id IS NOT NULL;
PRAGMA defer_foreign_keys = OFF;
