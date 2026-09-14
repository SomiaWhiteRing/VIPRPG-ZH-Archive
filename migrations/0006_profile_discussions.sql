ALTER TABLE users ADD COLUMN profile_show_discussions INTEGER NOT NULL DEFAULT 0 CHECK (profile_show_discussions IN (0, 1));
