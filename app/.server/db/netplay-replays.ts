import { getRecordedReplayStart, netplayRecordingKey } from "@/app/.server/db/netplay-recordings";
import type { AppRuntime } from "@/app/.server/runtime";
import { getUserAvatarSrc } from "@/lib/user-profile";
import type { RecordingBatch } from "../../../scripts/netplay-recording.mjs";

export const REPLAY_PAGE_SIZE = 5;

type ReplayRow = {
  id: string; started_at: number; favorite: number;
  first_name: string; first_avatar: string | null; first_archive: number | null;
  second_name: string; second_avatar: string | null; second_archive: number | null;
  terminal: string;
};

const SELECT = `
  WITH candidates AS (
    SELECT m.id, m.started_at,
      (SELECT MAX(c.terminal_json) FROM netplay_match_chunks c WHERE c.match_id=m.id AND c.seat=1) AS terminal,
      (SELECT MAX(c.terminal_json) FROM netplay_match_chunks c WHERE c.match_id=m.id AND c.seat=2) AS other_terminal
    FROM netplay_match_seats mine
    JOIN netplay_matches m ON m.id=mine.match_id
    LEFT JOIN works w ON w.id=mine.work_id
    WHERE (?2 IS NULL OR (mine.user_id=?1 AND w.netplay_space_id=?2))
      AND NOT EXISTS (SELECT 1 FROM netplay_replay_recovery r WHERE r.match_id=m.id AND r.variables_json IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM netplay_replay_recording_start a LEFT JOIN netplay_replay_recording_start b
          ON b.match_id=a.match_id AND b.seat=3-a.seat
        WHERE a.match_id=m.id AND (
          a.start_json='null' OR a.start_json<>b.start_json
        )
      )
      AND EXISTS (SELECT 1 FROM netplay_match_chunks c WHERE c.match_id=m.id
        GROUP BY c.seat HAVING c.seat=1 AND MAX(c.end_reason)='settled' AND COUNT(*)=MAX(c.seq)+1)
      AND EXISTS (SELECT 1 FROM netplay_match_chunks c WHERE c.match_id=m.id
        GROUP BY c.seat HAVING c.seat=2 AND MAX(c.end_reason)='settled' AND COUNT(*)=MAX(c.seq)+1)
    GROUP BY m.id
  )
  SELECT m.id,m.started_at,m.terminal,(f.match_id IS NOT NULL) AS favorite,
    a.display_name AS first_name,ua.avatar_blob_sha256 AS first_avatar,a.archive_version_id AS first_archive,
    b.display_name AS second_name,ub.avatar_blob_sha256 AS second_avatar,b.archive_version_id AS second_archive
  FROM candidates m
  JOIN netplay_match_seats a ON a.match_id=m.id AND a.seat=1
  JOIN netplay_match_seats b ON b.match_id=m.id AND b.seat=2
  LEFT JOIN users ua ON ua.id=a.user_id
  LEFT JOIN users ub ON ub.id=b.user_id
  LEFT JOIN netplay_replay_favorites f ON f.user_id=?1 AND f.match_id=m.id
  WHERE m.terminal=m.other_terminal
`;

function replaySummary(row: ReplayRow) {
  const terminal = JSON.parse(row.terminal) as unknown;
  if (!Array.isArray(terminal) || terminal.length !== 3 || !terminal.every(Number.isSafeInteger) ||
      terminal[0] < 1 || terminal[0] > 216000 || terminal[1] < 0 || terminal[2] < 0) return null;
  return {
    id: row.id, startedAt: row.started_at, favorite: !!row.favorite,
    players: [
      { name: row.first_name, avatar: getUserAvatarSrc(row.first_avatar) },
      { name: row.second_name, avatar: getUserAvatarSrc(row.second_avatar) },
    ],
    terminal: terminal as [number, number, number],
    archives: [row.first_archive, row.second_archive],
  };
}

export async function listNetplayReplays(runtime: AppRuntime, userId: number, space: number | null, page: number, favorites: boolean) {
  const filtered = `${SELECT} AND (?3=0 OR f.match_id IS NOT NULL)`;
  const { results } = await runtime.db.prepare(`SELECT *, COUNT(*) OVER () AS total FROM (${filtered})
    ORDER BY started_at DESC,id DESC LIMIT ?4 OFFSET ?5`)
    .bind(userId, space, Number(favorites), REPLAY_PAGE_SIZE, page * REPLAY_PAGE_SIZE).all<ReplayRow & { total: number }>();
  const pages = Math.ceil((results[0]?.total ?? 0) / REPLAY_PAGE_SIZE);
  return { entries: results.map(replaySummary).filter(Boolean), more: page + 1 < pages, pages };
}

export async function getNetplayReplay(runtime: AppRuntime, userId: number, space: number | null, id: string) {
  const row = await runtime.db.prepare(`${SELECT} AND m.id=?3`).bind(userId, space, id).first<ReplayRow>();
  return row ? replaySummary(row) : null;
}

export async function setNetplayReplayFavorite(runtime: AppRuntime, userId: number, id: string, favorite: boolean) {
  await runtime.db.prepare(favorite
    ? "INSERT OR IGNORE INTO netplay_replay_favorites(user_id,match_id) VALUES (?,?)"
    : "DELETE FROM netplay_replay_favorites WHERE user_id=? AND match_id=?").bind(userId, id).run();
}

type Start = NonNullable<ReturnType<typeof getRecordedReplayStart>> & {
  variables?: [number, number][];
};

export async function readNetplayReplay(runtime: AppRuntime, id: string, terminal: [number, number, number], includeFrames: boolean) {
  const bucket = runtime.env.ARCHIVE_BUCKET;
  const { results } = await runtime.db.prepare("SELECT seat,seq FROM netplay_match_chunks WHERE match_id=? ORDER BY seat,seq")
    .bind(id).all<{ seat: number; seq: number }>();
  const tracks = [new Map<number, number>(), new Map<number, number>()];
  let start: Start | undefined;
  const chunks = includeFrames ? results : results.filter(chunk => chunk.seq === 0);
  for (let offset = 0; offset < chunks.length; offset += 6) {
    const batch = chunks.slice(offset, offset + 6);
    const segments = await Promise.all(batch.map(async ({ seat, seq }) =>
      (await bucket.get(netplayRecordingKey(id, seat, seq)))?.json<RecordingBatch["events"]>()));
    for (const [index, events] of segments.entries()) {
      if (!events) return;
      const chunk = batch[index];
      if (chunk.seq === 0) {
        const value = getRecordedReplayStart(events);
        if (!value) return;
        const { seed, map, fighters, rounds, maniacSeed, rng } = value;
        if (start && (start.seed !== seed || start.map !== map || start.rounds !== rounds ||
            start.maniacSeed !== maniacSeed || start.rng !== rng || fighters.some((fighter, i) => fighter !== start!.fighters[i]))) return;
        start ??= { seed, map, fighters, rounds, maniacSeed, rng };
      }
      if (!includeFrames) continue;
      for (const [type, frame, mask] of events) {
        if (type !== "local" && type !== "remote") continue;
        if (typeof frame !== "number" || !Number.isInteger(frame) || frame < 1 ||
            typeof mask !== "number" || !Number.isInteger(mask) || mask < 0 || mask > 255) return;
        if (frame > terminal[0]) continue;
        const track = tracks[type === "local" ? chunk.seat - 1 : 2 - chunk.seat];
        const prior = track.get(frame);
        if (prior !== undefined && prior !== mask) return;
        track.set(frame, mask);
      }
    }
  }
  if (!start) return;
  const frames = [0];
  if (includeFrames) {
    for (let i = 1; i <= terminal[0]; ++i) {
      const a = tracks[0].get(i), b = tracks[1].get(i);
      if (a === undefined || b === undefined) return;
      frames.push(a | (b << 8));
    }
    const restored = await runtime.db.prepare(
      "SELECT variables_json FROM netplay_replay_recovery WHERE match_id=?",
    ).bind(id).first<string>("variables_json");
    if (restored) start.variables = JSON.parse(restored) as NonNullable<Start["variables"]>;
  }
  return { version: 1, start, frames: includeFrames ? frames : undefined };
}
