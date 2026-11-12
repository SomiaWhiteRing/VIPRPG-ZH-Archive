const prefix = "room:finish:";

export function createMatchFinish(send) {
  const starts = new Map();
  let active;

  const message = (seat, value) => send(seat, prefix + JSON.stringify(value));
  const restore = seat => {
    if (!active) return;
    const { match, seats, enabled, reports, decision } = active;
    if (!seats.includes(seat)) return;
    message(seat, { type: "ready", match, enabled });
    if (decision) message(seat, decision);
    else {
      const remote = reports.get(seats.find(peer => peer !== seat));
      if (remote) message(seat, remote);
    }
  };

  return {
    reset() {
      starts.clear();
      active = undefined;
    },
    restore,
    receive(seat, peers, text) {
      if (peers.length !== 2 || text.length > 1024) return;
      let data;
      try { data = JSON.parse(text.slice(prefix.length)); } catch { return; }
      const { type, match } = data ?? {};
      if (!Number.isSafeInteger(match) || match < 1 || match > 0x7fffffff) return;
      if (type === "start" && typeof data.enabled === "boolean") {
        if (active?.match === match) {
          restore(seat);
          return;
        }
        if (active?.enabled && !active.decision) return;
        starts.set(seat, data);
        if (!peers.every(peer => starts.get(peer)?.match === match)) return;
        active = { match, seats: peers, enabled: peers.every(peer => starts.get(peer).enabled),
          reports: new Map(), decision: undefined };
        for (const peer of peers) restore(peer);
        return;
      }
      if (!active?.enabled || active.match !== match || !active.seats.includes(seat)) return;
      if (active.decision) {
        message(seat, active.decision);
        return;
      }
      if (type === "abort") {
        active.decision = { type: "decision", match, status: -1, reason: "finish_timeout" };
      } else if (type === "terminal") {
        const { frame, first, second, inputs } = data;
        if (!Number.isSafeInteger(frame) || frame < 0 || frame > 0x7fffffff ||
            ![first, second].every(score => Number.isInteger(score) && score >= 0 && score <= 255) ||
            !Array.isArray(inputs) || inputs.length > Math.min(frame, 192) ||
            !inputs.every(input => Number.isInteger(input) && input >= 0 && input <= 255)) return;
        const report = { type, match, frame, first, second, inputs };
        if (!active.reports.has(seat)) active.reports.set(seat, report);
        const other = active.seats.find(peer => peer !== seat);
        message(other, active.reports.get(seat));
        if (active.reports.size === 2) {
          const [a, b] = active.reports.values();
          const agrees = a.frame === b.frame && a.first === b.first && a.second === b.second;
          active.decision = agrees ? { type: "decision", match, status: 1, frame: a.frame, first: a.first, second: a.second }
            : { type: "decision", match, status: -1, reason: "finish_mismatch" };
        }
      }
      if (active.decision) for (const peer of active.seats) message(peer, active.decision);
    },
  };
}
