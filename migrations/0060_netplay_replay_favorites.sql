CREATE TABLE netplay_replay_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES netplay_matches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, match_id)
);
