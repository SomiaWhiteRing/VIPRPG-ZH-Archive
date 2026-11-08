import { DurableObject } from "cloudflare:workers";
import { getCurrentUser } from "../app/.server/auth/current-user";
import { createRuntime } from "../app/.server/runtime";
import { GyokuroRoom } from "../lib/netplay/gyokuro-room.mjs";
import { getUserAvatarSrc } from "../lib/user-profile";

import { gyokuroEndpoint as socketPath, gyokuroRuntime, gyokuroStagingOrigin as staging, gyokuroWorkTitle } from "../lib/netplay/gyokuro-web-play";

const lobbyPath = "/play/244/netplay";
const assetPath = "/play/gyokuro-lobby/";

type Identity = { name: string; avatar: string };
type Room = { id: string; logic: GyokuroRoom; members: Client[]; playing: boolean };
type Client = {
  socket: WebSocket;
  identity: Identity;
  room?: Room;
  connection?: NonNullable<ReturnType<GyokuroRoom["attach"]>>;
};

export class GyokuroLobby extends DurableObject<CloudflareEnv> {
  private clients = new Set<Client>();
  private rooms = new Map<string, Room>();

  async fetch(request: Request) {
    const pair = new WebSocketPair();
    const socket = pair[1];
    const identity = JSON.parse(decodeURIComponent(request.headers.get("X-Gyokuro-Identity")!)) as Identity;
    const client = { socket, identity } satisfies Client;
    socket.accept();
    this.clients.add(client);
    socket.addEventListener("message", ({ data }) => this.receive(client, data));
    socket.addEventListener("close", () => {
      this.disconnect(client);
      socket.close(1000);
    });
    socket.addEventListener("error", () => this.disconnect(client));
    this.publish([client]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private disconnect(client: Client) {
    if (this.clients.delete(client)) this.leave(client);
  }

  private receive(client: Client, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 64) return;
    if (message === "leave") {
      this.leave(client);
      return;
    }
    if (client.connection) {
      const playing = client.room!.playing;
      client.connection.message(message);
      if (playing !== client.room!.playing) this.publish();
      return;
    }
    if (message === "create" || message === "match") {
      const available = message === "match"
        ? Array.from(this.rooms.values()).find((room) => room.members.length === 1)
        : undefined;
      if (available) {
        this.enter(client, available);
      } else {
        let id: string;
        do {
          id = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
        } while (this.rooms.has(id));
        const room = { id, logic: new GyokuroRoom(1), members: [], playing: false };
        this.rooms.set(id, room);
        this.enter(client, room);
      }
    } else {
      const id = /^join (\d{6})$/.exec(message)?.[1];
      if (!id) return;
      const room = this.rooms.get(id);
      if (room?.members.length === 1) this.enter(client, room);
      else this.send(client, JSON.stringify({ error: "房间已满或已关闭" }));
    }
  }

  private enter(client: Client, room: Room) {
    const create = room.members.length === 0;
    client.room = room;
    room.members.push(client);
    client.connection = room.logic.attach({
      send: (message: string) => {
        if (message.startsWith("S ")) room.playing = true;
        if (message.startsWith("D ") || message === "L" || message.startsWith("E ")) room.playing = false;
        this.send(client, message);
      },
      close: () => queueMicrotask(() => {
        if (client.room === room) this.leave(client);
      }),
    }, create) ?? undefined;
    this.publish();
  }

  private leave(client: Client) {
    const room = client.room;
    if (!room) return;
    const wasHost = room.members[0] === client;
    if (wasHost) this.rooms.delete(room.id);
    else room.members.pop();
    client.room = undefined;
    const connection = client.connection;
    client.connection = undefined;
    connection?.close();
    this.send(client, "L");
    this.publish();
  }

  private send(client: Client, message: string) {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(message);
  }

  private publish(clients: Iterable<Client> = this.clients) {
    const rooms = Array.from(this.rooms.values(), (room) => ({
      id: room.id,
      players: room.members.map(({ identity }) => identity),
      playing: room.playing,
    }));
    for (const client of clients) {
      this.send(client, JSON.stringify({ self: client.identity, rooms, roomId: client.room?.id ?? null }));
    }
  }
}

export async function maybeHandleGyokuroLobby(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
  const url = new URL(request.url);
  if (url.pathname !== lobbyPath && url.pathname !== socketPath && !url.pathname.startsWith(assetPath)) return;
  if (env.APP_ORIGIN !== staging || url.origin !== staging) return new Response(null, { status: 404 });

  if (url.pathname === socketPath) {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response(null, { status: 426 });
    }
    if (request.headers.get("Origin") !== staging) return new Response(null, { status: 403 });
    if (!env.GYOKURO_LOBBY) return new Response(null, { status: 503 });

    const user = await getCurrentUser(createRuntime(request, env, ctx));
    const identity: Identity = {
      name: user?.displayName ?? "访客 " + crypto.randomUUID().slice(0, 4),
      avatar: getUserAvatarSrc(user?.avatarBlobSha256),
    };
    const headers = new Headers(request.headers);
    headers.set("X-Gyokuro-Identity", encodeURIComponent(JSON.stringify(identity)));
    return env.GYOKURO_LOBBY.getByName("244").fetch(new Request(request, { headers }));
  }

  if (url.pathname === lobbyPath) {
    const work = await env.DB.prepare("SELECT id FROM works WHERE original_title=? AND status='published' AND audience='public' ORDER BY id LIMIT 1")
      .bind(gyokuroWorkTitle).first<{ id: number }>();
    return work ? Response.redirect(new URL("/play/" + work.id, url), 302) : new Response(null, { status: 404 });
  }
  if (!url.pathname.startsWith(gyokuroRuntime + "/")) return new Response(null, { status: 404 });
  const asset = await env.ASSETS.fetch(request);
  const response = new Response(asset.body, asset);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (url.pathname.endsWith(".html")) response.headers.set("Cache-Control", "no-store");
  return response;
}
