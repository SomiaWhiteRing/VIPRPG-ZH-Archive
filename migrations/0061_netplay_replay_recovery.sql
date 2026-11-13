CREATE TABLE netplay_replay_recovery (
  match_id TEXT PRIMARY KEY REFERENCES netplay_matches(id) ON DELETE CASCADE,
  -- A NULL row marks a recording that failed verification.
  variables_json TEXT CHECK (variables_json IS NULL OR json_type(variables_json) = 'array')
);
