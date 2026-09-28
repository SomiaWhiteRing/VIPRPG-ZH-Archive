-- Tiny per-user settings travel with the existing indexed session/user lookup.
-- No preference table, additional query, sorting, or secondary index is needed.
ALTER TABLE users ADD COLUMN include_player_in_zip INTEGER NOT NULL DEFAULT 1
  CHECK (include_player_in_zip IN (0, 1));
-- NULL uses the shared defaults; [] explicitly hides all configurable shortcuts.
ALTER TABLE users ADD COLUMN account_shortcuts TEXT DEFAULT NULL
  CHECK (account_shortcuts IS NULL OR
    (length(account_shortcuts) <= 512 AND json_valid(account_shortcuts)
     AND json_type(account_shortcuts) = 'array'));

-- Immutable manifests may predate shared-player extraction. Backfill historical
-- root Player.exe sizes with scripts/archive-player-size-backfill.mjs.
-- Projection travels with existing archive reads; no additional index or query.
ALTER TABLE archive_versions ADD COLUMN embedded_player_size_bytes INTEGER NOT NULL DEFAULT 0
  CHECK (embedded_player_size_bytes >= 0 AND embedded_player_size_bytes <= total_size_bytes);
