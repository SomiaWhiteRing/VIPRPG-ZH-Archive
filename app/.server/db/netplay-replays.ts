import { getRecordedReplayStart, netplayRecordingKey } from "@/app/.server/db/netplay-recordings";
import { indexNetplayReplay } from "@/app/.server/db/netplay-replay-index";
import type { AppRuntime } from "@/app/.server/runtime";
import { getUserAvatarSrc } from "@/lib/user-profile";
import type { RecordingBatch } from "../../../scripts/netplay-recording.mjs";

export const REPLAY_PAGE_SIZE = 5;

type ReplayRow = {
  id: string; started_at: number; favorite: number;
  first_user_id: number | null; second_user_id: number | null;
  first_name: string; first_avatar: string | null; first_archive: number | null;
  second_name: string; second_avatar: string | null; second_archive: number | null;
  viewer_seat: 1 | 2 | null;
  terminal: string; start_json: string | null; revision: string;
};

const SELECT = `
  SELECT m.match_id AS id,m.started_at,m.terminal_json AS terminal,m.start_json,m.revision,
    (f.match_id IS NOT NULL) AS favorite,
    a.user_id AS first_user_id,b.user_id AS second_user_id,
    a.display_name AS first_name,ua.avatar_blob_sha256 AS first_avatar,a.archive_version_id AS first_archive,
    b.display_name AS second_name,ub.avatar_blob_sha256 AS second_avatar,b.archive_version_id AS second_archive,
    CASE WHEN a.user_id=?1 THEN 1 WHEN b.user_id=?1 THEN 2 END AS viewer_seat
  FROM netplay_replay_catalog m
  JOIN netplay_match_seats a ON a.match_id=m.match_id AND a.seat=1
  JOIN netplay_match_seats b ON b.match_id=m.match_id AND b.seat=2
  LEFT JOIN users ua ON ua.id=a.user_id
  LEFT JOIN users ub ON ub.id=b.user_id
  LEFT JOIN netplay_replay_favorites f ON f.user_id=?1 AND f.match_id=m.match_id
  WHERE (?2 IS NULL OR EXISTS (SELECT 1 FROM netplay_match_seats seat JOIN works w ON w.id=seat.work_id
    WHERE seat.match_id=m.match_id AND w.netplay_space_id=?2))
    AND NOT EXISTS (SELECT 1 FROM netplay_replay_recovery r WHERE r.match_id=m.match_id AND r.variables_json IS NULL)
`;

function replaySummary(row: ReplayRow, language: string) {
  const terminal = JSON.parse(row.terminal) as unknown;
  if (!Array.isArray(terminal) || terminal.length !== 3 || !terminal.every(Number.isSafeInteger) ||
      terminal[0] < 1 || terminal[0] > 216000 || terminal[1] < 0 || terminal[2] < 0) return null;
  const start = row.start_json ? JSON.parse(row.start_json) as Start : undefined;
  const displayName = (name: string, userId: number | null) =>
    language === "ja" && userId === null ? name.replace(/^访客 ([0-9a-f]{4})$/, "ゲスト $1") : name;
  return {
    id: row.id, startedAt: row.started_at, favorite: !!row.favorite,
    players: [
      { name: displayName(row.first_name, row.first_user_id), avatar: getUserAvatarSrc(row.first_avatar) },
      { name: displayName(row.second_name, row.second_user_id), avatar: getUserAvatarSrc(row.second_avatar) },
    ],
    terminal: terminal as [number, number, number],
    viewerSeat: row.viewer_seat,
    fighters: start?.fighters ?? null,
    start, revision: row.revision,
    archives: [row.first_archive, row.second_archive],
  };
}

export async function listNetplayReplays(
  runtime: AppRuntime, userId: number | null, space: number | null, page: number, favorites: boolean, scope: "mine" | "all",
  language: string, pageCount = 1, snapshot: number | null = null,
) {
  const filtered = `${SELECT} AND (?3=0 OR f.match_id IS NOT NULL) AND (?4=0 OR a.user_id=?1 OR b.user_id=?1)
    AND m.serial<=COALESCE(?5,(SELECT MAX(serial) FROM netplay_replay_catalog))`;
  const { results } = await runtime.db.prepare(`SELECT *, COUNT(*) OVER () AS total,
    COALESCE(?5,(SELECT MAX(serial) FROM netplay_replay_catalog)) AS snapshot FROM (${filtered})
    ORDER BY started_at DESC,id DESC LIMIT ?6 OFFSET ?7`)
    .bind(userId, space, Number(favorites), Number(!favorites && scope === "mine"), snapshot,
      REPLAY_PAGE_SIZE * pageCount, page * REPLAY_PAGE_SIZE)
    .all<ReplayRow & { total: number; snapshot: number }>();
  const pages = Math.ceil((results[0]?.total ?? 0) / REPLAY_PAGE_SIZE);
  const entries = await Promise.all(results.map(async row => {
    const entry = replaySummary(row, language);
    if (entry && !entry.start) {
      const replay = await readNetplayReplay(runtime, entry.id, entry.terminal, false);
      if (replay) {
        entry.start = replay.start;
        entry.fighters = replay.start.fighters;
      }
    }
    return entry;
  }));
  return { entries: entries.filter(Boolean), more: page + 1 < pages, pages, snapshot: results[0]?.snapshot ?? snapshot ?? 0 };
}

export async function getNetplayReplay(runtime: AppRuntime, userId: number | null, space: number | null, id: string, language: string) {
  const row = await runtime.db.prepare(`${SELECT} AND m.match_id=?3`).bind(userId, space, id).first<ReplayRow>();
  return row ? replaySummary(row, language) : null;
}

export async function setNetplayReplayFavorite(runtime: AppRuntime, userId: number, id: string, favorite: boolean) {
  await runtime.db.prepare(favorite
    ? "INSERT OR IGNORE INTO netplay_replay_favorites(user_id,match_id) VALUES (?,?)"
    : "DELETE FROM netplay_replay_favorites WHERE user_id=? AND match_id=?").bind(userId, id).run();
}

type Start = NonNullable<ReturnType<typeof getRecordedReplayStart>> & {
  variables?: [number, number][];
};
type ReplayStorage = Pick<AppRuntime, "db" | "env">;

export async function readNetplayReplay(runtime: ReplayStorage, id: string, terminal: [number, number, number], includeFrames: boolean, revision?: string) {
  const bucket = runtime.env.ARCHIVE_BUCKET;
  const object = revision ? `netplay-replays/v1/${id}/${revision}.json` : null;
  if (includeFrames && object) {
    const prepared = await bucket.get(object);
    if (prepared) return prepared.json<{ version: number; start: Start; frames: number[] }>();
  }
  const { results } = await runtime.db.prepare("SELECT seat,seq FROM netplay_match_chunks WHERE match_id=? ORDER BY seat,seq")
    .bind(id).all<{ seat: number; seq: number }>();
  const tracks = [new Map<number, number>(), new Map<number, number>()];
  let start: Start | undefined;
  let blind: boolean | undefined;
  let blindConflict = false;
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
        start ??= { seed, map, fighters, rounds, maniacSeed, rng, blind: undefined };
        if (value.blind !== undefined) {
          blindConflict ||= blind !== undefined && blind !== value.blind;
          blind = value.blind;
        }
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
  if (!blindConflict) start.blind = blind;
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
  if (includeFrames && object) {
    await bucket.put(object, JSON.stringify({ version: 1, start, frames }), {
      httpMetadata: { contentType: "application/json" },
    });
  }
  await runtime.db.prepare("UPDATE netplay_replay_catalog SET start_json=? WHERE match_id=? AND start_json IS NULL")
    .bind(JSON.stringify({ ...start, variables: undefined }), id).run();
  return { version: 1, start, frames: includeFrames ? frames : undefined };
}

export async function prepareNetplayReplay(
  runtime: ReplayStorage & { execution: Pick<AppRuntime["execution"], "waitUntil"> }, id: string,
) {
  const replay = await indexNetplayReplay(runtime, id);
  if (replay) runtime.execution.waitUntil(
    readNetplayReplay(runtime, id, JSON.parse(replay.terminal_json), true, replay.revision)
      .catch(error => console.error("netplay_replay_prepare_failed", id, error)),
  );
}
