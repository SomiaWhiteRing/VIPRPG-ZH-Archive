import { DurableObject } from "cloudflare:workers";
import { getCurrentUser } from "../app/.server/auth/current-user";
import { getPublishedArchiveDownloadRecord } from "../app/.server/db/archive-downloads";
import { createRuntime } from "../app/.server/runtime";
import { getUserAvatarSrc } from "../lib/user-profile";
import { json } from "../lib/http";

type Identity = { name: string; avatar: string };
type Room = {
  peers: Map<WebSocket, Identity>;
  ready?: { socket: WebSocket; packet: ArrayBuffer };
};

export class NetplayRoom extends DurableObject<CloudflareEnv> {
  private rooms = new Map<number, Room>();
  private directory = new Map<WebSocket, Identity>();

  private list() {
    return Array.from(this.rooms, ([id, { peers }]) => ({ id, players: Array.from(peers.values()) }));
  }

  private publishDirectory() {
    const rooms = this.list();
    const online = this.directory.size;
    for (const [socket, identity] of this.directory) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ rooms, identity, online }));
    }
  }

  fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.endsWith("/rooms")) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json(this.list(), { headers: { "Cache-Control": "private, no-store" } });
      }
      const pair = new WebSocketPair();
      const socket = pair[1];
      socket.accept();
      const identity = JSON.parse(decodeURIComponent(request.headers.get("X-Netplay-Identity")!)) as Identity;
      this.directory.set(socket, identity);
      const disconnect = () => {
        if (!this.directory.delete(socket)) return;
        this.publishDirectory();
        socket.close(1000);
      };
      socket.addEventListener("close", disconnect);
      socket.addEventListener("error", disconnect);
      this.publishDirectory();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    const id = Number(path.slice(path.lastIndexOf("/") + 1));
    const mode = url.searchParams.get("mode");
    const existing = this.rooms.get(id);
    if (existing?.peers.size === 2 || (mode === "create" && existing)) return new Response(null, { status: 409 });
    if (mode === "join" && !existing) return new Response(null, { status: 404 });
    const room: Room = existing ?? { peers: new Map<WebSocket, Identity>() };
    const { peers } = room;
    const first = peers.keys().next().value;
    if (first && first.readyState !== WebSocket.OPEN) return new Response(null, { status: 409 });

    const pair = new WebSocketPair();
    const socket = pair[1];
    socket.binaryType = "arraybuffer";
    socket.accept();
    const identity = JSON.parse(decodeURIComponent(request.headers.get("X-Netplay-Identity")!)) as Identity;
    peers.set(socket, identity);
    this.rooms.set(id, room);
    socket.addEventListener("message", ({ data }) => {
      if (!peers.has(socket) || !(data instanceof ArrayBuffer) ||
          (data.byteLength !== 4 && data.byteLength !== 8 && data.byteLength !== 12)) return;
      if (data.byteLength === 12 && new DataView(data).getInt32(4, true) === -1) {
        if (peers.size !== 2) return;
        const ready = room.ready;
        if (!ready || ready.socket === socket) {
          room.ready = { socket, packet: data };
          return;
        }
        room.ready = undefined;
        if (ready.socket.readyState === WebSocket.OPEN) {
          ready.socket.send(data);
          socket.send(ready.packet);
        }
        return;
      }
      for (const peer of peers.keys()) {
        if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(data);
      }
    });
    const disconnect = () => {
      if (!peers.delete(socket)) return;
      room.ready = undefined;
      if (peers.size === 0) this.rooms.delete(id);
      else {
        const remaining = peers.keys().next().value!;
        if (remaining.readyState === WebSocket.OPEN) remaining.send("2");
      }
      this.publishDirectory();
      socket.close(1000);
    };
    socket.addEventListener("close", disconnect);
    socket.addEventListener("error", disconnect);
    if (first) {
      first.send("3");
      socket.send("4");
    } else {
      socket.send("2");
    }
    this.publishDirectory();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}

export async function maybeHandleNetplayRoom(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/netplay/v1/")) return;
  const route = /^\/api\/netplay\/v1\/([1-9]\d*)\/(rooms|[1-9]\d{0,5})$/.exec(url.pathname);
  if (!route || !env.NETPLAY_ROOM) return new Response(null, { status: 404 });
  const archiveVersionId = Number(route[1]);
  if (!Number.isSafeInteger(archiveVersionId)) return new Response(null, { status: 404 });
  const directory = route[2] === "rooms";
  const websocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
  if (request.method !== "GET" || (!directory && !websocket)) {
    return new Response(null, { status: 426 });
  }
  const runtime = createRuntime(request, env, ctx, import.meta.env.DEV);
  const origin = request.headers.get("Origin");
  if (url.origin !== runtime.origin || (websocket && origin !== runtime.origin) || (origin !== null && origin !== runtime.origin)) {
    return new Response(null, { status: 403 });
  }
  const archive = await getPublishedArchiveDownloadRecord(runtime, archiveVersionId);
  if (!archive?.netplayService) return new Response(null, { status: 404 });
  const rooms = env.NETPLAY_ROOM.getByName(`v1/${archiveVersionId}`);
  if (directory && !websocket) return rooms.fetch(request);

  const user = await getCurrentUser(runtime);
  const guest = url.searchParams.get("guest");
  const identity: Identity = {
    name: user?.displayName ?? "访客 " + (guest && /^[0-9a-f]{4}$/.test(guest) ? guest : crypto.randomUUID().slice(0, 4)),
    avatar: getUserAvatarSrc(user?.avatarBlobSha256),
  };
  const headers = new Headers(request.headers);
  headers.set("X-Netplay-Identity", encodeURIComponent(JSON.stringify(identity)));
  return rooms.fetch(new Request(request, { headers }));
}
