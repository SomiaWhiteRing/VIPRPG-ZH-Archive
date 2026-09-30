CREATE TABLE forum_comment_likes (
  comment_id INTEGER NOT NULL REFERENCES forum_post_comments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY(comment_id,user_id)
);

-- Allow forum_like to reference a nested reply using the existing live target.
-- Preserve inbound references before DROP: SQLite executes CASCADE / SET NULL
-- even when foreign-key checks are deferred. D1 applies this migration atomically.
CREATE TABLE forum_like_inbox_reads_backup AS SELECT * FROM inbox_item_reads;
CREATE TABLE forum_like_role_sources_backup AS
SELECT id,source_inbox_item_id FROM user_role_events WHERE source_inbox_item_id IS NOT NULL;

CREATE TABLE inbox_items_next (
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
  work_comment_id INTEGER REFERENCES comments(id),
  reply_comment_id INTEGER REFERENCES comments(id),
  like_comment_id INTEGER REFERENCES comments(id),
  FOREIGN KEY(forum_post_id,forum_topic_id) REFERENCES forum_posts(id,topic_id),
  FOREIGN KEY(forum_comment_id,forum_post_id) REFERENCES forum_post_comments(id,post_id),
  CHECK(recipient_user_id IS NOT NULL OR required_permission_key IS NOT NULL),
  CHECK(type NOT IN ('forum_reply','forum_like') OR
    (recipient_user_id IS NOT NULL AND required_permission_key IS NULL AND event_key IS NOT NULL
      AND forum_topic_id IS NOT NULL AND forum_post_id IS NOT NULL AND status='open'))
);

INSERT INTO inbox_items_next SELECT * FROM inbox_items;
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE(
  (SELECT seq FROM sqlite_sequence WHERE name='inbox_items'), 0
)) WHERE name='inbox_items_next';

DROP TABLE inbox_items;
ALTER TABLE inbox_items_next RENAME TO inbox_items;

INSERT INTO inbox_item_reads SELECT * FROM forum_like_inbox_reads_backup;
UPDATE user_role_events SET source_inbox_item_id=(
  SELECT b.source_inbox_item_id FROM forum_like_role_sources_backup b WHERE b.id=user_role_events.id
) WHERE id IN(SELECT id FROM forum_like_role_sources_backup);
DROP TABLE forum_like_inbox_reads_backup;
DROP TABLE forum_like_role_sources_backup;

CREATE INDEX idx_inbox_items_recipient ON inbox_items(recipient_user_id,created_at DESC,id DESC);
CREATE INDEX idx_inbox_items_permission ON inbox_items(required_permission_key,status,created_at DESC,id DESC);
CREATE INDEX idx_inbox_items_target ON inbox_items(target_user_id,type,status);
CREATE UNIQUE INDEX idx_inbox_pending_role_request ON inbox_items(target_user_id,requested_role_id)
  WHERE type='role_change_request' AND status='pending' AND target_user_id IS NOT NULL AND requested_role_id IS NOT NULL;
