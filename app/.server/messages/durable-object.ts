import { DurableObject } from "cloudflare:workers";

/** Transient notifications only: no timers, database calls or stored message bodies. */
export class MessageRoom extends DurableObject<CloudflareEnv> {
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
    const userId = request.headers.get("X-Message-User");
    if (!userId) return new Response(null, { status: 403 });
    if (this.ctx.getWebSockets(userId).length >= 4) return new Response(null, { status: 429 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [userId]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  changed() {
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send('{"type":"changed"}'); }
      catch { /* Disconnected tabs catch up through the authenticated history API. */ }
    }
  }

  webSocketMessage(socket: WebSocket) { socket.close(1008, ""); }
  webSocketClose(socket: WebSocket) { socket.close(1000, ""); }
  webSocketError(socket: WebSocket) { socket.close(1011, ""); }
}
