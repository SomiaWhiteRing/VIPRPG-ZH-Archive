CREATE TABLE forum_images_next (
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
  body_offset INTEGER NOT NULL DEFAULT 0 CHECK(typeof(body_offset)='integer' AND body_offset>=0),
  UNIQUE(user_id,client_id),
  CHECK((post_id IS NULL) = (position IS NULL))
);

-- Image offsets are UTF-16 positions checked against the submitted body.
INSERT INTO forum_images_next(
  id,user_id,client_id,fingerprint,status,object_key,format,size,width,height,
  post_id,position,created_at,updated_at,body_offset
)
SELECT id,user_id,client_id,fingerprint,status,object_key,format,size,width,height,
  post_id,position,created_at,updated_at,body_offset
FROM forum_images;

DROP TABLE forum_images;
ALTER TABLE forum_images_next RENAME TO forum_images;
CREATE INDEX forum_images_post ON forum_images(post_id,position);
CREATE INDEX forum_images_uploads ON forum_images(user_id,created_at);
