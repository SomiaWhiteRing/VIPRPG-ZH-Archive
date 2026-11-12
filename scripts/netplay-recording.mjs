const prefix = "room:record:";

export function createMatchRecording() {
  let active;
  const seats = new WeakMap();
  return (text, participant, players, room, save, acknowledge) => {
    if (text.length > 48_000) return;
    let batch;
    try { batch = JSON.parse(text.slice(prefix.length)); } catch { return; }
    const { match, seq, events } = batch ?? {};
    if (!Number.isSafeInteger(match) || match <= 0 || match > 0x7fffffff ||
        !Number.isInteger(seq) || seq < 0 || seq >= 3600 ||
        !Array.isArray(events) || events.length === 0 || events.length > 256 ||
        !events.every(event => Array.isArray(event) &&
          ["start", "local", "remote", "checkpoint", "terminal", "result", "diagnostic", "cleanup", "end"].includes(event[0]))) return;

    let recording = seats.get(participant);
    if (recording?.key !== match) {
      if (seq !== 0 || events[0][0] !== "start" || players.length !== 2) return;
      if (active?.key !== match || !players.every((player, index) => active.players[index] === player)) {
        active = { id: crypto.randomUUID(), key: match, startedAt: Date.now(), players, room,
          participants: players.map(player => ({
            name: player.identity.name,
            userId: player.account?.userId ?? null,
            workId: player.account?.workId ?? null,
            archiveVersionId: player.account?.archiveVersionId ?? null,
          })) };
      }
      recording = { ...active, seat: players.indexOf(participant) + 1, inflight: new Set() };
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
}
