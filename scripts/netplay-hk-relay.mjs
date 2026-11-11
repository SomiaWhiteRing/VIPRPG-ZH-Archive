import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, STATUS_CODES } from "node:http";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const { WebSocket, WebSocketServer } = createRequire(import.meta.url)("ws");
const origin = "https://staging.viprpg.org";
const defaultAvatar = "/icon/alex.png";
const archiveVersionId = Number(process.env.NETPLAY_ARCHIVE_VERSION);
const identityKey = process.env.NETPLAY_HK_IDENTITY_KEY;
const port = Number(process.env.NETPLAY_PORT ?? 8787);
if (!Number.isSafeInteger(archiveVersionId) || archiveVersionId < 1) {
  throw new Error("Set NETPLAY_ARCHIVE_VERSION to the staging archive version");
}

const rooms = new Map();
const directory = new Map();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64, perMessageDeflate: false });
const heartbeatIntervalMs = 5_000;
const heartbeatHideMs = 10_000;
const heartbeatTimeoutMs = 15_000;

function route(request) {
  const url = new URL(request.url, origin);
  const match = /^\/api\/netplay\/v1\/([1-9]\d*)\/(?:identity\/([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\/)?(?:rtc\/)?(rooms|[1-9]\d{0,5})$/.exec(url.pathname);
  if (Number(match?.[1]) !== archiveVersionId) return;
  const [, , payload, signature, target] = match;
  const guest = url.searchParams.get("guest");
  let identity = {
    name: "访客 " + (/^[0-9a-f]{4}$/.test(guest ?? "") ? guest : randomBytes(2).toString("hex")),
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
  return {
    directory: target === "rooms",
    roomId: Number(target),
    mode: url.searchParams.get("mode"),
    identity,
  };
}

function isStale(room) {
  return [...room.peers].some(([socket, seat]) =>
    socket.readyState !== WebSocket.OPEN || Date.now() - seat.lastPong >= heartbeatHideMs);
}

function listRooms() {
  return [...rooms].filter(([, room]) => !isStale(room))
    .map(([id, room]) => ({ id, players: [...room.peers.values()].map(seat => seat.identity) }));
}

function send(socket, data) {
  if (socket.readyState === WebSocket.OPEN) socket.send(data);
}

function publishDirectory() {
  const rooms = listRooms();
  for (const [socket, identity] of directory) {
    send(socket, JSON.stringify({ rooms, identity, online: directory.size }));
  }
}

function watchDirectory(socket, identity) {
  directory.set(socket, identity);
  socket.on("message", (data, binary) => {
    if (!binary && data.toString() === "directory:ping") send(socket, "directory:pong");
  });
  socket.on("close", () => {
    directory.delete(socket);
    publishDirectory();
  });
  publishDirectory();
}

function joinRoom(socket, { roomId, identity }) {
  const room = rooms.get(roomId) ?? { peers: new Map(), ready: undefined, forwarded: 0 };
  const { peers } = room;
  const first = peers.keys().next().value;
  const seat = { identity, lastPong: Date.now(), pingAt: 0, rttMs: null, peakRttMs: null };
  peers.set(socket, seat);
  rooms.set(roomId, room);

  function leave(reason, closeCode) {
    if (!peers.has(socket)) return;
    const heartbeat = [...peers.values()].map(({ rttMs, peakRttMs }) => ({ rttMs, peakRttMs }));
    peers.delete(socket);
    clearTimeout(hide);
    clearTimeout(expire);
    clearInterval(ping);
    room.ready = undefined;
    const remaining = peers.keys().next().value;
    if (remaining) send(remaining, "2");
    else rooms.delete(roomId);
    console.log(JSON.stringify({ event: "netplay_departure", archiveVersionId, roomId, reason, closeCode,
      remaining: peers.size, forwarded: room.forwarded, heartbeat }));
    publishDirectory();
  }

  let hide, expire;
  function renewHeartbeat() {
    const now = Date.now();
    if (now - seat.lastPong >= heartbeatTimeoutMs) {
      timeout();
      return;
    }
    const hidden = isStale(room);
    seat.lastPong = now;
    clearTimeout(hide);
    clearTimeout(expire);
    hide = setTimeout(publishDirectory, heartbeatHideMs);
    expire = setTimeout(timeout, heartbeatTimeoutMs);
    if (hidden) publishDirectory();
  }

  function timeout() {
    leave("heartbeat_timeout");
    socket.terminate();
  }

  const ping = setInterval(() => {
    seat.pingAt = performance.now();
    send(socket, "room:ping");
  }, heartbeatIntervalMs);
  renewHeartbeat();
  socket.on("close", code => leave("socket_close", code));
  socket.on("message", (data, binary) => {
    if (!binary) {
      if (data.toString() === "room:pong") {
        if (seat.pingAt) {
          seat.rttMs = Math.round(performance.now() - seat.pingAt);
          seat.peakRttMs = Math.max(seat.peakRttMs ?? 0, seat.rttMs);
          seat.pingAt = 0;
        }
        renewHeartbeat();
      }
      return;
    }
    if (peers.size !== 2 || ![4, 8, 12].includes(data.length)) return;
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
    for (const peer of peers.keys()) {
      if (peer !== socket && peer.readyState === WebSocket.OPEN) {
        send(peer, data);
        room.forwarded++;
      }
    }
  });

  if (first) {
    room.forwarded = 0;
    for (const [peer, player] of peers) {
      player.rttMs = null;
      player.peakRttMs = null;
      send(peer, "rtc:websocket");
    }
    send(first, "3");
    send(socket, "4");
    console.log(JSON.stringify({ event: "netplay_route", archiveVersionId, roomId, route: "hong_kong_websocket" }));
  } else {
    send(socket, "2");
  }
  publishDirectory();
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
    json(response, { ok: true, route: "hong_kong_websocket", archiveVersionId, profileIdentity: Boolean(identityKey) });
  } else if (request.headers.origin && request.headers.origin !== origin) {
    response.writeHead(403).end();
  } else if (request.method === "GET" && (request.url === defaultAvatar ||
      /^\/api\/media\/blobs\/[a-f0-9]{64}$/.test(request.url) &&
      ([...directory.values()].some(identity => identity.avatar === request.url) ||
        [...rooms.values()].some(({ peers }) => [...peers.values()].some(({ identity }) => identity.avatar === request.url))))) {
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
  } else if (request.method === "GET" && route(request)?.directory) {
    json(response, listRooms());
  } else {
    response.writeHead(404).end();
  }
});

server.on("upgrade", (request, socket, head) => {
  const target = route(request);
  const room = target && rooms.get(target.roomId);
  const status = request.headers.origin !== origin ? 403
    : !target || target.mode === "join" && (!room || isStale(room)) ? 404
    : room && (room.peers.size === 2 || target.mode === "create" || isStale(room)) ? 409 : 0;
  if (status) {
    socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    return;
  }
  wss.handleUpgrade(request, socket, head, client => {
    client.on("error", () => client.terminate());
    if (target.directory) watchDirectory(client, target.identity);
    else joinRoom(client, target);
  });
});

server.listen(port, "127.0.0.1");
