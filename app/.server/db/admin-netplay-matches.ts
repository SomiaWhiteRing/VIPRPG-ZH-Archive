import { netplayRecordingKey } from "@/app/.server/db/netplay-recordings";
import type { AppRuntime } from "@/app/.server/runtime";
import type { RecordingBatch } from "../../../scripts/netplay-recording.mjs";

type MatchRow = { id: string; started_at: number; room_json: string };
type SeatRow = {
  match_id: string; seat: number; user_id: number | null; display_name: string;
  current_name: string | null; archive_version_id: number | null;
  end_reason: string | null; terminal: string | null; chunks: number;
  last_sequence: number | null; last_received_at: number | null;
};

const SEATS = `
  SELECT s.match_id, s.seat, s.user_id, s.display_name, u.display_name AS current_name, s.archive_version_id,
    MAX(c.end_reason) AS end_reason, MAX(c.terminal_json) AS terminal,
    COUNT(c.seq) AS chunks, MAX(c.seq) AS last_sequence, MAX(c.received_at) AS last_received_at
  FROM netplay_match_seats s
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN netplay_match_chunks c ON c.match_id = s.match_id AND c.seat = s.seat
`;

function matchDetails(match: MatchRow, seats: SeatRow[]) {
  return {
    id: match.id,
    startedAt: match.started_at,
    room: JSON.parse(match.room_json) as RecordingBatch["room"],
    seats: seats.map(seat => {
      const score = seat.terminal ? JSON.parse(seat.terminal) as [number, number, number] : null;
      return { ...seat, score: score?.length === 3 && score.every(Number.isSafeInteger) ? score : null };
    }),
  };
}

export async function listAdminNetplayMatches(runtime: AppRuntime, input: {
  player: string; from?: number; until?: number; reason: string; page: number; pageSize: number;
}) {
  const where: string[] = [];
  const bindings: (number | string)[] = [];
  if (input.player) {
    const term = `%${input.player.replace(/[\\%_]/g, "\\$&")}%`;
    const uid = /^#?[1-9]\d*$/.test(input.player) ? Number(input.player.replace(/^#/, "")) : -1;
    where.push(`EXISTS (
      SELECT 1 FROM netplay_match_seats s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.match_id = m.id AND (s.user_id = ? OR s.display_name LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')
    )`);
    bindings.push(Number.isSafeInteger(uid) && uid > 0 ? uid : -1, term, term);
  }
  if (input.from !== undefined) {
    where.push("m.started_at >= ?");
    bindings.push(input.from);
  }
  if (input.until !== undefined) {
    where.push("m.started_at < ?");
    bindings.push(input.until);
  }
  if (input.reason) {
    where.push("EXISTS (SELECT 1 FROM netplay_match_chunks c WHERE c.match_id = m.id AND c.end_reason = ?)");
    bindings.push(input.reason);
  }
  const from = `FROM netplay_matches m ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const db = runtime.db;
  const total = await db.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...bindings).first<number>("total") ?? 0;
  const page = Math.min(input.page, Math.max(1, Math.ceil(total / input.pageSize)));
  const { results: matches } = await db.prepare(`SELECT m.id, m.started_at, m.room_json ${from}
    ORDER BY m.started_at DESC, m.id DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, input.pageSize, (page - 1) * input.pageSize).all<MatchRow>();
  if (!matches.length) return { matches: [], total, page };
  const { results: seats } = await db.prepare(`${SEATS}
    WHERE s.match_id IN (${matches.map(() => "?").join(", ")})
    GROUP BY s.match_id, s.seat ORDER BY s.seat`).bind(...matches.map(match => match.id)).all<SeatRow>();
  return { matches: matches.map(match => matchDetails(match, seats.filter(seat => seat.match_id === match.id))), total, page };
}

export async function getAdminNetplayMatch(runtime: AppRuntime, id: string) {
  const match = await runtime.db.prepare("SELECT id, started_at, room_json FROM netplay_matches WHERE id = ?").bind(id).first<MatchRow>();
  if (!match) return null;
  const { results: seats } = await runtime.db.prepare(`${SEATS} WHERE s.match_id = ?
    GROUP BY s.match_id, s.seat ORDER BY s.seat`).bind(id).all<SeatRow>();
  return matchDetails(match, seats);
}

export async function netplayRecordingSequences(runtime: AppRuntime, id: string, seat: number) {
  const { results } = await runtime.db.prepare(
    "SELECT seq FROM netplay_match_chunks WHERE match_id = ? AND seat = ? ORDER BY seq",
  ).bind(id, seat).all<{ seq: number }>();
  return results.map(row => row.seq);
}

export async function getNetplayRecordingSummary(runtime: AppRuntime, id: string, seat: number) {
  const sequences = await netplayRecordingSequences(runtime, id, seat);
  const bucket = runtime.env.ARCHIVE_BUCKET;
  const routes = new Set<string>();
  let waits = 0, longestWaitMs = 0, totalWaitMs = 0, missingFiles = 0;
  for (const seq of sequences) {
    const object = await bucket.get(netplayRecordingKey(id, seat, seq));
    if (!object) {
      ++missingFiles;
      continue;
    }
    for (const event of await object.json<RecordingBatch["events"]>()) {
      if (event[0] === "remote" && typeof event[4] === "string") routes.add(event[4]);
      if (event[0] !== "diagnostic") continue;
      const diagnostic = event[1] as { kind?: string; durationMs?: number } | null | undefined;
      const ms = diagnostic?.durationMs;
      if (diagnostic?.kind !== "wait_end" || typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) continue;
      ++waits;
      longestWaitMs = Math.max(longestWaitMs, ms);
      totalWaitMs += ms;
    }
  }
  return { routes: [...routes], waits, longestWaitMs, totalWaitMs, missingFiles };
}
