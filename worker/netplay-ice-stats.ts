export const iceCandidateTypes = ["host", "srflx", "prflx", "relay"] as const;
const phases = ["2s", "6s", "connected", "fallback", "failure"];
const statuses = ["ok", "timeout", "peer_unavailable", "unsupported", "error"];
const iceStates = ["new", "checking", "connected", "completed", "failed", "disconnected", "closed"];
const protocols = ["udp", "tcp"];
const relayProtocols = [...protocols, "tls"];
const addressKinds = ["ipv4", "ipv6", "mdns", "unknown"];
const stunSchemes = ["stun", "stuns", "turn", "turns"];

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function choice(value: unknown, choices: readonly string[]) {
  return typeof value === "string" && choices.includes(value) ? value : undefined;
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : undefined;
}

function counts(row: Fields, keys: string[]) {
  return Object.fromEntries(keys.map(key => [key, integer(row[key])]));
}

function flag(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function rows(value: unknown, limit: number) {
  return Array.isArray(value) ? value.slice(0, limit).filter(isRecord) : [];
}

function candidate(row: Fields) {
  return {
    type: choice(row.type, iceCandidateTypes), protocol: choice(row.protocol, protocols),
    addressKind: choice(row.addressKind, addressKinds), port: integer(row.port, 65535),
    relatedAddressKind: choice(row.relatedAddressKind, addressKinds), relatedPort: integer(row.relatedPort, 65535),
    tcpType: choice(row.tcpType, ["active", "passive", "so"]),
    relayProtocol: choice(row.relayProtocol, relayProtocols),
    priority: integer(row.priority, 0xffffffff),
  };
}

function signals(value: unknown) {
  return rows(value, 32).map(row => ({
    ...candidate(row),
    elapsedMs: integer(row.elapsedMs),
    appliedMs: integer(row.appliedMs),
    rejected: flag(row.rejected),
  }));
}

function description(value: unknown) {
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

// Rebuild the log from allowed fields. Browser-supplied addresses, SDP and error strings stay out of telemetry.
export function parseIceStats(payload: string) {
  if (payload.length > 49_152) return;
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return;
  }
  if (!isRecord(value)) return;
  const phase = choice(value.phase, phases);
  const status = choice(value.status, statuses);
  const negotiationStartedAt = integer(value.negotiationStartedAt);
  const elapsedMs = integer(value.elapsedMs);
  if (!phase || !status || negotiationStartedAt === undefined || elapsedMs === undefined) return;
  return {
    phase, status, negotiationStartedAt, elapsedMs,
    iceState: choice(value.iceState, iceStates),
    gatheringState: choice(value.gatheringState, ["new", "gathering", "complete"]),
    connectionState: choice(value.connectionState, ["new", "connecting", "connected", "disconnected", "failed", "closed"]),
    signalingState: choice(value.signalingState, ["stable", "have-local-offer", "have-remote-offer", "have-local-pranswer", "have-remote-pranswer", "closed"]),
    channelState: choice(value.channelState, ["connecting", "open", "closing", "closed"]),
    dtlsState: choice(value.dtlsState, ["new", "connecting", "connected", "closed", "failed"]),
    iceRole: choice(value.iceRole, ["unknown", "controlling", "controlled"]),
    localSdp: description(value.localSdp),
    remoteSdp: description(value.remoteSdp),
    ...counts(value, ["localCandidatesGathered", "remoteCandidatesReceived", "remoteCandidatesApplied", "candidateCount", "pairCount"]),
    stunErrors: rows(value.stunErrors, 32).map(row => ({
      code: integer(row.code, 999), count: integer(row.count), scheme: choice(row.scheme, stunSchemes),
      addressKind: choice(row.addressKind, addressKinds), port: integer(row.port, 65535),
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
