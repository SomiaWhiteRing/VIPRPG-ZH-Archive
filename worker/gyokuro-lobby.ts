import { DurableObject } from "cloudflare:workers";
import { getCurrentUser } from "../app/.server/auth/current-user";
import { createRuntime } from "../app/.server/runtime";
import { getUserAvatarSrc } from "../lib/user-profile";

import { gyokuroEndpoint as socketPath, gyokuroRuntime, gyokuroStagingOrigin as staging, gyokuroWorkTitle } from "../lib/netplay/gyokuro-web-play";

const lobbyPath = "/play/244/netplay";
const assetPath = "/play/gyokuro-lobby/";

const stages = [6, 7, 8, 11, 9, 12, 1, 14, 15, 13];
const roster = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18];
type Identity = { name: string; avatar: string };
type Room = { id: string; members: Client[]; stage: number; rounds: number; phase: "room" | "select" | "loading" | "battle"; epoch: number };
type Client = { socket: WebSocket; identity: Identity; room?: Room; ready: number; fighter: number; hover: number; wins: number; next: number; loaded: boolean };

export class GyokuroLobby extends DurableObject<CloudflareEnv> {
  private clients = new Set<Client>();
  private rooms = new Map<string, Room>();

  async fetch(request: Request) {
    const pair = new WebSocketPair();
    const socket = pair[1];
    const identity = JSON.parse(decodeURIComponent(request.headers.get("X-Gyokuro-Identity")!)) as Identity;
    const client: Client = { socket, identity, ready: 0, fighter: 0, hover: 1, wins: 0, next: 1, loaded: false };
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
    if (this.clients.delete(client)) this.leave(client, true);
  }

  private receive(client: Client, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 64) return;
    if (message === "K") {
      this.send(client, "K");
      return;
    }
    if (message === "leave") {
      this.leave(client);
      return;
    }
    const room = client.room;
    if (!room) {
      if (message === "create") {
        let id: string;
        do {
          id = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
        } while (this.rooms.has(id));
        const created: Room = { id, members: [], stage: 0, rounds: 2, phase: "room", epoch: 0 };
        this.rooms.set(id, created);
        this.enter(client, created);
      } else {
        const id = /^join (\d{6})$/.exec(message)?.[1];
        if (!id) return;
        const available = this.rooms.get(id);
        if (available?.members.length === 1) this.enter(client, available);
        else this.send(client, JSON.stringify({ error: "房间已满或已关闭" }));
      }
      return;
    }

    if (message === "Q" && (room.phase === "battle" || room.phase === "loading")) {
      this.reset(room, "Q");
      return;
    }
    const peer = room.members[room.members[0] === client ? 1 : 0];
    if (room.phase === "select" && message === "U") {
      client.fighter = 0;
      this.send(peer, "H " + client.hover + " 0");
      return;
    }
    if (!/^[AHFVICDTYMJ](?: \d{1,10}){1,3}$/.test(message)) return;
    const [type, ...words] = message.split(" ");
    const [a, b, c] = words.map(Number);
    if (room.phase === "room") {
      if ((type === "V" || type === "M") && words.length === 1 && room.members[0] === client && !client.ready) {
        if (type === "V" && (a === 0 || stages.includes(a))) {
          room.stage = a;
        } else if (type === "M" && a >= 1 && a <= 3) {
          room.rounds = a;
        } else return;
      } else if (type === "A" && words.length === 1 && a <= 1) {
        client.ready = a;
      } else {
        return;
      }
      this.roomState(room);
      if (room.members.length === 2 && room.members.every((member) => member.ready)) {
        room.phase = "select";
        this.broadcast(room, "B");
      }
      return;
    }

    if ((type === "T" || type === "Y") && words.length === 1) {
      this.send(peer, message);
      return;
    }
    if (room.phase === "select") {
      if (words.length !== 1 || client.fighter) return;
      if (type === "H" && a >= 1 && a <= 16) {
        client.hover = a;
        this.send(peer, "H " + a + " 0");
        return;
      }
      if (type !== "F" || (!roster.includes(a) && a !== 16)) return;
      client.fighter = a;
      this.send(peer, "H " + a + " 1");
      if (!room.members.every((member) => member.fighter)) return;
      const random = crypto.getRandomValues(new Uint32Array(4));
      const picks = room.members.flatMap((member, slot) => {
        member.loaded = false;
        return [member.fighter === 16 ? roster[random[slot] % roster.length] : member.fighter, 0];
      });
      room.phase = "loading";
      const stage = room.stage || stages[random[3] % stages.length];
      this.broadcast(room, ["S", ++room.epoch, random[2], stage, ...picks, room.rounds].join(" "));
      return;
    }

    if (a !== room.epoch) return;
    if (room.phase === "loading") {
      // Each client sends J after its original round intro finishes.
      if (type !== "J" || words.length !== 1 || client.loaded) return;
      client.loaded = true;
      if (!peer.loaded) return;
      for (const member of room.members) member.next = 1;
      room.phase = "battle";
      this.broadcast(room, "G " + room.epoch + " 1");
      return;
    }
    if (type === "I" && words.length === 3 && b === client.next && c <= (room.members[0] === client ? 63 : 31)) {
      client.next++;
      this.send(peer, message);
    } else if (type === "C" && words.length === 3 && b % 60 === 59 && b < client.next && c <= 0xffffffff) {
      this.send(peer, message);
    } else if (type === "D" && words.length === 2 && room.members[0] === client && (b === 1 || b === 2)) {
      room.members[b - 1].wins++;
      this.reset(room, "D " + b);
      this.publish();
    }
  }

  private enter(client: Client, room: Room) {
    client.room = room;
    client.wins = 0;
    this.send(client, "P " + room.members.length);
    room.members.push(client);
    this.roomState(room);
    this.publish();
  }

  private leave(client: Client, disconnected = false) {
    const room = client.room;
    if (!room) return;
    client.room = undefined;
    client.ready = client.fighter = 0;
    room.members.splice(room.members.indexOf(client), 1);
    this.send(client, "L");
    if (room.members.length === 0) this.rooms.delete(room.id);
    else {
      this.reset(room, disconnected ? "O" : "Q leave");
      this.send(room.members[0], "P 0");
    }
    this.publish();
  }

  private reset(room: Room, message: string) {
    room.phase = "room";
    for (const client of room.members) {
      client.ready = client.fighter = 0;
      client.hover = 1;
    }
    this.broadcast(room, message);
    this.roomState(room);
  }

  private roomState(room: Room) {
    this.broadcast(room, ["R", room.members.length - 1, room.stage, room.members[0].ready, room.members[1]?.ready ?? 0, room.rounds].join(" "));
  }

  private broadcast(room: Room, message: string) {
    for (const client of room.members) this.send(client, message);
  }

  private send(client: Client, message: string) {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(message);
  }

  private publish(clients: Iterable<Client> = this.clients) {
    const rooms = Array.from(this.rooms.values(), (room) => ({
      id: room.id,
      players: room.members.map(({ identity, wins }) => ({ ...identity, wins })),
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
    // A new protocol or placement hint needs a new lobby instance.
    const lobby = env.GYOKURO_LOBBY.getByName(socketPath + "/apac", { locationHint: "apac" });
    return lobby.fetch(new Request(request, { headers }));
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
