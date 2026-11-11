import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, STATUS_CODES } from "node:http";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { startRouteSelection } from "./netplay-route-selection.mjs";
import { parseNetplayDiagnostic } from "./netplay-diagnostics.mjs";
import { createRoomPassword, parseJoinPassword, parseRoomPassword } from "./netplay-room-password.mjs";

const { WebSocket, WebSocketServer } = createRequire(import.meta.url)("ws");
const origin = process.env.NETPLAY_SITE_ORIGIN ?? "https://staging.viprpg.org";
const turnHost = process.env.NETPLAY_TURN_HOST ?? "netplay-hk-staging.viprpg.org";
const defaultAvatar = "/icon/alex.png";
const archiveVersionId = Number(process.env.NETPLAY_ARCHIVE_VERSION);
const identityKey = process.env.NETPLAY_HK_IDENTITY_KEY;
const turnKey = process.env.NETPLAY_HK_TURN_SECRET;
const port = Number(process.env.NETPLAY_PORT ?? 8787);
if (!Number.isSafeInteger(archiveVersionId) || archiveVersionId < 1) {
  throw new Error("Set NETPLAY_ARCHIVE_VERSION to the current archive version");
}

const relay = { rooms: new Map(), directory: new Map() };
const direct = { rooms: new Map(), directory: new Map() };
const turn = { rooms: new Map(), directory: new Map(), turnPort: 3478 };
const turn443 = { rooms: new Map(), directory: new Map(), turnPort: 443 };
const auto = { rooms: new Map(), directory: new Map() };
const pools = { direct, turn, turn443, auto };
const wss = new WebSocketServer({ noServer: true, maxPayload: 64, perMessageDeflate: false });
const rtcWss = new WebSocketServer({ noServer: true, maxPayload: 50_000, perMessageDeflate: false });
const heartbeatIntervalMs = 5_000;
const heartbeatHideMs = 10_000;
const heartbeatTimeoutMs = 15_000;
const iceServers = [{ urls: ["stun:stun.hitv.com:3478", "stun:stun.cloudflare.com:3478", "stun:stun.nextcloud.com:443"] }];

function route(request) {
  if (!URL.canParse(request.url, origin)) return;
  const url = new URL(request.url, origin);
  const match = /^\/api\/netplay\/v1\/([1-9]\d*)\/(?:(direct|turn|turn443|auto)\/)?(?:identity\/([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\/)?(?:rtc\/)?(rooms|[1-9]\d{0,5})$/.exec(url.pathname);
  if (Number(match?.[1]) !== archiveVersionId) return;
  const [, , modePool, payload, signature, target] = match;
  const pool = pools[modePool] ?? relay;
  if (pool.turnPort && !turnKey) return;
  const guest = url.searchParams.get("guest");
  const guestId = /^[0-9a-f]{4}$/.test(guest ?? "") ? guest : randomBytes(2).toString("hex");
  let identity = {
    name: "访客 " + guestId,
    avatar: defaultAvatar,
  };
  if (payload) {
    if (!identityKey) return;
    const actual = Buffer.from(signature, "base64url");
    const expected = createHmac("sha256", identityKey).update(payload).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return;
    const [expires, archive, name, avatar] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (archive !== archiveVersionId || expires <= Date.now()) return;
    identity = { name, avatar };
  }
  const agent = request.headers["user-agent"] ?? "";
  return {
    directory: target === "rooms",
    roomId: Number(target),
    mode: url.searchParams.get("mode"),
    roomAccess: url.searchParams.get("roomAccess") === "1",
    pool,
    rtc: url.searchParams.get("rtcResume") === "1",
    routeSelection: url.searchParams.get("routeSelection") === "1",
    inputStats: url.searchParams.get("inputStats") === "1",
    inputProtocol: url.searchParams.get("inputProtocol") === "1" ? 1 : 0,
    diagnostics: url.searchParams.get("diagnostics") === "1",
    platform: /Android/i.test(agent) ? "android" : /Windows/i.test(agent) ? "windows" : /iPhone|iPad/i.test(agent) ? "ios" : "other",
    resume: url.searchParams.get("resume"),
    identity: payload ? identity : { ...identity, guest: guestId },
  };
}

function isStale(room) {
  return room.route !== "webrtc" && [...room.seats].some(seat =>
    seat.socket?.readyState !== WebSocket.OPEN || Date.now() - seat.lastPong >= heartbeatHideMs);
}

function listRooms({ rooms }) {
  return [...rooms].filter(([, room]) => !isStale(room))
    .map(([id, room]) => ({ id, players: [...room.seats].map(seat => seat.identity), locked: room.password.enabled }));
}

function send(socket, data) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(data);
}

function sendRoute(seat, message) {
  send(seat.socket, "route:" + JSON.stringify(message));
}

function sendRoomSettings(room) {
  const settings = "room:settings:" + JSON.stringify(room.password);
  for (const seat of room.seats) if (seat.roomAccess) send(seat.socket, settings);
}

function turnIceServers(roomId, index, turnPort, startedAt) {
  const username = `${Math.floor(startedAt / 1000) + 7200}:gyokuro-${roomId}-${index + 1}-${randomBytes(6).toString("hex")}`;
  return [{
    urls: [
      `turn:${turnHost}:${turnPort}?transport=udp`,
      `turn:[2001:df1:7880:6::953]:${turnPort}?transport=udp`,
    ],
    username, credential: createHmac("sha1", turnKey).update(username).digest("base64"),
  }];
}

function publishDirectory(pool) {
  const { directory } = pool;
  const rooms = listRooms(pool);
  for (const [socket, identity] of directory) {
    send(socket, JSON.stringify({ rooms, identity, online: directory.size }));
  }
}

function watchDirectory(socket, { pool, identity }) {
  const { directory } = pool;
  directory.set(socket, identity);
  socket.on("message", (data, binary) => {
    if (!binary && data.toString() === "directory:ping") send(socket, "directory:pong");
  });
  socket.on("close", () => {
    directory.delete(socket);
    publishDirectory(pool);
  });
  publishDirectory(pool);
}

function selectRoute(room, route, reason, choice) {
  if (room.seats.size !== 2) return;
  clearTimeout(room.negotiation?.timer);
  room.route = route;
  room.activeSelection = choice && { round: choice.round, path: choice.path };
  const seats = [...room.seats];
  const details = room.negotiation && {
    negotiationStartedAt: room.negotiation.startedAt,
    negotiationMs: Date.now() - room.negotiation.startedAt,
    seats: seats.map(seat => ({ platform: seat.platform, signals: seat.signals, milestones: seat.milestones })),
  };
  const turnPort = choice?.path === "turn" ? 443 : room.pool.turnPort;
  const connected = route === "webrtc";
  const loggedRoute = turnPort ? "hong_kong_turn_udp" : route;
  console.log(JSON.stringify({ event: "netplay_route", archiveVersionId, roomId: room.id,
    route: loggedRoute, reason, inputProtocol: connected ? room.inputProtocol : 0,
    ...(turnPort && { connected, turnPort }), ...details, ...choice }));
  if (room.pool.turnPort && !connected) {
    leave(room, seats[1], "turn_unavailable");
    return;
  }
  for (const [index, seat] of seats.entries()) {
    if (connected) {
      clearTimeout(seat.hide);
      clearTimeout(seat.expire);
      seat.resumeToken = randomBytes(24).toString("base64url");
      send(seat.socket, "room:resume:" + seat.resumeToken);
    }
    if (choice) sendRoute(seat, { type: "commit", ...room.activeSelection });
    else send(seat.socket, connected ? "rtc:webrtc" : "rtc:websocket");
    send(seat.socket, String(3 + index));
  }
}

function leave(room, seat, reason, closeCode) {
  if (!room.seats.has(seat)) return;
  const heartbeat = [...room.seats].map(({ rttMs, peakRttMs }) => ({ rttMs, peakRttMs }));
  const input = [...room.seats].map(player => player.input);
  const route = room.route;
  const turnPort = room.activeSelection?.path === "turn" ? 443 : room.pool.turnPort;
  const leaving = reason === "rtc_failed" ? [...room.seats] : [seat];
  for (const player of leaving) {
    clearInterval(player.ping);
    clearTimeout(player.hide);
    clearTimeout(player.expire);
    room.seats.delete(player);
    player.socket?.close(1000);
  }
  clearTimeout(room.negotiation?.timer);
  room.selection?.stop();
  room.selection = room.activeSelection = undefined;
  room.ready = room.negotiation = room.route = undefined;
  const remaining = room.seats.values().next().value;
  if (remaining?.socket) {
    remaining.resumeToken = undefined;
    if (route === "webrtc") renewHeartbeat(room, remaining);
    send(remaining.socket, "2");
  } else {
    clearTimeout(remaining?.expire);
    room.seats.clear();
    room.pool.rooms.delete(room.id);
  }
  console.log(JSON.stringify({ event: "netplay_departure", archiveVersionId, roomId: room.id,
    route: turnPort ? "hong_kong_turn_udp" : route, turnPort, reason, closeCode,
    remaining: remaining?.socket ? room.seats.size : 0, forwarded: room.forwarded, heartbeat, input }));
  publishDirectory(room.pool);
}

function renewHeartbeat(room, seat) {
  clearTimeout(seat.hide);
  clearTimeout(seat.expire);
  seat.lastPong = Date.now();
  if (room.route === "webrtc") return;
  seat.hide = setTimeout(() => publishDirectory(room.pool), heartbeatHideMs);
  seat.expire = setTimeout(() => {
    const socket = seat.socket;
    leave(room, seat, "heartbeat_timeout");
    socket?.terminate();
  }, heartbeatTimeoutMs);
}

function receiveText(room, seat, data) {
  if (data.startsWith("room:password:")) {
    if ([...room.seats][0] !== seat) return;
    const password = parseRoomPassword(data.slice(14));
    if (!password) return;
    room.password = password;
    sendRoomSettings(room);
    publishDirectory(room.pool);
    return;
  }
  if (seat.diagnostics && data.startsWith("room:diagnostic:")) {
    const diagnostic = parseNetplayDiagnostic(data);
    const turnPort = room.activeSelection?.path === "turn" ? 443 : room.pool.turnPort;
    if (diagnostic) console.log(JSON.stringify({
      ...diagnostic, event: "netplay_stall", archiveVersionId, roomId: room.id,
      seat: seat.seatNumber, platform: seat.platform,
      route: turnPort ? "hong_kong_turn_udp" : room.route,
      path: room.activeSelection?.path, inputProtocol: room.route === "webrtc" ? room.inputProtocol ?? 0 : 0,
    }));
    return;
  }
  if (data === "room:pong") {
    if (room.route !== "webrtc" && Date.now() - seat.lastPong >= heartbeatTimeoutMs) {
      leave(room, seat, "heartbeat_timeout");
      return;
    }
    if (seat.pingAt) {
      seat.rttMs = Math.round(performance.now() - seat.pingAt);
      seat.peakRttMs = Math.max(seat.peakRttMs ?? 0, seat.rttMs);
      seat.pingAt = 0;
    }
    const hidden = isStale(room);
    renewHeartbeat(room, seat);
    if (hidden) publishDirectory(room.pool);
    return;
  }
  if (seat.inputStats && room.seats.size === 2) {
    const input = /^room:input:(\d{1,9}):(\d{1,9}):(?:\d{1,9}:)?(-1|\d{1,9})$/.exec(data);
    if (input) {
      const [received, peakReceiveGapMs, peerRttMs] = input.slice(1).map(Number);
      seat.input = { received, peakReceiveGapMs, peerRttMs };
      return;
    }
  }

  if (room.selection && data.startsWith("route:")) {
    let message;
    try {
      message = JSON.parse(data.slice(6));
    } catch {
      return;
    }
    const active = room.activeSelection;
    if (room.route === "pending" && Buffer.byteLength(data) <= 24_576) room.selection.receive(seat, message);
    else if (active && message?.round === active.round && message.path === active.path) {
      if (message.type === "failed") leave(room, seat, "rtc_failed");
      else if (message.type === "ice-pair") {
        const pair = /^(host|srflx|prflx|relay):(host|srflx|prflx|relay):(udp|tcp)$/.exec(message.value);
        if (pair) {
          const [, localCandidateType, remoteCandidateType, protocol] = pair;
          console.log(JSON.stringify({ event: "netplay_ice_pair", archiveVersionId, roomId: room.id,
            seat: [...room.seats].indexOf(seat) + 1, path: active.path, localCandidateType, remoteCandidateType, protocol }));
        }
      }
    }
    return;
  }

  const rtc = room.negotiation;
  if (!rtc) return;
  if (data.startsWith("rtc:ice-stats:")) {
    let snapshot;
    try {
      snapshot = JSON.parse(data.slice("rtc:ice-stats:".length));
    } catch {
      return;
    }
    const phase = snapshot?.phase;
    const expectedRoute = phase === "connected" ? "webrtc" : phase === "fallback" ? "hong_kong_websocket" : undefined;
    if (!expectedRoute || room.route !== expectedRoute || snapshot?.negotiationStartedAt !== rtc.startedAt || seat.iceStatsPhase === phase) return;
    seat.iceStatsPhase = phase;
    const counts = ["localCandidatesGathered", "remoteCandidatesReceived", "remoteCandidatesApplied", "candidateCount", "pairCount"];
    const checks = ["local", "remote", "requestsSent", "requestsReceived", "responsesSent", "responsesReceived", "roundTripMs"];
    const pairs = Array.isArray(snapshot.pairs) ? snapshot.pairs.slice(0, 32).filter(Boolean).map(pair => ({
      selected: pair.selected === true,
      ...Object.fromEntries(checks.filter(key => Number.isSafeInteger(pair[key])).map(key => [key, pair[key]])),
    })) : [];
    const selected = pairs.find(pair => pair.selected);
    const candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
    const local = selected && candidates.find(candidate => candidate?.number === selected.local && candidate.side === "local");
    const remote = selected && candidates.find(candidate => candidate?.number === selected.remote && candidate.side === "remote");
    const types = ["host", "srflx", "prflx", "relay"];
    const protocols = ["udp", "tcp", "tls"];
    const stunErrors = Array.isArray(snapshot.stunErrors) ? snapshot.stunErrors.slice(0, 8)
      .filter(error => Number.isSafeInteger(error?.code)).map(error => ({
        code: error.code,
        addressKind: ["ipv4", "ipv6", "unknown"].includes(error.addressKind) ? error.addressKind : undefined,
      })) : [];
    console.log(JSON.stringify({ event: "netplay_ice_stats", archiveVersionId, roomId: room.id,
      seat: [...room.seats].indexOf(seat) + 1, platform: seat.platform, turnPort: room.pool.turnPort, phase, pairs, stunErrors,
      localCandidateType: types.includes(local?.type) ? local.type : undefined,
      remoteCandidateType: types.includes(remote?.type) ? remote.type : undefined,
      relayProtocol: protocols.includes(local?.relayProtocol) ? local.relayProtocol : undefined,
      ...Object.fromEntries(counts.filter(key => Number.isSafeInteger(snapshot[key])).map(key => [key, snapshot[key]])),
    }));
    return;
  }
  const prefix = "rtc:round:" + rtc.startedAt + ":";
  if (!data.startsWith(prefix)) return;
  const message = data.slice(prefix.length);
  if (message === "fail") {
    if (room.route === "pending") selectRoute(room, "hong_kong_websocket", "client_failure");
    else if (room.route === "webrtc") leave(room, seat, "rtc_failed");
    return;
  }
  const icePair = /^ice-pair:webrtc:(host|srflx|prflx|relay):(host|srflx|prflx|relay):(udp|tcp)$/.exec(message);
  if (room.route === "webrtc" && icePair) {
    const [, localCandidateType, remoteCandidateType, protocol] = icePair;
    console.log(JSON.stringify({ event: "netplay_ice_pair", archiveVersionId, roomId: room.id,
      seat: [...room.seats].indexOf(seat) + 1, localCandidateType, remoteCandidateType, protocol }));
    return;
  }
  if (room.route !== "pending") return;
  if (message === "ready") {
    rtc.ready.add(seat);
    if (rtc.ready.size === 2) selectRoute(room, "webrtc", "connected");
  } else if (message.startsWith("signal:") && Buffer.byteLength(message) <= 24_576) {
    seat.signals++;
    const other = [...room.seats].find(player => player !== seat);
    send(other?.socket, "rtc:" + message);
  } else if (/^diag:[a-z_]{1,48}$/.test(message) && seat.milestones.length < 32) {
    const milestone = message.slice(5);
    if (!seat.milestones.includes(milestone)) seat.milestones.push(milestone);
  }
}

function attachRoomSocket(socket, room, seat) {
  seat.socket = socket;
  if (seat.diagnostics) send(socket, "room:diagnostics:1");
  renewHeartbeat(room, seat);
  seat.ping = setInterval(() => {
    seat.pingAt = performance.now();
    send(socket, seat.inputStats ? "room:ping:stats" : "room:ping");
  }, heartbeatIntervalMs);

  socket.on("close", code => {
    if (!room.seats.has(seat) || seat.socket !== socket) return;
    if (room.route !== "webrtc") {
      leave(room, seat, "socket_close", code);
      return;
    }
    clearInterval(seat.ping);
    seat.socket = undefined;
    seat.expire = setTimeout(() => leave(room, seat, "control_resume_timeout", code), heartbeatTimeoutMs);
    console.log(JSON.stringify({ event: "netplay_control_disconnected", archiveVersionId, roomId: room.id,
      seat: [...room.seats].indexOf(seat) + 1, closeCode: code }));
  });

  socket.on("message", (data, binary) => {
    if (!room.seats.has(seat) || seat.socket !== socket) return;
    if (!binary) {
      receiveText(room, seat, data.toString());
      return;
    }
    const other = [...room.seats].find(player => player !== seat);
    if (room.route === "pending" && room.selection?.acceptsSocketProbe(data)) {
      send(other?.socket, data);
      return;
    }
    if (room.route !== "hong_kong_websocket" || room.seats.size !== 2 || ![4, 8, 12].includes(data.length)) return;
    if (data.length === 12 && data.readInt32LE(4) === -1) {
      const ready = room.ready;
      if (!ready || ready.socket === socket) {
        room.ready = { socket, data };
        return;
      }
      room.ready = undefined;
      send(ready.socket, data);
      send(socket, ready.data);
      return;
    }
    if (other?.socket?.readyState === WebSocket.OPEN) {
      send(other.socket, data);
      room.forwarded++;
    }
  });
}

function joinRoom(socket, { roomId, pool, identity, rtc, inputStats, inputProtocol, platform, routeSelection, diagnostics, roomAccess }) {
  const room = pool.rooms.get(roomId) ?? { id: roomId, pool, seats: new Set(), forwarded: 0, password: createRoomPassword() };
  const seat = { identity, rtc, routeSelection, inputStats, inputProtocol, platform, diagnostics, roomAccess,
    seatNumber: room.seats.size + 1, rttMs: null, peakRttMs: null, signals: 0, milestones: [] };
  room.seats.add(seat);
  pool.rooms.set(roomId, room);
  attachRoomSocket(socket, room, seat);
  sendRoomSettings(room);
  if (room.seats.size === 1) {
    send(socket, "2");
  } else {
    room.forwarded = 0;
    for (const [index, player] of [...room.seats].entries()) {
      player.seatNumber = index + 1;
      player.rttMs = player.peakRttMs = null;
      player.input = undefined;
      player.iceStatsPhase = undefined;
      player.signals = 0;
      player.milestones = [];
    }
    const seats = [...room.seats];
    room.inputProtocol = seats.every(player => player.inputProtocol === 1) ? 1 : 0;
    if (pool === auto && seats.every(player => player.routeSelection)) {
      room.route = "pending";
      const round = room.lastRound = Math.max(Date.now(), (room.lastRound ?? 0) + 1);
      const paths = ["websocket"];
      if (seats.every(player => player.rtc)) {
        paths.push("direct");
        if (turnKey) paths.push("turn");
      }
      room.selection = startRouteSelection({
        round, seats, paths, send: sendRoute,
        commit(path, measurements) {
          selectRoute(room, path === "websocket" ? "hong_kong_websocket" : "webrtc", "measured", { round, path, measurements });
        },
        fail(measurements) {
          console.log(JSON.stringify({ event: "netplay_route", archiveVersionId, roomId, round,
            reason: "no_usable_route", negotiationMs: Date.now() - round, measurements }));
          sendRoute(seats[1], { type: "rejected", round, reason: "transport" });
          leave(room, seats[1], "route_unavailable");
        },
      });
      for (const [index, player] of seats.entries()) {
        sendRoute(player, {
          type: "start", round, offer: index === 0, inputProtocol: room.inputProtocol,
          paths: paths.map(path => path === "websocket" ? { id: path } : {
            id: path, relayOnly: path === "turn",
            iceServers: path === "turn" ? turnIceServers(roomId, index, 443, round) : iceServers,
          }),
        });
      }
    } else if (pool !== relay && pool !== auto && seats.every(player => player.rtc)) {
      room.route = "pending";
      const startedAt = room.lastRound = Math.max(Date.now(), (room.lastRound ?? 0) + 1);
      room.negotiation = { startedAt, ready: new Set(),
        timer: setTimeout(() => selectRoute(room, "hong_kong_websocket", "timeout"), 8_000) };
      for (const [index, player] of seats.entries()) {
        const relayOnly = Boolean(pool.turnPort);
        const servers = relayOnly ? turnIceServers(roomId, index, pool.turnPort, startedAt) : iceServers;
        send(player.socket, "rtc:start:" + JSON.stringify({ iceServers: servers, offer: index === 0,
          negotiationStartedAt: startedAt, scoped: true, relayOnly, inputProtocol: room.inputProtocol,
          ...(relayOnly && { compareRelay: false }) }));
      }
    } else {
      selectRoute(room, "hong_kong_websocket", pool === relay ? "forced_relay" : "rtc_unavailable");
    }
  }
  publishDirectory(pool);
}

function json(response, body) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    json(response, { ok: true, route: "hong_kong_websocket", direct: true, turnUdp: Boolean(turnKey), roomPassword: true, archiveVersionId, profileIdentity: Boolean(identityKey) });
  } else if (request.headers.origin && request.headers.origin !== origin) {
    response.writeHead(403).end();
  } else if (request.method === "GET" && (request.url === defaultAvatar ||
      /^\/api\/media\/blobs\/[a-f0-9]{64}$/.test(request.url) &&
      [relay, ...Object.values(pools)].some(({ directory, rooms }) =>
        [...directory.values()].some(identity => identity.avatar === request.url) ||
        [...rooms.values()].some(({ seats }) => [...seats].some(({ identity }) => identity.avatar === request.url))))) {
    const upstream = await fetch(origin + request.url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    const contentType = upstream?.headers.get("Content-Type");
    if (!upstream?.ok || !upstream.body || !contentType?.startsWith("image/")) {
      await upstream?.body?.cancel().catch(() => {});
      response.writeHead(upstream?.status === 404 ? 404 : 502).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": origin,
      "X-Content-Type-Options": "nosniff",
    });
    await pipeline(Readable.fromWeb(upstream.body), response).catch(() => {});
  } else if (request.method === "GET") {
    const target = route(request);
    if (target?.directory) {
      json(response, listRooms(target.pool));
      return;
    }
    response.writeHead(404).end();
  } else {
    response.writeHead(404).end();
  }
});

function joinError(target, code) {
  const room = target.pool.rooms.get(target.roomId);
  if (target.mode === "join" && (!room || isStale(room))) return "closed";
  if (room && (room.seats.size === 2 || target.mode === "create" || isStale(room))) return "full";
  if (room?.password.enabled && code !== room.password.code) return code === null ? "password_required" : "password_incorrect";
}

server.on("upgrade", (request, socket, head) => {
  const target = route(request);
  const room = target?.pool.rooms.get(target.roomId);
  const resume = target?.resume && room?.route === "webrtc" &&
    [...room.seats].find(seat => !seat.socket && seat.resumeToken === target.resume);
  const error = target && !target.directory && !target.roomAccess && !target.resume ? joinError(target, null) : undefined;
  const status = request.headers.origin !== origin ? 403
    : !target ? 404
    : target.resume ? (resume ? 0 : 404)
    : error === "closed" ? 404 : error === "full" ? 409 : error ? 403 : 0;
  if (status) {
    if (target?.pool === auto && target.routeSelection && target.mode === "join" && (status === 404 || status === 409)) {
      rtcWss.handleUpgrade(request, socket, head, client => {
        client.on("error", () => client.terminate());
        sendRoute({ socket: client }, { type: "rejected", reason: status === 409 ? "full" : "closed" });
        client.close(1000);
      });
      return;
    }
    socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    return;
  }
  const handler = target.pool === relay && !target.diagnostics ? wss : rtcWss;
  handler.handleUpgrade(request, socket, head, client => {
    client.on("error", () => client.terminate());
    if (target.directory) watchDirectory(client, target);
    else if (resume) {
      attachRoomSocket(client, room, resume);
      sendRoomSettings(room);
      send(client, String(3 + [...room.seats].indexOf(resume)));
      console.log(JSON.stringify({ event: "netplay_control_resumed", archiveVersionId, roomId: room.id,
        seat: [...room.seats].indexOf(resume) + 1 }));
    } else if (target.roomAccess) {
      const timer = setTimeout(() => client.close(1008), 5_000);
      client.once("close", () => clearTimeout(timer));
      client.once("message", (data, binary) => {
        clearTimeout(timer);
        const entry = !binary && parseJoinPassword(data.toString());
        if (!entry) return client.close(1008);
        const error = joinError(target, entry.code);
        if (error) {
          send(client, "room:rejected:" + error);
          client.close(1000);
          return;
        }
        joinRoom(client, target);
      });
    } else joinRoom(client, target);
  });
});

server.listen(port, "127.0.0.1");
