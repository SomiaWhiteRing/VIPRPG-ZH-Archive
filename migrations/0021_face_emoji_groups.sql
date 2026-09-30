CREATE TABLE user_emoji_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 20 AND name <> '全部'),
  position INTEGER NOT NULL,
  UNIQUE(user_id,id),
  UNIQUE(user_id,name)
);
CREATE INDEX user_emoji_groups_order ON user_emoji_groups(user_id,position,id);

-- Removing a group removes only its assignments. Removing a favorite also
-- removes its assignments; neither action changes immutable content references.
CREATE TABLE user_emoji_group_items (
  user_id INTEGER NOT NULL,
  emoji_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  PRIMARY KEY(user_id,emoji_id,group_id),
  FOREIGN KEY(user_id,emoji_id) REFERENCES user_face_emojis(user_id,emoji_id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,group_id) REFERENCES user_emoji_groups(user_id,id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX user_emoji_group_items_group ON user_emoji_group_items(user_id,group_id,emoji_id);
