ALTER TABLE users ADD COLUMN notify_uploaded_work_comments INTEGER NOT NULL DEFAULT 1
  CHECK (notify_uploaded_work_comments IN (0, 1));

-- A system-generated notice with a live comment reference, never a private body snapshot.
ALTER TABLE inbox_items ADD COLUMN work_comment_id INTEGER REFERENCES comments(id);
