import type { RecordingBatch } from "../../../scripts/netplay-recording.mjs";

export function netplayRecordingKey(id: string, seat: number, seq: number) {
  return `netplay-recordings/v1/${id}/${seat}/${seq}.json`;
}

export function getRecordedReplayStart(events: RecordingBatch["events"]) {
  const start = events.find(event => event[0] === "start")?.[1] as {
    seed: number; map: number; fighters: [number, number]; rounds: number; maniacSeed: number; rng: string; blind?: unknown;
  } | undefined;
  if (!start || !Number.isInteger(start.seed) || !Number.isInteger(start.map) ||
      !Array.isArray(start.fighters) || start.fighters.length !== 2 || !start.fighters.every(Number.isInteger) ||
      !Number.isInteger(start.rounds) || !Number.isInteger(start.maniacSeed) || typeof start.rng !== "string") return;
  const { seed, map, fighters, rounds, maniacSeed, rng } = start;
  return { seed, map, fighters, rounds, maniacSeed, rng, blind: typeof start.blind === "boolean" ? start.blind : undefined };
}

export async function saveNetplayRecording(env: CloudflareEnv, batch: RecordingBatch, initialize = true) {
  const { id, match, startedAt, participants, room, seat, seq, events } = batch;
  const object = netplayRecordingKey(id, seat, seq);
  const stored = await env.ARCHIVE_BUCKET.put(object, JSON.stringify(events), {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
  });
  const indexedEvents = stored ? events : await (await env.ARCHIVE_BUCKET.get(object))?.json<RecordingBatch["events"]>();
  if (!indexedEvents) throw new Error("Recording segment is unavailable");
  const terminal = indexedEvents.find(event => event[0] === "terminal");
  const end = indexedEvents.find(event => event[0] === "end");
  const chunk = env.DB.prepare("INSERT OR IGNORE INTO netplay_match_chunks VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, seat, seq, terminal ? JSON.stringify(terminal.slice(1, 4)) : null,
      typeof end?.[1] === "string" ? end[1].slice(0, 48) : null, Date.now());
  if (!initialize) {
    await chunk.run();
    return;
  }
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO netplay_matches VALUES (?, ?, ?, ?)")
      .bind(id, match, startedAt, JSON.stringify(room)),
    ...participants.map(({ userId, name, workId, archiveVersionId }, index) => env.DB.prepare(
      `INSERT OR IGNORE INTO netplay_match_seats VALUES (?, ?, (SELECT id FROM users WHERE id = ?), ?, ?, ?)`,
    ).bind(id, index + 1, userId, name, workId, archiveVersionId)),
    chunk,
    ...(seq === 0 ? [env.DB.prepare("INSERT OR IGNORE INTO netplay_replay_recording_start VALUES (?, ?, ?)")
      .bind(id, seat, JSON.stringify(getRecordedReplayStart(indexedEvents) ?? null))] : []),
  ]);
}
