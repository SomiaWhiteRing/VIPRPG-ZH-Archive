const probe = { samples: 8, intervalMs: 100, durationMs: 1_800 };
const selectionTimeoutMs = 8_000;
const confirmationTimeoutMs = 1_000;
const mirrorConfirmationTimeoutMs = 3_000;
const directToleranceMs = 20;

export function isRouteProbe(packet, round) {
  return packet.length === 10 && (packet[0] === 128 || packet[0] === 129) &&
    packet[1] < probe.samples && packet.readDoubleLE(2) === round;
}

function readMeasurement(message) {
  const { rtts, longestGapMs } = message;
  const milliseconds = value => Number.isSafeInteger(value) && value >= 0 && value <= probe.durationMs;
  if (!Array.isArray(rtts) || rtts.length !== probe.samples ||
      !rtts.every(value => value === null || milliseconds(value)) || !milliseconds(longestGapMs)) return;
  const received = rtts.filter(value => value !== null).sort((a, b) => a - b);
  if (!received.length) return;
  return {
    missing: probe.samples - received.length,
    tailRttMs: received[Math.ceil(received.length * 0.9) - 1],
    medianRttMs: (received[Math.floor((received.length - 1) / 2)] + received[Math.floor(received.length / 2)]) / 2,
    longestGapMs,
  };
}

export function startRouteSelection({ round, seats, paths, send, commit, fail, inputMirror = false }) {
  const candidates = new Map(paths.map(path => [path, { ready: new Set(), reports: new Map() }]));
  const probeTimeoutMs = inputMirror ? 9_000 : selectionTimeoutMs - confirmationTimeoutMs;
  const timeoutMs = probeTimeoutMs + (inputMirror ? mirrorConfirmationTimeoutMs : confirmationTimeoutMs);
  const deadline = Date.now() + timeoutMs;
  let timer, selected, closed = false;
  const acknowledged = new Set();
  const sendToBoth = message => {
    for (const seat of seats) send(seat, { round, ...message });
  };
  const stop = () => {
    closed = true;
    clearTimeout(timer);
  };
  const measurements = () => [...candidates].map(([path, candidate]) => ({
    path,
    failed: Boolean(candidate.failed),
    ready: seats.map(seat => candidate.ready.has(seat)),
    measurements: seats.map(seat => candidate.reports.get(seat)),
  }));
  const choose = () => {
    clearTimeout(timer);
    const scores = [];
    for (const [path, candidate] of candidates) {
      const measures = [...candidate.reports.values()];
      if (candidate.failed || measures.length !== seats.length || measures.some(value => !value)) continue;
      const worst = field => Math.max(...measures.map(value => value[field]));
      scores.push({
        path, missing: worst("missing"), tailRttMs: worst("tailRttMs"),
        longestGapMs: worst("longestGapMs"), medianRttMs: worst("medianRttMs"),
      });
    }
    scores.sort((a, b) => a.missing - b.missing || a.tailRttMs - b.tailRttMs ||
      a.longestGapMs - b.longestGapMs || a.medianRttMs - b.medianRttMs);
    const fastest = scores[0];
    const direct = scores.find(score => score.path === "direct");
    selected = direct && direct.missing === fastest.missing &&
      direct.tailRttMs <= fastest.tailRttMs + directToleranceMs &&
      direct.longestGapMs <= fastest.longestGapMs + directToleranceMs ? direct.path : fastest?.path;
    const socket = candidates.get("websocket");
    const turn = candidates.get("turn");
    // Keep a healthy direct connection. When relaying, both open paths can deliver the same input.
    if (inputMirror && selected !== "direct" && !socket.failed && socket.ready.size === seats.length &&
      (!selected || !turn.failed && turn.ready.size === seats.length)) selected = "websocket";
    if (!selected || Date.now() >= deadline) {
      stop();
      fail(measurements());
      return;
    }
    acknowledged.clear();
    sendToBoth({ type: "select", path: selected });
    timer = setTimeout(() => {
      candidates.get(selected).failed = true;
      choose();
    }, inputMirror && selected === "websocket" ? deadline - Date.now() : Math.min(confirmationTimeoutMs, deadline - Date.now()));
  };
  const chooseWhenMeasured = () => {
    if (!selected && [...candidates.values()].every(candidate =>
      candidate.failed || candidate.reports.size === seats.length)) choose();
  };

  timer = setTimeout(choose, probeTimeoutMs);
  return {
    round,
    stop,
    acceptsSocketProbe(packet) {
      const socket = candidates.get("websocket");
      return !closed && !socket.failed && socket.probing && isRouteProbe(packet, round);
    },
    receive(seat, message) {
      if (closed || message?.round !== round) return;
      const { type, path } = message;
      const candidate = candidates.get(path);
      if (!candidate || candidate.failed) return;
      if (type === "signal" && path !== "websocket" && !selected &&
          message.value && typeof message.value === "object") {
        send(seats.find(peer => peer !== seat), message);
      } else if (type === "ready" && !candidate.probing && !selected) {
        candidate.ready.add(seat);
        if (candidate.ready.size === seats.length) {
          candidate.probing = true;
          sendToBoth({ type: "probe", path, ...probe });
        }
      } else if (type === "measurement" && candidate.probing && !selected && !candidate.reports.has(seat)) {
        const measurement = readMeasurement(message);
        if (measurement || inputMirror && path !== "direct") candidate.reports.set(seat, measurement);
        else candidate.failed = true;
        chooseWhenMeasured();
      } else if (type === "failed") {
        candidate.failed = true;
        if (selected === path) choose();
        else chooseWhenMeasured();
      } else if (type === "accept" && selected === path && Date.now() < deadline) {
        acknowledged.add(seat);
        if (acknowledged.size === seats.length) {
          stop();
          const turn = candidates.get("turn");
          const backup = inputMirror && path === "websocket" && !turn.failed && turn.ready.size === seats.length ? "turn" : undefined;
          commit(path, measurements(), backup);
        }
      }
    },
  };
}
