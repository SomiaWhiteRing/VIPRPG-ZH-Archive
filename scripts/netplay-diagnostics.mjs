const prefix = "room:diagnostic:";
const kinds = new Set(["start", "wait_start", "wait_end", "sample", "runtime_gap", "lifecycle", "end", "input_failure"]);
const numbers = new Set([
  "v", "sequence", "atMs", "match", "matchStartedAtMs", "frame", "confirmedFrame", "receivedFrame",
  "waiting", "presentationQueue", "peerReady", "replayFrame", "visible", "focused", "paused",
  "waitCount", "waitTotalMs", "waitMaxMs", "workerGapMs", "gameTickGapMs", "hostGapMs", "gameTickAgeMs", "hostAgeMs",
  "waitId", "waitStartedAtMs", "durationMs", "waitFrame", "droppedEvents",
  "peerRttMs", "socketState", "socketBufferedBytes", "queuedFrames", "deliveredInputs", "rtcStatsAgeMs",
  "inputSentPackets", "inputReceivedPackets", "inputRepeatedFrames", "inputPending", "inputIncoming",
  "inputAcknowledged", "inputReceivedThrough", "inputDelivered", "inputLocalNext", "inputPacketAgeMs", "inputAckAgeMs",
  "rtcBufferedBytes", "rtcInputBufferedBytes", "rtcInputPendingBytes", "rtcInputPacketsSent",
  "rtcInputPacketsReceived", "rtcInputReplacements",
]);

/** @param {string} message */
export function parseNetplayDiagnostic(message) {
  if (!message.startsWith(prefix) || message.length > 4096) return;
  let value;
  try { value = JSON.parse(message.slice(prefix.length)); } catch { return; }
  if (!value || value.v !== 1 || !kinds.has(value.kind) || !Number.isSafeInteger(value.match) || value.match < 1 ||
      !Number.isSafeInteger(value.atMs) || !Number.isSafeInteger(value.sequence)) return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "kind") continue;
    if (key === "reason" && typeof item === "string" && /^[a-z_]{1,40}$/.test(item)) continue;
    if (key === "client" && typeof item === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(item)) continue;
    if (!numbers.has(key) || typeof item !== "number" || !Number.isSafeInteger(item) || item < -1) return;
  }
  return value;
}
