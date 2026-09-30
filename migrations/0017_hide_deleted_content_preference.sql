ALTER TABLE users ADD COLUMN hide_deleted_content INTEGER NOT NULL DEFAULT 0
  CHECK (hide_deleted_content IN (0, 1));
