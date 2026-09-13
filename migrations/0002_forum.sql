CREATE TABLE forum_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK(status='deleted' OR length(title) BETWEEN 1 AND 160),
  title_search TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','deleted')),
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
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
  UNIQUE(user_id,request_key)
);
CREATE TABLE forum_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES forum_topics(id),
  post_number INTEGER NOT NULL CHECK(post_number > 0),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  body_search TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','deleted')),
  revision TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
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
  body_search TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden','deleted')),
  revision TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
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
CREATE VIEW forum_public_content AS
SELECT 'post' AS kind,p.id,p.topic_id,p.id AS post_id,p.post_number,p.user_id,p.body,p.body_search,p.created_at
FROM forum_public_posts p
UNION ALL
SELECT 'comment',c.id,c.topic_id,c.post_id,c.post_number,c.user_id,c.body,c.body_search,c.created_at
FROM forum_public_comments c;

INSERT OR IGNORE INTO role_permissions(role_id,permission_key)
SELECT r.id,p.value FROM roles r,json_each('["forum.content.moderate_any","forum.topic.feature_any","forum.tag.manage"]') p
WHERE r.key IN ('admin','super_admin');
