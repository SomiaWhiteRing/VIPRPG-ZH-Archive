CREATE TABLE netplay_replay_recording_start (
  match_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  start_json TEXT NOT NULL,
  PRIMARY KEY (match_id, seat),
  FOREIGN KEY (match_id, seat) REFERENCES netplay_match_seats(match_id, seat) ON DELETE CASCADE
);
