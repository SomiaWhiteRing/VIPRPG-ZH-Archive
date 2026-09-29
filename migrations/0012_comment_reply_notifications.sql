ALTER TABLE inbox_items ADD COLUMN reply_comment_id INTEGER REFERENCES comments(id);
