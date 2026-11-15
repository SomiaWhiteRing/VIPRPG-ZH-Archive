import type { AppRuntime } from "@/app/.server/runtime";

// Run once at upload completion, rather than rechecking chunks on every list request.
export async function indexNetplayReplay(runtime: Pick<AppRuntime, "db">, id: string) {
  return runtime.db.prepare(`INSERT INTO netplay_replay_catalog(match_id,started_at,terminal_json,start_json)
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
  JOIN (SELECT match_id,MAX(terminal_json) AS terminal_json FROM netplay_match_chunks WHERE match_id=?1 AND seat=1
    GROUP BY match_id HAVING MAX(end_reason)='settled' AND COUNT(*)=MAX(seq)+1) terminal ON terminal.match_id=m.id
  JOIN (SELECT match_id,MAX(terminal_json) AS terminal_json FROM netplay_match_chunks WHERE match_id=?1 AND seat=2
    GROUP BY match_id HAVING MAX(end_reason)='settled' AND COUNT(*)=MAX(seq)+1) other ON other.match_id=m.id
  LEFT JOIN netplay_replay_recording_start a ON a.match_id=m.id AND a.seat=1
  LEFT JOIN netplay_replay_recording_start b ON b.match_id=m.id AND b.seat=2
  WHERE m.id=?1 AND terminal.terminal_json=other.terminal_json
    AND NOT EXISTS (SELECT 1 FROM netplay_replay_recovery r WHERE r.match_id=m.id AND r.variables_json IS NULL)
    AND (a.start_json IS NULL OR a.start_json<>'null') AND (b.start_json IS NULL OR b.start_json<>'null')
    AND (a.start_json IS NULL OR b.start_json IS NULL
      OR json_remove(a.start_json,'$.blind')=json_remove(b.start_json,'$.blind'))
  ON CONFLICT(match_id) DO NOTHING
  RETURNING revision,terminal_json`).bind(id).first<{ revision: string; terminal_json: string }>();
}
