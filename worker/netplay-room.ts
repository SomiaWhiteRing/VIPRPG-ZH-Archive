import { DurableObject } from "cloudflare:workers";
import { getCurrentUser } from "../app/.server/auth/current-user";
import { getPublishedArchiveDownloadRecord } from "../app/.server/db/archive-downloads";
import { createRuntime } from "../app/.server/runtime";
import { getUserAvatarSrc } from "../lib/user-profile";
import { json } from "../lib/http";
import { requestJsonValue } from "../lib/ui/api-response";

type Identity = { name: string; avatar: string };
type NetplayEnvironment = CloudflareEnv & {
  NETPLAY_TURN_KEY_ID?: string;
  NETPLAY_TURN_KEY?: string;
};
type Negotiation = {
  route: "pending" | "webrtc" | "websocket";
  ready: Set<WebSocket>;
  timeout?: ReturnType<typeof setTimeout>;
};
type Room = {
  peers: Map<WebSocket, { identity: Identity; rtc: boolean }>;
  ready?: { socket: WebSocket; packet: ArrayBuffer };
  rtc?: Negotiation;
};

export class NetplayRoom extends DurableObject<NetplayEnvironment> {
  private rooms = new Map<number, Room>();
  private directory = new Map<WebSocket, Identity>();

  private list() {
    return Array.from(this.rooms, ([id, { peers }]) => ({
      id, players: Array.from(peers.values(), ({ identity }) => identity),
    }));
  }

  private async iceServers(): Promise<RTCIceServer[]> {
    const stun = [{ urls: "stun:stun.cloudflare.com:3478" }];
    const id = this.env.NETPLAY_TURN_KEY_ID;
    const token = this.env.NETPLAY_TURN_KEY;
    if (!id || !token) return stun;
    try {
      const { iceServers } = await requestJsonValue<{ iceServers?: RTCIceServer[] }>(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 3600 }),
        signal: AbortSignal.timeout(2500),
      });
      if (iceServers?.length) return iceServers;
    } catch {
      // STUN can still establish a direct connection if the TURN API is unavailable.
    }
    return stun;
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
    const room: Room = existing ?? { peers: new Map() };
    const { peers } = room;
    const first = peers.keys().next().value;
    if (first && first.readyState !== WebSocket.OPEN) return new Response(null, { status: 409 });

    const pair = new WebSocketPair();
    const socket = pair[1];
    socket.binaryType = "arraybuffer";
    socket.accept();
    const identity = JSON.parse(decodeURIComponent(request.headers.get("X-Netplay-Identity")!)) as Identity;
    peers.set(socket, { identity, rtc: url.searchParams.get("rtc") === "1" });
    this.rooms.set(id, room);
    socket.addEventListener("message", ({ data }) => {
      if (!peers.has(socket)) return;
      const rtc = room.rtc;
      if (typeof data === "string") {
        if (rtc?.route !== "pending") return;
        if (data === "rtc:ready") {
          rtc.ready.add(socket);
          if (rtc.ready.size === 2) this.selectRoute(room, "webrtc");
        } else if (data === "rtc:fail") {
          this.selectRoute(room, "websocket");
        } else if (data.length <= 24576 && data.startsWith("rtc:signal:")) {
          for (const peer of peers.keys()) if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(data);
        }
        return;
      }
      if (!(data instanceof ArrayBuffer) || (data.byteLength !== 4 && data.byteLength !== 8 && data.byteLength !== 12) ||
          rtc?.route === "pending" || (rtc?.route === "webrtc" && data.byteLength !== 4)) return;
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
      if (room.rtc) clearTimeout(room.rtc.timeout);
      room.rtc = undefined;
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
      if (peers.get(first)?.rtc && peers.get(socket)?.rtc) {
        const rtc: Negotiation = {
          route: "pending",
          ready: new Set(),
        };
        room.rtc = rtc;
        void Promise.all([this.iceServers(), this.iceServers()]).then(([firstServers, secondServers]) => {
          if (room.rtc !== rtc || rtc.route !== "pending") return;
          rtc.timeout = setTimeout(() => this.selectRoute(room, "websocket"), 8000);
          first.send("rtc:start:" + JSON.stringify({ iceServers: firstServers, offer: true }));
          socket.send("rtc:start:" + JSON.stringify({ iceServers: secondServers, offer: false }));
        });
      } else {
        first.send("3");
        socket.send("4");
      }
    } else {
      socket.send("2");
    }
    this.publishDirectory();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private selectRoute(room: Room, route: "webrtc" | "websocket") {
    const rtc = room.rtc;
    const [first, second] = room.peers.keys();
    if (rtc?.route !== "pending" || first?.readyState !== WebSocket.OPEN || second?.readyState !== WebSocket.OPEN) return;
    clearTimeout(rtc.timeout);
    rtc.route = route;
    first.send("rtc:" + route);
    second.send("rtc:" + route);
    first.send("3");
    second.send("4");
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
