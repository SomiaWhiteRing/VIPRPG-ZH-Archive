-- Timeline is always public; source sections retain their own privacy rules.
ALTER TABLE users DROP COLUMN profile_show_timeline;

-- Extend the event-kind constraint without losing dependent interactions,
-- emoji references, image ownership or the previously allocated event IDs.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE migration_0036_events AS SELECT * FROM timeline_events;
CREATE TABLE migration_0036_sequence AS SELECT seq FROM sqlite_sequence WHERE name='timeline_events';
CREATE TABLE migration_0036_likes AS SELECT * FROM timeline_status_likes;
CREATE TABLE migration_0036_replies AS SELECT * FROM timeline_status_replies;
CREATE TABLE migration_0036_event_emojis AS SELECT * FROM timeline_event_face_emojis;
CREATE TABLE migration_0036_reply_emojis AS SELECT * FROM timeline_reply_face_emojis;
CREATE TABLE migration_0036_images AS
  SELECT id,timeline_event_id,timeline_reply_id,position FROM comment_images
  WHERE timeline_event_id IS NOT NULL OR timeline_reply_id IS NOT NULL;
DROP TRIGGER timeline_event_face_emojis_available;
DROP TRIGGER timeline_reply_face_emojis_available;
DROP TABLE timeline_events;

CREATE TABLE timeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('favorite','catalog','comment','discussion','upload','play','status','join','rename')),
  action TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  work_id INTEGER REFERENCES works(id) ON DELETE CASCADE,
  catalog_id INTEGER REFERENCES catalogs(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  forum_post_id INTEGER REFERENCES forum_posts(id) ON DELETE CASCADE,
  archive_version_id INTEGER REFERENCES archive_versions(id) ON DELETE CASCADE,
  body TEXT,
  request_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hidden_at TEXT,
  previous_name TEXT,
  new_name TEXT,
  CHECK((kind='status' AND ((hidden_at IS NOT NULL AND body IS NULL) OR (body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 16000)))
    OR (kind<>'status' AND body IS NULL)),
  CHECK((kind IN ('favorite','upload','play') AND work_id IS NOT NULL)
    OR (kind='catalog' AND catalog_id IS NOT NULL)
    OR (kind='comment' AND comment_id IS NOT NULL)
    OR (kind='discussion' AND forum_post_id IS NOT NULL)
    OR kind IN ('status','join','rename')),
  CHECK((kind='rename' AND previous_name IS NOT NULL AND new_name IS NOT NULL AND previous_name<>new_name)
    OR (kind<>'rename' AND previous_name IS NULL AND new_name IS NULL)),
  CHECK(kind NOT IN ('join','rename') OR (hidden_at IS NULL AND work_id IS NULL AND catalog_id IS NULL
    AND comment_id IS NULL AND forum_post_id IS NULL AND archive_version_id IS NULL AND request_hash IS NULL))
);
INSERT INTO timeline_events(id,user_id,kind,action,event_key,work_id,catalog_id,comment_id,forum_post_id,
  archive_version_id,body,request_hash,created_at,updated_at,hidden_at)
SELECT id,user_id,kind,action,event_key,work_id,catalog_id,comment_id,forum_post_id,
  archive_version_id,body,request_hash,created_at,updated_at,hidden_at FROM migration_0036_events;
DELETE FROM sqlite_sequence WHERE name='timeline_events';
INSERT INTO sqlite_sequence(name,seq) SELECT 'timeline_events',COALESCE(MAX(seq),0) FROM migration_0036_sequence;
INSERT INTO timeline_status_likes SELECT * FROM migration_0036_likes;
INSERT INTO timeline_status_replies SELECT * FROM migration_0036_replies;
INSERT INTO timeline_event_face_emojis SELECT * FROM migration_0036_event_emojis;
INSERT INTO timeline_reply_face_emojis SELECT * FROM migration_0036_reply_emojis;
UPDATE comment_images SET
  timeline_event_id=(SELECT timeline_event_id FROM migration_0036_images WHERE id=comment_images.id),
  timeline_reply_id=(SELECT timeline_reply_id FROM migration_0036_images WHERE id=comment_images.id),
  position=(SELECT position FROM migration_0036_images WHERE id=comment_images.id)
WHERE id IN (SELECT id FROM migration_0036_images);
DROP TABLE migration_0036_events;
DROP TABLE migration_0036_sequence;
DROP TABLE migration_0036_likes;
DROP TABLE migration_0036_replies;
DROP TABLE migration_0036_event_emojis;
DROP TABLE migration_0036_reply_emojis;
DROP TABLE migration_0036_images;

CREATE INDEX timeline_events_recent ON timeline_events(created_at DESC,id DESC) WHERE hidden_at IS NULL;
CREATE INDEX timeline_events_user_recent ON timeline_events(user_id,created_at DESC,id DESC) WHERE hidden_at IS NULL;
CREATE INDEX timeline_status_user_recent ON timeline_events(user_id,created_at) WHERE kind='status';
CREATE TRIGGER timeline_record_permission BEFORE INSERT ON timeline_events
WHEN NEW.kind NOT IN ('join','rename') AND NOT EXISTS (
  SELECT 1 FROM users u JOIN effective_user_roles ur ON ur.user_id=u.id
  JOIN role_permissions rp ON rp.role_id=ur.role_id AND rp.permission_key='timeline.use'
  WHERE u.id=NEW.user_id AND u.status='active'
    AND NOT EXISTS(SELECT 1 FROM user_permission_blocks b WHERE b.user_id=u.id AND b.permission_key=rp.permission_key)
)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER timeline_status_immutable BEFORE UPDATE OF body ON timeline_events
WHEN OLD.kind='status' AND NEW.body IS NOT NULL AND NEW.body IS NOT OLD.body
BEGIN SELECT RAISE(ABORT,'timeline status cannot be edited'); END;
CREATE TRIGGER timeline_event_face_emojis_available BEFORE INSERT ON timeline_event_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;
CREATE TRIGGER timeline_reply_face_emojis_available BEFORE INSERT ON timeline_reply_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;

-- Account milestones bypass activity recording switches and permissions.
INSERT INTO timeline_events(user_id,kind,action,event_key,created_at,updated_at)
SELECT id,'join','加入了VIPRPG.org','account-join:'||id,created_at,created_at FROM users WHERE 1
ON CONFLICT(event_key) DO NOTHING;
CREATE TRIGGER timeline_user_join AFTER INSERT ON users
BEGIN
  INSERT INTO timeline_events(user_id,kind,action,event_key,created_at,updated_at)
  VALUES(NEW.id,'join','加入了VIPRPG.org','account-join:'||NEW.id,NEW.created_at,NEW.created_at);
END;
CREATE TRIGGER timeline_user_rename AFTER UPDATE OF display_name ON users
WHEN OLD.status='active' AND NEW.status='active' AND OLD.display_name IS NOT NEW.display_name
BEGIN
  INSERT INTO timeline_events(user_id,kind,action,event_key,previous_name,new_name)
  VALUES(NEW.id,'rename','改名','account-rename:'||lower(hex(randomblob(16))),OLD.display_name,NEW.display_name);
END;
CREATE TRIGGER timeline_account_history_update BEFORE UPDATE ON timeline_events
WHEN OLD.kind IN ('join','rename') OR NEW.kind IN ('join','rename')
BEGIN SELECT RAISE(ABORT,'account timeline history is permanent'); END;
CREATE TRIGGER timeline_account_history_delete BEFORE DELETE ON timeline_events
WHEN OLD.kind IN ('join','rename')
BEGIN SELECT RAISE(ABORT,'account timeline history is permanent'); END;
