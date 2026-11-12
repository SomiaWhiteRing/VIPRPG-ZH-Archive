import { createHmac, timingSafeEqual } from "node:crypto";

const prefix = "room:record:";
const matchKey = match => Number.isInteger(match) && match > 0 && match <= 0x7fffffff;

export function validRecordingEvents(seq, events, limit) {
  return Number.isInteger(seq) && seq >= 0 && seq < 3600 &&
    Array.isArray(events) && events.length > 0 && events.length <= limit &&
    events.every(event => Array.isArray(event) &&
      ["start", "local", "remote", "checkpoint", "terminal", "result", "diagnostic", "cleanup", "end"].includes(event[0]));
}

function signGrant(payload, key) {
  return createHmac("sha256", key).update("netplay-recording/v2\n").update(payload).digest();
}

export function readRecordingGrant(token, key) {
  if (!key || !token || token.length > 4096 || !/^[\w-]+\.[0-9a-f]{64}$/.test(token)) return;
  const [payload, signature] = token.split(".");
  if (!timingSafeEqual(Buffer.from(signature, "hex"), signGrant(payload, key))) return;
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

export function createMatchRecording() {
  let active;
  const seats = new WeakMap();
  const open = (match, participant, players, room) => {
    if (!matchKey(match) || players.length !== 2 || !players.includes(participant)) return;
    if (active?.key !== match || !players.every((player, index) => active.players[index] === player)) {
      active = { id: crypto.randomUUID(), key: match, startedAt: Date.now(), players, room,
        participants: players.map(player => ({
          name: player.identity.name,
          userId: player.account?.userId ?? null,
          workId: player.account?.workId ?? null,
          archiveVersionId: player.account?.archiveVersionId ?? null,
        })) };
    }
    return { ...active, seat: players.indexOf(participant) + 1 };
  };
  const receive = (text, participant, players, room, save, acknowledge) => {
    if (text.length > 48_000) return;
    let batch;
    try { batch = JSON.parse(text.slice(prefix.length)); } catch { return; }
    const { match, seq, events } = batch ?? {};
    if (!validRecordingEvents(seq, events, 256)) return;

    let recording = seats.get(participant);
    if (recording?.key !== match) {
      if (seq !== 0 || events[0][0] !== "start") return;
      const matchRecord = open(match, participant, players, room);
      if (!matchRecord) return;
      recording = { ...matchRecord, inflight: new Set() };
      seats.set(participant, recording);
    }
    if (recording.inflight.has(seq)) return;
    recording.inflight.add(seq);
    const { id, startedAt, participants, seat } = recording;
    const write = save({ id, match, startedAt, participants, room: recording.room, seat, seq, events })
      .then(() => acknowledge(`room:record:ack:${match}:${seq}`))
      .catch(error => console.error("netplay_recording_write", id, seat, seq, error.message))
      .finally(() => recording.inflight.delete(seq));
    return write;
  };
  return {
    receive,
    grant(match, participant, players, room, signingKey) {
      const previous = active;
      const record = open(match, participant, players, room);
      if (!record) return;
      const { id, startedAt, participants, room: details, seat } = record;
      if (previous !== active) console.log(JSON.stringify({ event: "netplay_recording_start", matchId: id, ...details }));
      const payload = Buffer.from(JSON.stringify({ id, match, startedAt, participants, room: details, seat })).toString("base64url");
      return `room:record:grant:${match}:${payload}.${signGrant(payload, signingKey).toString("hex")}`;
    },
  };
}
