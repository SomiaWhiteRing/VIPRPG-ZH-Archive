import { isIP } from "node:net";

export const iceCandidateTypes = ["host", "srflx", "prflx", "relay"];
const phases = ["2s", "6s", "connected", "fallback", "failure", "discarded"];
const statuses = ["ok", "timeout", "peer_unavailable", "unsupported", "error"];
const iceStates = ["new", "checking", "connected", "completed", "failed", "disconnected", "closed"];
const protocols = ["udp", "tcp"];
const relayProtocols = [...protocols, "tls"];
const addressKinds = ["ipv4", "ipv6", "mdns", "unknown"];
const stunSchemes = ["stun", "stuns", "turn", "turns"];
const iceServers = ["cloudflare-stun", "nextcloud-stun", "hitv-stun", "cloudflare-turn", "hong-kong-turn"];

/** @typedef {Record<string, unknown>} Fields */

/** @param {unknown} value @returns {value is Fields} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {readonly string[]} choices */
function choice(value, choices) {
  return typeof value === "string" && choices.includes(value) ? value : undefined;
}

/** @param {unknown} value */
function integer(value, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : undefined;
}

/** @param {Fields} row @param {string[]} keys */
function counts(row, keys) {
  return Object.fromEntries(keys.map(key => [key, integer(row[key])]));
}

/** @param {unknown} value */
function flag(value) {
  return typeof value === "boolean" ? value : undefined;
}

/** @param {unknown} value */
function probeRtt(value) {
  return Array.isArray(value) ? value.slice(0, 2).map(ms => integer(ms, 10_000)).filter(ms => ms !== undefined) : undefined;
}

/** @param {unknown} value @param {number} limit */
function rows(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit).filter(isRecord) : [];
}

/** @param {unknown} value */
function address(value) {
  if (typeof value !== "string") return;
  // RTCIceCandidate can expose IPv6 literals with brackets; node:net expects the bare address.
  const ip = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return isIP(ip) ? ip : undefined;
}

/** @param {Fields} row */
function candidate(row) {
  const ip = address(row.address);
  return {
    type: choice(row.type, iceCandidateTypes), protocol: choice(row.protocol, protocols),
    addressKind: choice(row.addressKind, addressKinds), port: integer(row.port, 65535),
    address: ip,
    relatedAddress: address(row.relatedAddress),
    ipv6Scope: ip && isIP(ip) === 6 ? ip === "::1" ? "loopback"
      : /^fe[89ab]/i.test(ip) ? "link_local" : /^f[cd]/i.test(ip) ? "unique_local"
      : /^[23][0-9a-f]{3}:/i.test(ip) ? "global" : "other"
      : choice(row.ipv6Scope, ["global", "link_local", "unique_local", "loopback", "other"]),
    relatedAddressKind: choice(row.relatedAddressKind, addressKinds), relatedPort: integer(row.relatedPort, 65535),
    tcpType: choice(row.tcpType, ["active", "passive", "so"]),
    relayProtocol: choice(row.relayProtocol, relayProtocols),
    iceServer: choice(row.iceServer, iceServers),
    priority: integer(row.priority, 0xffffffff),
  };
}

/** @param {unknown} value */
function signals(value) {
  return rows(value, 32).map(row => ({
    ...candidate(row),
    elapsedMs: integer(row.elapsedMs),
    appliedMs: integer(row.appliedMs),
    rejected: flag(row.rejected),
  }));
}

/** @param {unknown} value */
function description(value) {
  if (!isRecord(value)) return;
  return {
    type: choice(value.type, ["offer", "answer", "pranswer", "rollback"]),
    applicationPort: integer(value.applicationPort, 65535),
    applicationProtocol: choice(value.applicationProtocol, ["UDP/DTLS/SCTP", "TCP/DTLS/SCTP", "DTLS/SCTP"]),
    setup: choice(value.setup, ["active", "passive", "actpass", "holdconn"]),
    fingerprintAlgorithm: choice(value.fingerprintAlgorithm, ["sha-1", "sha-224", "sha-256", "sha-384", "sha-512"]),
    sctpPort: integer(value.sctpPort, 65535),
    maxMessageSize: integer(value.maxMessageSize),
    trickle: flag(value.trickle),
    renomination: flag(value.renomination),
    iceLite: flag(value.iceLite),
    bundle: flag(value.bundle),
    endOfCandidates: flag(value.endOfCandidates),
    candidateCount: integer(value.candidateCount),
  };
}

// Keep candidate IPs for NAT/IPv6 diagnosis; exclude SDP, credentials and free-form error strings.
/** @param {unknown} payload */
export function parseIceStats(payload) {
  /** @type {unknown} */
  let value = payload;
  if (typeof payload === "string") {
    if (payload.length > 49_152) return;
    try {
      value = JSON.parse(payload);
    } catch {
      return;
    }
  }
  if (!isRecord(value)) return;
  const phase = choice(value.phase, phases);
  const status = choice(value.status, statuses);
  const negotiationStartedAt = integer(value.negotiationStartedAt);
  const elapsedMs = integer(value.elapsedMs);
  if (!phase || !status || negotiationStartedAt === undefined || elapsedMs === undefined) return;
  return {
    phase, status, negotiationStartedAt, elapsedMs,
    reason: typeof value.reason === "string" && /^[a-z_]{1,40}$/.test(value.reason) ? value.reason : undefined,
    milestones: rows(value.milestones, 32).filter(row =>
      typeof row.name === "string" && /^[a-z_]{1,40}$/.test(row.name)).map(row => ({
      name: row.name, elapsedMs: integer(row.elapsedMs),
    })),
    iceState: choice(value.iceState, iceStates),
    gatheringState: choice(value.gatheringState, ["new", "gathering", "complete"]),
    connectionState: choice(value.connectionState, ["new", "connecting", "connected", "disconnected", "failed", "closed"]),
    signalingState: choice(value.signalingState, ["stable", "have-local-offer", "have-remote-offer", "have-local-pranswer", "have-remote-pranswer", "closed"]),
    channelState: choice(value.channelState, ["connecting", "open", "closing", "closed"]),
    inputChannelState: choice(value.inputChannelState, ["connecting", "open", "closing", "closed"]),
    dtlsState: choice(value.dtlsState, ["new", "connecting", "connected", "closed", "failed"]),
    iceRole: choice(value.iceRole, ["unknown", "controlling", "controlled"]),
    localSdp: description(value.localSdp),
    remoteSdp: description(value.remoteSdp),
    relayProbeRttMs: probeRtt(value.relayProbeRttMs),
    socketProbeRttMs: probeRtt(value.socketProbeRttMs),
    ...counts(value, ["localCandidatesGathered", "remoteCandidatesReceived", "remoteCandidatesApplied", "candidateCount", "pairCount"]),
    stunErrors: rows(value.stunErrors, 32).map(row => ({
      code: integer(row.code, 999), count: integer(row.count), scheme: choice(row.scheme, stunSchemes),
      addressKind: choice(row.addressKind, addressKinds), port: integer(row.port, 65535),
      address: address(row.address),
      iceServer: choice(row.iceServer, iceServers),
    })),
    localSignals: signals(value.localSignals),
    remoteSignals: signals(value.remoteSignals),
    candidates: rows(value.candidates, 72).map(row => ({
      ...candidate(row),
      number: integer(row.number), side: choice(row.side, ["local", "remote"]),
    })),
    pairs: rows(value.pairs, 32).map(row => ({
      state: choice(row.state, ["frozen", "waiting", "in-progress", "failed", "succeeded"]),
      nominated: flag(row.nominated), selected: flag(row.selected),
      ...counts(row, [
        "local", "remote", "requestsSent", "requestsReceived", "responsesSent", "responsesReceived",
        "consentRequestsSent", "bytesSent", "bytesReceived", "packetsSent", "packetsReceived", "roundTripMs",
      ]),
    })),
  };
}
