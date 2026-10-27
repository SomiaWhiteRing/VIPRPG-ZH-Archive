-- Extend ordinary comments to catalogs, retaining all allocated IDs and interactions.
-- D1 defers constraint checks, but CASCADE and SET NULL still run during DROP.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE migration_0045_comments AS SELECT * FROM comments;
CREATE TABLE migration_0045_sequence AS SELECT seq FROM sqlite_sequence WHERE name='comments';
CREATE TABLE migration_0045_likes AS SELECT * FROM comment_likes;
CREATE TABLE migration_0045_emojis AS SELECT * FROM comment_face_emojis;
CREATE TABLE migration_0045_events AS SELECT * FROM timeline_events WHERE comment_id IS NOT NULL;
CREATE TABLE migration_0045_event_emojis AS SELECT * FROM timeline_event_face_emojis
  WHERE content_id IN (SELECT id FROM migration_0045_events);
CREATE TABLE migration_0045_images AS SELECT id,comment_id FROM comment_images WHERE comment_id IS NOT NULL;
-- Restore historical emoji references and events even if their current availability changed.
DROP TRIGGER comment_face_emojis_available;
DROP TRIGGER timeline_event_face_emojis_available;
DROP TRIGGER timeline_record_permission;
DROP VIEW public_comments;
DROP VIEW published_comments;
DROP TABLE comments;

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER REFERENCES works(id) ON DELETE CASCADE,
  creator_id INTEGER REFERENCES creators(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  catalog_id INTEGER REFERENCES catalogs(id) ON DELETE CASCADE,
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
  CHECK ((work_id IS NOT NULL) + (creator_id IS NOT NULL) + (character_id IS NOT NULL) + (catalog_id IS NOT NULL) = 1),
  CHECK (root_comment_id IS NULL OR root_comment_id <> id),
  CHECK (reply_to_comment_id IS NULL OR reply_to_comment_id <> id),
  UNIQUE(user_id,request_key)
);

INSERT INTO comments(id,work_id,creator_id,character_id,user_id,pinned_at,root_comment_id,reply_to_comment_id,
  body,request_key,request_hash,status,created_at,updated_at,edited_at,deleted_at)
SELECT id,work_id,creator_id,character_id,user_id,pinned_at,root_comment_id,reply_to_comment_id,
  body,request_key,request_hash,status,created_at,updated_at,edited_at,deleted_at FROM migration_0045_comments;
DELETE FROM sqlite_sequence WHERE name='comments';
INSERT INTO sqlite_sequence(name,seq) SELECT 'comments',COALESCE(MAX(seq),0) FROM migration_0045_sequence;
INSERT INTO comment_likes SELECT * FROM migration_0045_likes;
INSERT INTO comment_face_emojis SELECT * FROM migration_0045_emojis;
INSERT INTO timeline_events SELECT * FROM migration_0045_events;
INSERT INTO timeline_event_face_emojis SELECT * FROM migration_0045_event_emojis;
UPDATE comment_images SET comment_id=(SELECT comment_id FROM migration_0045_images WHERE id=comment_images.id)
  WHERE id IN (SELECT id FROM migration_0045_images);
DROP TABLE migration_0045_comments;
DROP TABLE migration_0045_sequence;
DROP TABLE migration_0045_likes;
DROP TABLE migration_0045_emojis;
DROP TABLE migration_0045_events;
DROP TABLE migration_0045_event_emojis;
DROP TABLE migration_0045_images;

CREATE INDEX idx_comments_author
  ON comments(user_id, updated_at DESC, id);
CREATE INDEX idx_comments_character_public ON comments(character_id)
  WHERE character_id IS NOT NULL AND status='published';
CREATE INDEX idx_comments_work_public ON comments(work_id)
  WHERE work_id IS NOT NULL AND status = 'published';
CREATE INDEX idx_comments_creator_public ON comments(creator_id)
  WHERE creator_id IS NOT NULL AND status = 'published';
CREATE INDEX idx_comments_work_roots
  ON comments(work_id, created_at, id)
  WHERE work_id IS NOT NULL AND root_comment_id IS NULL;
CREATE INDEX idx_comments_creator_roots
  ON comments(creator_id, created_at, id)
  WHERE creator_id IS NOT NULL AND root_comment_id IS NULL;
CREATE INDEX idx_comments_character_roots
  ON comments(character_id, created_at, id)
  WHERE character_id IS NOT NULL AND root_comment_id IS NULL;
CREATE INDEX idx_comments_replies
  ON comments(root_comment_id, created_at, id)
  WHERE root_comment_id IS NOT NULL;
CREATE UNIQUE INDEX idx_comments_single_work_pin ON comments(work_id)
WHERE pinned_at IS NOT NULL;
CREATE INDEX idx_comments_catalog_roots ON comments(catalog_id,created_at,id)
  WHERE catalog_id IS NOT NULL AND root_comment_id IS NULL;
CREATE INDEX idx_comments_catalog_public ON comments(catalog_id)
  WHERE catalog_id IS NOT NULL AND status='published';

CREATE VIEW published_comments AS
SELECT c.* FROM comments c
JOIN users u ON u.id=c.user_id
JOIN comments root ON root.id=COALESCE(c.root_comment_id,c.id)
JOIN users root_user ON root_user.id=root.user_id
WHERE c.status='published' AND root.status IN ('published','deleted')
  AND u.status IN ('active','deleted') AND root_user.status IN ('active','deleted')
  AND (EXISTS(SELECT 1 FROM works w WHERE w.id=c.work_id AND w.status='published')
    OR EXISTS(SELECT 1 FROM creators cr WHERE cr.id=c.creator_id AND cr.public_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM characters ch WHERE ch.id=c.character_id)
    OR EXISTS(SELECT 1 FROM catalogs catalog WHERE catalog.id=c.catalog_id AND catalog.status='published'));

CREATE VIEW public_comments AS
SELECT c.* FROM published_comments c
WHERE c.work_id IS NULL OR EXISTS(SELECT 1 FROM public_works w WHERE w.id=c.work_id);

CREATE TRIGGER comments_require_matching_root_insert
BEFORE INSERT ON comments
WHEN NEW.root_comment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM comments root
    WHERE root.id = NEW.root_comment_id
      AND root.root_comment_id IS NULL
      AND root.work_id IS NEW.work_id
      AND root.creator_id IS NEW.creator_id
      AND root.character_id IS NEW.character_id
      AND root.catalog_id IS NEW.catalog_id
  )
BEGIN
  SELECT RAISE(ABORT, 'comment root must use the same target');
END;

CREATE TRIGGER comments_require_matching_reply_insert
BEFORE INSERT ON comments
WHEN NEW.reply_to_comment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM comments target
    WHERE target.id = NEW.reply_to_comment_id
      AND target.work_id IS NEW.work_id
      AND target.creator_id IS NEW.creator_id
      AND target.character_id IS NEW.character_id
      AND target.catalog_id IS NEW.catalog_id
      AND COALESCE(target.root_comment_id, target.id) = NEW.root_comment_id
  )
BEGIN
  SELECT RAISE(ABORT, 'comment reply must use the same root and target');
END;

CREATE TRIGGER timeline_comment_insert AFTER INSERT ON comments
WHEN NEW.status='published' AND NEW.root_comment_id IS NULL
BEGIN
  INSERT INTO timeline_events(user_id,kind,action,event_key,comment_id)
  SELECT NEW.user_id,'comment','发表了评论','comment:'||NEW.id,NEW.id
  FROM users WHERE id=NEW.user_id AND status='active' AND timeline_enabled=1
    AND EXISTS(SELECT 1 FROM json_each(timeline_record_kinds) WHERE value='comment');
END;

CREATE TRIGGER comments_require_published_reply_insert
BEFORE INSERT ON comments
WHEN NEW.root_comment_id IS NOT NULL AND (
  NOT EXISTS(SELECT 1 FROM published_comments root WHERE root.id=NEW.root_comment_id)
  OR (NEW.reply_to_comment_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM published_comments target WHERE target.id=NEW.reply_to_comment_id
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'comment reply target unavailable');
END;

CREATE TRIGGER comment_face_emojis_available BEFORE INSERT ON comment_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;

CREATE TRIGGER timeline_event_face_emojis_available BEFORE INSERT ON timeline_event_face_emojis
WHEN NOT EXISTS(SELECT 1 FROM available_face_emojis WHERE id=NEW.emoji_id)
BEGIN SELECT RAISE(ABORT,'face emoji unavailable'); END;

CREATE TRIGGER timeline_record_permission BEFORE INSERT ON timeline_events
WHEN NEW.kind NOT IN ('join','rename') AND NOT EXISTS (
  SELECT 1 FROM users u JOIN effective_user_roles ur ON ur.user_id=u.id
  JOIN role_permissions rp ON rp.role_id=ur.role_id AND rp.permission_key='timeline.use'
  WHERE u.id=NEW.user_id AND u.status='active'
    AND NOT EXISTS(SELECT 1 FROM user_permission_blocks b WHERE b.user_id=u.id AND b.permission_key=rp.permission_key)
)
BEGIN SELECT RAISE(IGNORE); END;
