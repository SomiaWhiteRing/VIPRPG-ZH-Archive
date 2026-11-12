CREATE TABLE netplay_matches (
  id TEXT PRIMARY KEY,
  game_match_key INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  room_json TEXT NOT NULL
);

CREATE TABLE netplay_match_seats (
  match_id TEXT NOT NULL REFERENCES netplay_matches(id) ON DELETE CASCADE,
  seat INTEGER NOT NULL CHECK (seat IN (1, 2)),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  work_id INTEGER,
  archive_version_id INTEGER,
  PRIMARY KEY (match_id, seat)
);

CREATE INDEX netplay_match_seats_by_user ON netplay_match_seats (user_id, match_id);

CREATE TABLE netplay_match_chunks (
  match_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  terminal_json TEXT,
  end_reason TEXT,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, seat, seq),
  FOREIGN KEY (match_id, seat) REFERENCES netplay_match_seats(match_id, seat) ON DELETE CASCADE
);
