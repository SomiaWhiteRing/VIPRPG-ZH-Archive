ALTER TABLE user_block_settings ADD COLUMN hide_posts INTEGER NOT NULL DEFAULT 0 CHECK(hide_posts IN(0,1));
