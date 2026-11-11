CREATE TABLE netplay_spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  external_endpoint TEXT
);

ALTER TABLE works ADD COLUMN netplay_space_id INTEGER REFERENCES netplay_spaces(id);
CREATE INDEX works_netplay_space_idx ON works(netplay_space_id) WHERE netplay_space_id IS NOT NULL;

-- Keep the existing Hong Kong service addresses. Their numeric path segments
-- identify the relay instance, and are no longer derived from a game's archive.
INSERT INTO netplay_spaces (id, name, external_endpoint)
SELECT w.id, substr(COALESCE(NULLIF(w.chinese_title, ''), w.original_title), 1, 80),
  CASE
    WHEN w.id=18 AND w.original_title='玉露弾・联机版' THEN
      'https://netplay-hk-staging.viprpg.org/api/netplay/v1/' || av.id || '/auto/'
    WHEN w.id=282 AND w.original_title='玉露弾' THEN
      'https://netplay-hk.viprpg.org/api/netplay/v1/' || av.id || '/auto/'
  END
FROM works w JOIN archive_versions av ON av.work_id=w.id
WHERE av.is_current=1 AND av.status='published' AND av.purged_at IS NULL AND av.netplay_service=1;

UPDATE works SET netplay_space_id=id WHERE id IN (SELECT id FROM netplay_spaces);
