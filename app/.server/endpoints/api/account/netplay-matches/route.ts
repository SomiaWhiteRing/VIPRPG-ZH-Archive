import { getCurrentUser } from "@/app/.server/auth/current-user";
import type { AppRuntime } from "@/app/.server/runtime";
import { json } from "@/lib/http";

export async function GET(runtime: AppRuntime) {
  const user = await getCurrentUser(runtime);
  if (!user) return new Response(null, { status: 401 });
  const { results } = await runtime.db.prepare(`
    WITH recent AS (
      SELECT DISTINCT m.id, m.started_at
      FROM netplay_match_seats mine JOIN netplay_matches m ON m.id = mine.match_id
      WHERE mine.user_id = ? ORDER BY m.started_at DESC LIMIT 50
    )
    SELECT m.id, m.started_at, s.user_id = ? AS is_own_seat, s.seat, s.display_name, s.work_id, s.archive_version_id,
      COUNT(c.seq) AS chunks, MAX(c.seq) AS last_sequence, MAX(c.terminal_json) AS terminal,
      MAX(c.end_reason) AS end_reason, MAX(c.received_at) AS last_received_at
    FROM recent m JOIN netplay_match_seats s ON s.match_id = m.id
    LEFT JOIN netplay_match_chunks c ON c.match_id = s.match_id AND c.seat = s.seat
    GROUP BY m.id, s.seat ORDER BY m.started_at DESC, m.id, s.seat
  `).bind(user.id, user.id).all();
  return json({ matches: results }, { headers: { "Cache-Control": "private, no-store" } });
}
