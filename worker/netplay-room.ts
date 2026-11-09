import { DurableObject } from "cloudflare:workers";
import { getPublishedArchiveDownloadRecord } from "../app/.server/db/archive-downloads";
import { createRuntime } from "../app/.server/runtime";

export class NetplayRoom extends DurableObject<CloudflareEnv> {
  private peers = new Set<WebSocket>();

  fetch() {
    if (this.peers.size === 2) return new Response(null, { status: 409 });
    const first = this.peers.values().next().value;
    if (first && first.readyState !== WebSocket.OPEN) return new Response(null, { status: 409 });

    const pair = new WebSocketPair();
    const socket = pair[1];
    socket.binaryType = "arraybuffer";
    socket.accept();
    this.peers.add(socket);
    socket.addEventListener("message", ({ data }) => {
      if (!this.peers.has(socket) || !(data instanceof ArrayBuffer) || data.byteLength !== 4) return;
      for (const peer of this.peers) {
        if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(data);
      }
    });
    const disconnect = () => {
      if (!this.peers.delete(socket)) return;
      const remaining = [...this.peers];
      this.peers.clear();
      for (const peer of remaining) peer.close(1000);
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
  const route = /^\/api\/netplay\/v1\/([1-9]\d*)\/([1-9]\d{0,5})$/.exec(url.pathname);
  if (!route || !env.NETPLAY_ROOM) return new Response(null, { status: 404 });
  const archiveVersionId = Number(route[1]);
  if (!Number.isSafeInteger(archiveVersionId)) return new Response(null, { status: 404 });
  if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response(null, { status: 426 });
  }
  const runtime = createRuntime(request, env, ctx, import.meta.env.DEV);
  if (url.origin !== runtime.origin || request.headers.get("Origin") !== runtime.origin) {
    return new Response(null, { status: 403 });
  }
  const archive = await getPublishedArchiveDownloadRecord(runtime, archiveVersionId);
  if (!archive?.netplayService) return new Response(null, { status: 404 });
  return env.NETPLAY_ROOM.getByName(`v1/${archiveVersionId}/${route[2]}`).fetch(request);
}
