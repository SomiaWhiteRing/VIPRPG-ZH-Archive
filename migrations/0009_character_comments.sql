-- Add characters to the existing comment target model, retaining comments and likes.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE comment_likes_copy AS SELECT * FROM comment_likes;
CREATE TABLE comment_sequence_copy AS SELECT seq FROM sqlite_sequence WHERE name='comments';

CREATE TABLE comments_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id INTEGER REFERENCES works(id) ON DELETE CASCADE,
  creator_id INTEGER REFERENCES creators(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  root_comment_id INTEGER REFERENCES comments_next(id) ON DELETE CASCADE,
  reply_to_comment_id INTEGER REFERENCES comments_next(id) ON DELETE SET NULL,
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
  CHECK ((work_id IS NOT NULL) + (creator_id IS NOT NULL) + (character_id IS NOT NULL) = 1),
  CHECK (root_comment_id IS NULL OR root_comment_id <> id),
  CHECK (reply_to_comment_id IS NULL OR reply_to_comment_id <> id)
);


INSERT INTO comments_next(id,work_id,creator_id,user_id,root_comment_id,reply_to_comment_id,body,status,created_at,updated_at,edited_at,deleted_at) SELECT id,work_id,creator_id,user_id,root_comment_id,reply_to_comment_id,body,status,created_at,updated_at,edited_at,deleted_at FROM comments;
DROP TABLE comment_likes;
DROP TABLE comments;
ALTER TABLE comments_next RENAME TO comments;
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM comment_sequence_copy),0)) WHERE name='comments';
DROP TABLE comment_sequence_copy;

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


CREATE INDEX idx_comments_character_public_roots ON comments(character_id,created_at,id)
  WHERE character_id IS NOT NULL AND root_comment_id IS NULL AND status='published';
INSERT INTO comment_likes SELECT * FROM comment_likes_copy;
DROP TABLE comment_likes_copy;
PRAGMA defer_foreign_keys = OFF;
