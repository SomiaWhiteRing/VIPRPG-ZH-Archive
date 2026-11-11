import { randomBytes } from "node:crypto";
import { createServer, STATUS_CODES } from "node:http";
import { createRequire } from "node:module";

const { WebSocket, WebSocketServer } = createRequire(import.meta.url)("ws");
const origin = "https://staging.viprpg.org";
const archiveVersionId = Number(process.env.NETPLAY_ARCHIVE_VERSION);
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
  const match = /^\/api\/netplay\/v1\/([1-9]\d*)\/(?:rtc\/)?(rooms|[1-9]\d{0,5})$/.exec(url.pathname);
  if (Number(match?.[1]) !== archiveVersionId) return;
  const guest = url.searchParams.get("guest");
  return {
    directory: match[2] === "rooms",
    roomId: Number(match[2]),
    mode: url.searchParams.get("mode"),
    identity: { name: "访客 " + (/^[0-9a-f]{4}$/.test(guest ?? "") ? guest : randomBytes(2).toString("hex")), avatar: "" },
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
  const seat = { identity, lastPong: Date.now() };
  peers.set(socket, seat);
  rooms.set(roomId, room);

  function leave(reason, closeCode) {
    if (!peers.delete(socket)) return;
    clearTimeout(hide);
    clearTimeout(expire);
    clearInterval(ping);
    room.ready = undefined;
    const remaining = peers.keys().next().value;
    if (remaining) send(remaining, "2");
    else rooms.delete(roomId);
    console.log(JSON.stringify({ event: "netplay_departure", archiveVersionId, roomId, reason, closeCode,
      remaining: peers.size, forwarded: room.forwarded }));
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

  const ping = setInterval(() => send(socket, "room:ping"), heartbeatIntervalMs);
  renewHeartbeat();
  socket.on("close", code => leave("socket_close", code));
  socket.on("message", (data, binary) => {
    if (!binary) {
      if (data.toString() === "room:pong") renewHeartbeat();
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
    for (const peer of [first, socket]) send(peer, "rtc:websocket");
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

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    json(response, { ok: true, route: "hong_kong_websocket", archiveVersionId });
  } else if (request.headers.origin && request.headers.origin !== origin) {
    response.writeHead(403).end();
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
