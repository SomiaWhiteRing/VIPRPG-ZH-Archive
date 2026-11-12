import type { RecordingBatch } from "../../../scripts/netplay-recording.mjs";

export function netplayRecordingKey(id: string, seat: number, seq: number) {
  return `netplay-recordings/v1/${id}/${seat}/${seq}.json`;
}

export async function saveNetplayRecording(env: CloudflareEnv, batch: RecordingBatch, initialize = true) {
  const { id, match, startedAt, participants, room, seat, seq, events } = batch;
  const object = netplayRecordingKey(id, seat, seq);
  const terminal = events.find(event => event[0] === "terminal");
  const end = events.find(event => event[0] === "end");
  await env.ARCHIVE_BUCKET.put(object, JSON.stringify(events), {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
  });
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
  ]);
}
