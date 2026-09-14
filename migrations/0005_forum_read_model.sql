ALTER TABLE forum_post_comments ADD COLUMN comment_number INTEGER NOT NULL DEFAULT 1 CHECK(comment_number > 0);
ALTER TABLE forum_posts ADD COLUMN next_comment_number INTEGER NOT NULL DEFAULT 1 CHECK(next_comment_number > 0);
WITH numbered AS (
  SELECT id,row_number() OVER(PARTITION BY post_id ORDER BY created_at,id) AS n FROM forum_post_comments
) UPDATE forum_post_comments SET comment_number=(SELECT n FROM numbered WHERE numbered.id=forum_post_comments.id);
CREATE UNIQUE INDEX forum_comment_numbers ON forum_post_comments(post_id,comment_number);
CREATE INDEX forum_posts_writer_revision ON forum_posts(user_id,revision);
CREATE INDEX forum_comments_writer_revision ON forum_post_comments(user_id,revision);
UPDATE forum_posts SET next_comment_number=1+(SELECT COUNT(*) FROM forum_post_comments c WHERE c.post_id=forum_posts.id);

ALTER TABLE forum_topics ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0 CHECK(reply_count >= 0);
ALTER TABLE forum_topics ADD COLUMN last_activity_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00';
ALTER TABLE forum_topics ADD COLUMN last_post_id INTEGER REFERENCES forum_posts(id);
ALTER TABLE forum_topics ADD COLUMN last_comment_id INTEGER REFERENCES forum_post_comments(id);

UPDATE forum_topics SET reply_count=
  (SELECT COUNT(*) FROM forum_posts p WHERE p.topic_id=forum_topics.id AND p.post_number<>1)+
  (SELECT COUNT(*) FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id WHERE p.topic_id=forum_topics.id);
WITH replies AS (
  SELECT topic_id,id AS post_id,NULL AS comment_id,created_at,0 AS kind,id FROM forum_posts WHERE post_number<>1
  UNION ALL
  SELECT p.topic_id,NULL,c.id,c.created_at,1,c.id FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id
), latest AS (
  SELECT *,row_number() OVER(PARTITION BY topic_id ORDER BY created_at DESC,kind DESC,id DESC) AS n FROM replies
)
UPDATE forum_topics SET
  last_activity_at=COALESCE((SELECT created_at FROM latest WHERE topic_id=forum_topics.id AND n=1),created_at),
  last_post_id=(SELECT post_id FROM latest WHERE topic_id=forum_topics.id AND n=1),
  last_comment_id=(SELECT comment_id FROM latest WHERE topic_id=forum_topics.id AND n=1);
CREATE INDEX forum_topics_activity ON forum_topics(last_activity_at DESC,id DESC);
CREATE INDEX forum_topics_featured ON forum_topics(featured_at DESC,id DESC) WHERE featured_at IS NOT NULL;

-- Document IDs are publication order, not source IDs. Keep them on deletion.
CREATE TABLE forum_search_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER UNIQUE REFERENCES forum_posts(id),
  comment_id INTEGER UNIQUE REFERENCES forum_post_comments(id),
  CHECK((post_id IS NOT NULL)+(comment_id IS NOT NULL)=1)
);
INSERT INTO forum_search_documents(post_id,comment_id)
SELECT post_id,comment_id FROM (
  SELECT id AS post_id,NULL AS comment_id,created_at,0 AS kind,id FROM forum_posts
  UNION ALL
  SELECT NULL,id,created_at,1,id FROM forum_post_comments
) ORDER BY created_at,kind,id;
CREATE VIRTUAL TABLE forum_search_index USING fts5(title,body,scope);
-- The offline conversion command encodes existing text with JavaScript NFKC.

DROP VIEW forum_public_content;
ALTER TABLE forum_topics DROP COLUMN title_search;
ALTER TABLE forum_posts DROP COLUMN body_search;
ALTER TABLE forum_post_comments DROP COLUMN body_search;
