import { DurableObject } from "cloudflare:workers";
import { getCurrentUser } from "../app/.server/auth/current-user";
import { getPublishedArchiveDownloadRecord } from "../app/.server/db/archive-downloads";
import { createRuntime } from "../app/.server/runtime";
import { getUserAvatarSrc } from "../lib/user-profile";
import { json } from "../lib/http";

type Identity = { name: string; avatar: string };

export class NetplayRoom extends DurableObject<CloudflareEnv> {
  private rooms = new Map<number, Map<WebSocket, Identity>>();

  fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.endsWith("/rooms")) {
      const rooms = Array.from(this.rooms, ([id, peers]) => ({ id, players: Array.from(peers.values()) }));
      return json(rooms, { headers: { "Cache-Control": "private, no-store" } });
    }

    const id = Number(path.slice(path.lastIndexOf("/") + 1));
    const mode = url.searchParams.get("mode");
    const existing = this.rooms.get(id);
    if (existing?.size === 2 || (mode === "create" && existing)) return new Response(null, { status: 409 });
    if (mode === "join" && !existing) return new Response(null, { status: 404 });
    const peers = existing ?? new Map<WebSocket, Identity>();
    const first = peers.keys().next().value;
    if (first && first.readyState !== WebSocket.OPEN) return new Response(null, { status: 409 });

    const pair = new WebSocketPair();
    const socket = pair[1];
    socket.binaryType = "arraybuffer";
    socket.accept();
    const identity = JSON.parse(decodeURIComponent(request.headers.get("X-Netplay-Identity")!)) as Identity;
    peers.set(socket, identity);
    this.rooms.set(id, peers);
    socket.addEventListener("message", ({ data }) => {
      if (!peers.has(socket) || !(data instanceof ArrayBuffer) ||
          (data.byteLength !== 4 && data.byteLength !== 12)) return;
      for (const peer of peers.keys()) {
        if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(data);
      }
    });
    const disconnect = () => {
      if (!peers.delete(socket)) return;
      if (peers.size === 0) this.rooms.delete(id);
      else {
        const remaining = peers.keys().next().value!;
        if (remaining.readyState === WebSocket.OPEN) remaining.send("2");
      }
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
  if (request.method !== "GET" || (!directory && request.headers.get("Upgrade")?.toLowerCase() !== "websocket")) {
    return new Response(null, { status: 426 });
  }
  const runtime = createRuntime(request, env, ctx, import.meta.env.DEV);
  const origin = request.headers.get("Origin");
  if (url.origin !== runtime.origin || (!directory && origin !== runtime.origin) || (origin !== null && origin !== runtime.origin)) {
    return new Response(null, { status: 403 });
  }
  const archive = await getPublishedArchiveDownloadRecord(runtime, archiveVersionId);
  if (!archive?.netplayService) return new Response(null, { status: 404 });
  const rooms = env.NETPLAY_ROOM.getByName(`v1/${archiveVersionId}`);
  if (directory) return rooms.fetch(request);

  const user = await getCurrentUser(runtime);
  const identity: Identity = {
    name: user?.displayName ?? "访客 " + crypto.randomUUID().slice(0, 4),
    avatar: getUserAvatarSrc(user?.avatarBlobSha256),
  };
  const headers = new Headers(request.headers);
  headers.set("X-Netplay-Identity", encodeURIComponent(JSON.stringify(identity)));
  return rooms.fetch(new Request(request, { headers }));
}
