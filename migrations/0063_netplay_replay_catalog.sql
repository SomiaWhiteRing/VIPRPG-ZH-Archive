CREATE TABLE netplay_replay_catalog (
  serial INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL UNIQUE REFERENCES netplay_matches(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  terminal_json TEXT NOT NULL,
  start_json TEXT,
  revision TEXT NOT NULL DEFAULT (lower(hex(randomblob(16))))
);
CREATE INDEX netplay_replay_catalog_by_date ON netplay_replay_catalog(started_at DESC,match_id DESC);

-- Preserve previously eligible recordings; old missing start metadata is filled on first read.
INSERT INTO netplay_replay_catalog(match_id,started_at,terminal_json,start_json)
SELECT m.id, m.started_at, terminal.terminal_json,
    CASE
      WHEN a.start_json IS NULL THEN b.start_json
      WHEN json_type(a.start_json,'$.blind') IN ('true','false')
        AND json_type(b.start_json,'$.blind') IN ('true','false')
        AND json_extract(a.start_json,'$.blind')<>json_extract(b.start_json,'$.blind')
        THEN json_remove(a.start_json,'$.blind')
      WHEN json_type(a.start_json,'$.blind') IS NULL THEN COALESCE(b.start_json,a.start_json)
      ELSE a.start_json
    END AS start_json
  FROM netplay_matches m
  JOIN (SELECT match_id,MAX(terminal_json) AS terminal_json FROM netplay_match_chunks WHERE seat=1
    GROUP BY match_id HAVING MAX(end_reason)='settled' AND COUNT(*)=MAX(seq)+1) terminal ON terminal.match_id=m.id
  JOIN (SELECT match_id,MAX(terminal_json) AS terminal_json FROM netplay_match_chunks WHERE seat=2
    GROUP BY match_id HAVING MAX(end_reason)='settled' AND COUNT(*)=MAX(seq)+1) other ON other.match_id=m.id
  LEFT JOIN netplay_replay_recording_start a ON a.match_id=m.id AND a.seat=1
  LEFT JOIN netplay_replay_recording_start b ON b.match_id=m.id AND b.seat=2
  WHERE terminal.terminal_json=other.terminal_json
    AND NOT EXISTS (SELECT 1 FROM netplay_replay_recovery r WHERE r.match_id=m.id AND r.variables_json IS NULL)
    AND (a.start_json IS NULL OR a.start_json<>'null') AND (b.start_json IS NULL OR b.start_json<>'null')
    AND (a.start_json IS NULL OR b.start_json IS NULL
      OR json_remove(a.start_json,'$.blind')=json_remove(b.start_json,'$.blind'));

-- New input segments invalidate a prepared artifact before the uploader rechecks completeness.
CREATE TRIGGER netplay_replay_chunk_insert AFTER INSERT ON netplay_match_chunks BEGIN
  DELETE FROM netplay_replay_catalog WHERE match_id=NEW.match_id;
END;

-- Historical opening-state repair changes the video inputs, even when its terminal is unchanged.
CREATE TRIGGER netplay_replay_recovery_insert AFTER INSERT ON netplay_replay_recovery BEGIN
  UPDATE netplay_replay_catalog SET revision=lower(hex(randomblob(16))) WHERE match_id=NEW.match_id;
END;
CREATE TRIGGER netplay_replay_recovery_update AFTER UPDATE ON netplay_replay_recovery BEGIN
  UPDATE netplay_replay_catalog SET revision=lower(hex(randomblob(16))) WHERE match_id=NEW.match_id;
END;
CREATE TRIGGER netplay_replay_recovery_delete AFTER DELETE ON netplay_replay_recovery BEGIN
  UPDATE netplay_replay_catalog SET revision=lower(hex(randomblob(16))) WHERE match_id=OLD.match_id;
END;
