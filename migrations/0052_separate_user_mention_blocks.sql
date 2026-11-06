ALTER TABLE user_block_settings ADD COLUMN mute_mentions INTEGER NOT NULL DEFAULT 0 CHECK(mute_mentions IN(0,1));

-- Preserve the former combined replies/mentions preference.
UPDATE user_block_settings SET mute_mentions=mute_replies;
