import { DurableObject } from "cloudflare:workers";
import { getCurrentUser } from "../app/.server/auth/current-user";
import { getPublishedArchiveDownloadRecord } from "../app/.server/db/archive-downloads";
import { createRuntime } from "../app/.server/runtime";
import { getUserAvatarSrc } from "../lib/user-profile";
import { stagingNetplayEdgeOrigin, stagingNetplaySiteOrigin } from "../lib/archive/netplay-ingress";
import { json } from "../lib/http";
import { requestJsonValue } from "../lib/ui/api-response";
import { iceCandidateTypes, parseIceStats } from "./netplay-ice-stats";
import { parseNetplayDiagnostic } from "../scripts/netplay-diagnostics.mjs";
import { createRoomPassword, parseJoinPassword, parseRoomPassword } from "../scripts/netplay-room-password.mjs";
import type { RoomPassword } from "../scripts/netplay-room-password.mjs";

const standardStunUrls = ["stun:stun.cloudflare.com:3478", "stun:stun.nextcloud.com:443"];
const directIceServers = [{ urls: standardStunUrls }];
const stagingIceServers = [{ urls: ["stun:stun.hitv.com:3478", ...standardStunUrls] }];
// Staging Chrome nominated the slower UDP relay when both were offered.
const relayUrl = "turns:turn.cloudflare.com:443?transport=tcp";
const heartbeatIntervalMs = 5_000;
const heartbeatHideMs = 10_000;
const heartbeatTimeoutMs = 15_000;
const iceCandidateTypeSet = new Set<string>(iceCandidateTypes);
const iceStatsPrefix = "rtc:ice-stats:";
const rtcRoundPrefix = "rtc:round:";
const rtcMilestones = new Set([
  "peer_created", "peer_create_failed", "peer_connection_failed", "channel_create_failed",
  "local_description", "local_description_failed", "remote_description", "remote_description_failed", "remote_candidate_failed",
  "candidate_host", "candidate_srflx", "candidate_prflx", "candidate_relay", "gathering_complete", "stun_unreachable", "stun_error",
  "ice_checking", "ice_connected", "ice_completed", "ice_disconnected", "ice_failed",
  "channel_open", "channel_closed", "channel_error", "invalid_signal",
  "relay_probe_ok", "relay_probe_slow", "relay_probe_timeout",
]);
type Identity = { name: string; avatar: string };
type DisconnectReason = "socket_close" | "socket_error" | "heartbeat_timeout" | "rtc_failed";
type RtcReason = "connected" | "client_failure" | "timeout" | "turn_unavailable";
type Heartbeat = {
  lastPong: number;
  probe: ReturnType<typeof setInterval>;
  deadline?: ReturnType<typeof setTimeout>;
  reset: (now: number) => void;
};
type RtcProgress = {
  milestones: Map<string, number>;
  signals: number;
  oversizedSignals: number;
  icePair?: { localCandidateType: string; remoteCandidateType: string; protocol: "udp" | "tcp" };
  icePairLogged?: boolean;
  iceStatsPhases?: Set<string>;
};
type Negotiation = {
  route: "pending" | "webrtc" | "websocket";
  ready: Set<WebSocket>;
  progress: Map<WebSocket, RtcProgress>;
  startedAt: number;
  scoped: boolean;
  turn: "disabled" | "preparing" | "enabled" | "unavailable";
  turnSetupMs?: number;
  timeout: ReturnType<typeof setTimeout>;
};
type Room = {
  details: { archiveVersionId: number; roomId: number; pool: "rtc" | "legacy" };
  peers: Map<WebSocket, {
    identity: Identity;
    rtc: boolean;
    relayProbe: boolean;
    roomAccess: boolean;
    seatNumber: number;
    heartbeat?: Heartbeat;
  }>;
  password: RoomPassword;
  hidden: boolean;
  ready?: { socket: WebSocket; packet: ArrayBuffer };
  rtc?: Negotiation;
};

function isDirectMatch(room: Room) {
  return room.peers.size === 2 && room.rtc?.route === "webrtc" && room.rtc.turn === "disabled";
}

type NetplayEnvironment = CloudflareEnv & { NETPLAY_TURN_KEY_ID?: string; NETPLAY_TURN_KEY?: string };

async function createTurnServer(id: string, token: string): Promise<RTCIceServer | undefined> {
  try {
    const { iceServers } = await requestJsonValue<{ iceServers?: RTCIceServer[] }>(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 3600 }),
        signal: AbortSignal.timeout(1200),
      },
    );
    const credentials = iceServers?.find(server =>
      typeof server.username === "string" && server.username &&
      typeof server.credential === "string" && server.credential
    );
    if (credentials) return { urls: relayUrl, username: credentials.username, credential: credentials.credential };
  } catch {
    // If credential issuance is unavailable, both seats can still attempt direct ICE.
  }
}

export class NetplayRoom extends DurableObject<NetplayEnvironment> {
  private rooms = new Map<number, Room>();
  private directory = new Map<WebSocket, Identity>();

  private isRoomStale(room: Room, now: number) {
    const checkHeartbeat = !isDirectMatch(room);
    for (const [socket, { heartbeat }] of room.peers) {
      if (socket.readyState !== WebSocket.OPEN ||
          (checkHeartbeat && heartbeat && now - heartbeat.lastPong >= heartbeatHideMs)) return true;
    }
    return false;
  }

  private list() {
    const now = Date.now();
    const rooms = [];
    for (const [id, room] of this.rooms) {
      if (!this.isRoomStale(room, now)) rooms.push({ id, players: Array.from(room.peers.values(), ({ identity }) => identity), locked: room.password.enabled });
    }
    return rooms;
  }

  private publishDirectory() {
    const rooms = this.list();
    const online = this.directory.size;
    for (const [socket, identity] of this.directory) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ rooms, identity, online }));
    }
  }

  private refreshVisibility(room: Room, now: number) {
    const hidden = this.isRoomStale(room, now);
    if (room.hidden === hidden) return;
    room.hidden = hidden;
    this.publishDirectory();
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
      socket.addEventListener("message", ({ data }) => {
        if (data === "directory:ping" && socket.readyState === WebSocket.OPEN) socket.send("directory:pong");
      });
      this.publishDirectory();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    const roomAccess = url.searchParams.get("roomAccess") === "1";
    if (!roomAccess) {
      const error = this.joinError(url, null);
      if (error) return new Response(null, { status: error === "closed" ? 404 : error === "full" ? 409 : 403 });
    }
    const pair = new WebSocketPair();
    const socket = pair[1];
    socket.binaryType = "arraybuffer";
    socket.accept();
    if (roomAccess) {
      const timer = setTimeout(() => socket.close(1008), 5_000);
      socket.addEventListener("close", () => clearTimeout(timer), { once: true });
      socket.addEventListener("message", ({ data }) => {
        clearTimeout(timer);
        const entry = parseJoinPassword(data);
        if (!entry) {
          socket.close(1008);
          return;
        }
        this.joinRoom(request, url, socket, entry.code);
      }, { once: true });
    } else {
      this.joinRoom(request, url, socket, null);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private joinError(url: URL, code: string | null) {
    const id = Number(url.pathname.slice(url.pathname.lastIndexOf("/") + 1));
    const mode = url.searchParams.get("mode");
    const room = this.rooms.get(id);
    if (mode === "join" && (!room || this.isRoomStale(room, Date.now()))) return "closed";
    if (room && (room.peers.size === 2 || mode === "create" || this.isRoomStale(room, Date.now()))) return "full";
    if (room?.password.enabled && code !== room.password.code) return code === null ? "password_required" : "password_incorrect";
  }

  private sendRoomSettings(room: Room) {
    const settings = "room:settings:" + JSON.stringify(room.password);
    for (const [peer, state] of room.peers) {
      if (state.roomAccess && peer.readyState === WebSocket.OPEN) peer.send(settings);
    }
  }

  private joinRoom(request: Request, url: URL, socket: WebSocket, code: string | null) {
    const path = url.pathname;
    const id = Number(path.slice(path.lastIndexOf("/") + 1));
    const diagnostics = url.searchParams.get("diagnostics") === "1";
    const error = this.joinError(url, code);
    if (error) {
      socket.send("room:rejected:" + error);
      socket.close(1000);
      return;
    }
    const existing = this.rooms.get(id);
    const [, , , , archive, pool] = path.split("/");
    const room: Room = existing ?? {
      details: { archiveVersionId: Number(archive), roomId: id, pool: pool === "rtc" ? "rtc" : "legacy" },
      peers: new Map(),
      hidden: false,
      password: createRoomPassword(),
    };
    const { peers } = room;
    const first = peers.keys().next().value;

    if (diagnostics) socket.send("room:diagnostics:1");
    const identity = JSON.parse(decodeURIComponent(request.headers.get("X-Netplay-Identity")!)) as Identity;
    const disconnect = (reason: DisconnectReason, closeCode?: number) => {
      if (!peers.has(socket)) return;
      const seats = peers.size;
      const wasDirect = isDirectMatch(room);
      const negotiationStartedAt = room.rtc?.startedAt;
      const route = room.rtc?.route ?? (seats === 2 ? "websocket" : undefined);
      const seat = socket === peers.keys().next().value ? 1 : 2;
      // Either peer can observe a failed data channel. Release both seats without guessing which side failed.
      const leaving = reason === "rtc_failed" ? [...peers.keys()] : [socket];
      for (const peer of leaving) {
        const heartbeat = peers.get(peer)?.heartbeat;
        if (heartbeat) {
          clearInterval(heartbeat.probe);
          clearTimeout(heartbeat.deadline);
        }
        peers.delete(peer);
      }
      room.ready = undefined;
      if (room.rtc) clearTimeout(room.rtc.timeout);
      room.rtc = undefined;
      if (peers.size === 0) this.rooms.delete(id);
      else {
        const [remaining, { heartbeat }] = peers.entries().next().value!;
        if (wasDirect) heartbeat?.reset(Date.now());
        if (remaining.readyState === WebSocket.OPEN) remaining.send("2");
      }
      room.hidden = this.isRoomStale(room, Date.now());
      this.publishDirectory();
      console.log({ event: "netplay_reclaim", ...room.details, reason, route, negotiationStartedAt, seat, seats, released: leaving.length, closeCode });
      for (const peer of leaving) peer.close(1000);
    };
    const resetHeartbeat = (now: number) => {
      if (!heartbeat) return;
      heartbeat.lastPong = now;
      clearTimeout(heartbeat.deadline);
      heartbeat.deadline = setTimeout(() => {
        const now = Date.now();
        this.refreshVisibility(room, now);
        heartbeat.deadline = setTimeout(() => disconnect("heartbeat_timeout"), heartbeat.lastPong + heartbeatTimeoutMs - now);
      }, heartbeatHideMs);
    };
    const heartbeat: Heartbeat | undefined = url.searchParams.get("heartbeat") === "1" ? {
      lastPong: Date.now(),
      reset: resetHeartbeat,
      probe: setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("room:ping");
        else disconnect("socket_close");
      }, heartbeatIntervalMs),
    } : undefined;
    const renewHeartbeat = () => {
      if (!heartbeat || isDirectMatch(room)) return;
      const now = Date.now();
      if (now - heartbeat.lastPong >= heartbeatTimeoutMs) {
        disconnect("heartbeat_timeout");
        return;
      }
      resetHeartbeat(now);
      if (room.hidden) this.refreshVisibility(room, now);
    };
    peers.set(socket, {
      identity, rtc: url.searchParams.get("rtc") === "1", relayProbe: url.searchParams.get("rtcProbe") === "2", heartbeat,
      seatNumber: first ? 2 : 1, roomAccess: url.searchParams.get("roomAccess") === "1",
    });
    this.rooms.set(id, room);
    this.sendRoomSettings(room);
    renewHeartbeat();
    socket.addEventListener("message", ({ data }) => {
      if (!peers.has(socket)) return;
      const rtc = room.rtc;
      if (typeof data === "string") {
        if (data.startsWith("room:password:")) {
          if (socket !== peers.keys().next().value) return;
          const password = parseRoomPassword(data.slice(14));
          if (!password) return;
          room.password = password;
          this.sendRoomSettings(room);
          this.publishDirectory();
          return;
        }
        if (diagnostics && data.startsWith("room:diagnostic:")) {
          const diagnostic = parseNetplayDiagnostic(data);
          if (diagnostic) console.log({
            ...diagnostic, event: "netplay_stall", ...room.details,
            seat: peers.get(socket)!.seatNumber, route: rtc?.route ?? "websocket",
          });
          return;
        }
        if (data === "room:pong" && heartbeat) {
          renewHeartbeat();
          return;
        }
        if (data.startsWith(rtcRoundPrefix)) {
          const end = data.indexOf(":", rtcRoundPrefix.length);
          if (!rtc?.scoped || end === -1 || data.slice(rtcRoundPrefix.length, end) !== String(rtc.startedAt)) return;
          data = "rtc:" + data.slice(end + 1);
        } else if (rtc?.scoped && data.startsWith("rtc:") && !data.startsWith(iceStatsPrefix)) {
          return;
        }
        if (data === "rtc:fail" && rtc?.route === "webrtc") {
          disconnect("rtc_failed");
          return;
        }
        if (rtc && data.startsWith(iceStatsPrefix)) {
          const snapshot = parseIceStats(data.slice(iceStatsPrefix.length));
          if (!snapshot || snapshot.negotiationStartedAt !== rtc.startedAt) return;
          if (snapshot.phase === "connected" && rtc.route !== "webrtc") return;
          if (snapshot.phase === "fallback" && rtc.route !== "websocket") return;
          const progress = rtc.progress.get(socket)!;
          const phases = progress.iceStatsPhases ??= new Set();
          if (phases.has(snapshot.phase)) return;
          phases.add(snapshot.phase);
          console.log({
            event: "netplay_ice_stats", ...room.details,
            seat: socket === peers.keys().next().value ? 1 : 2,
            route: rtc.route, ...snapshot,
          });
          return;
        }
        if (rtc && rtc.route !== "websocket" && data.startsWith("rtc:ice-pair:")) {
          const progress = rtc.progress.get(socket)!;
          if (progress.icePairLogged || data.length > 40) return;
          const value = data.slice("rtc:ice-pair:".length);
          const [phase, localCandidateType, remoteCandidateType, protocol, extra] = value.split(":");
          if (phase !== rtc.route) return;
          const pair: RtcProgress["icePair"] = iceCandidateTypeSet.has(localCandidateType) && iceCandidateTypeSet.has(remoteCandidateType) &&
            (protocol === "udp" || protocol === "tcp") && extra === undefined
            ? { localCandidateType, remoteCandidateType, protocol } : undefined;
          if (rtc.route === "pending") {
            if (pair) progress.icePair = pair;
            return;
          }
          if (!pair && value !== "webrtc:unavailable") return;
          progress.icePairLogged = true;
          console.log({
            event: "netplay_ice_pair", ...room.details, negotiationStartedAt: rtc.startedAt,
            seat: socket === peers.keys().next().value ? 1 : 2,
            ...(pair ? { status: "selected", ...pair } : { status: "unavailable" }),
          });
          return;
        }
        if (rtc?.route !== "pending") return;
        const progress = rtc.progress.get(socket)!;
        if (rtc.turn === "enabled" && /^rtc:probe:(ping|pong):[01]$/.test(data)) {
          for (const peer of peers.keys()) if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(data);
        } else if (data === "rtc:ready") {
          rtc.ready.add(socket);
          if (rtc.ready.size === 2) this.selectRoute(room, "connected");
        } else if (data === "rtc:fail") {
          this.selectRoute(room, "client_failure", socket);
        } else if (data.startsWith("rtc:diag:")) {
          const milestone = data.slice("rtc:diag:".length);
          if (rtcMilestones.has(milestone) && !progress.milestones.has(milestone)) {
            progress.milestones.set(milestone, Date.now() - rtc.startedAt);
          }
        } else if (data.startsWith("rtc:signal:")) {
          if (data.length <= 24576) {
            progress.signals++;
            for (const peer of peers.keys()) if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(data);
          } else {
            progress.oversizedSignals++;
          }
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
    socket.addEventListener("close", (event) => disconnect("socket_close", event.code));
    socket.addEventListener("error", () => disconnect("socket_error"));
    if (first) {
      peers.get(first)!.seatNumber = 1;
      if (peers.get(first)?.rtc && peers.get(socket)?.rtc) {
        this.startNegotiation(room, first, socket);
      } else {
        console.log({ event: "netplay_route", ...room.details, route: "websocket", reason: "rtc_unavailable" });
        first.send("3");
        socket.send("4");
      }
    } else {
      socket.send("2");
    }
    this.publishDirectory();
  }

  private startNegotiation(room: Room, first: WebSocket, second: WebSocket, turn?: { id: string; token: string }) {
    const startedAt = Math.max(Date.now(), (room.rtc?.startedAt ?? 0) + 1);
    const scoped = Boolean(room.peers.get(first)?.relayProbe && room.peers.get(second)?.relayProbe);
    const rtc: Negotiation = room.rtc = {
      route: "pending",
      ready: new Set(),
      progress: new Map([first, second].map(peer => [peer, { milestones: new Map(), signals: 0, oversizedSignals: 0 }])),
      startedAt,
      scoped,
      turn: turn ? "preparing" : "disabled",
      timeout: setTimeout(() => this.selectRoute(room, "timeout"), turn ? 5000 : 8000),
    };
    const send = (peer: WebSocket, offer: boolean, relay?: RTCIceServer) => {
      const stun = this.env.APP_ORIGIN === stagingNetplaySiteOrigin ? stagingIceServers : directIceServers;
      peer.send("rtc:start:" + JSON.stringify({
        iceServers: relay ? [relay] : stun, offer, negotiationStartedAt: startedAt, scoped,
        relayOnly: Boolean(relay),
      }));
    };
    if (!turn) {
      send(first, true);
      send(second, false);
      return;
    }
    void Promise.all([createTurnServer(turn.id, turn.token), createTurnServer(turn.id, turn.token)]).then(([a, b]) => {
      if (room.rtc !== rtc || rtc.route !== "pending") return;
      if (first.readyState !== WebSocket.OPEN || second.readyState !== WebSocket.OPEN) return;
      rtc.turnSetupMs = Date.now() - startedAt;
      if (!a || !b) {
        rtc.turn = "unavailable";
        this.selectRoute(room, "turn_unavailable");
        return;
      }
      rtc.turn = "enabled";
      send(first, true, a);
      send(second, false, b);
    });
  }

  private selectRoute(room: Room, reason: RtcReason, reporter?: WebSocket) {
    const rtc = room.rtc;
    const [first, second] = room.peers.keys();
    if (rtc?.route !== "pending" || first?.readyState !== WebSocket.OPEN || second?.readyState !== WebSocket.OPEN) return;
    clearTimeout(rtc.timeout);
    const { NETPLAY_TURN_KEY_ID: id, NETPLAY_TURN_KEY: token } = this.env;
    if (reason !== "connected" && rtc.turn === "disabled" && rtc.scoped && id && token &&
        this.env.APP_ORIGIN !== stagingNetplaySiteOrigin) {
      this.logNegotiation(room, rtc, "netplay_direct_attempt", reason, reporter);
      this.startNegotiation(room, first, second, { id, token });
      return;
    }
    const route = reason === "connected" ? "webrtc" : "websocket";
    rtc.route = route;
    if (isDirectMatch(room)) {
      for (const { heartbeat } of room.peers.values()) clearTimeout(heartbeat?.deadline);
      this.refreshVisibility(room, Date.now());
    }
    this.logNegotiation(room, rtc, "netplay_route", reason, reporter);
    first.send("rtc:" + route);
    second.send("rtc:" + route);
    first.send("3");
    second.send("4");
  }

  private logNegotiation(room: Room, rtc: Negotiation, event: string, reason: RtcReason, reporter?: WebSocket) {
    const [first, second] = room.peers.keys();
    console.log({
      event, ...room.details, route: rtc.route, reason, negotiationStartedAt: rtc.startedAt,
      negotiationMs: Date.now() - rtc.startedAt,
      turn: rtc.turn, turnSetupMs: rtc.turnSetupMs,
      failedSeat: reporter === first ? 1 : reporter === second ? 2 : undefined,
      peers: Array.from(rtc.progress, ([socket, progress], index) => ({
        seat: index + 1,
        ready: rtc.ready.has(socket),
        signals: progress.signals,
        oversizedSignals: progress.oversizedSignals,
        milestones: [...progress.milestones.keys()],
        milestoneMs: Object.fromEntries(progress.milestones),
        icePair: progress.icePair,
      })),
    });
  }
}

export async function maybeHandleNetplayRoom(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/netplay/v1/")) return;
  const route = /^\/api\/netplay\/v1\/([1-9]\d*)\/(rtc\/)?(rooms|[1-9]\d{0,5})$/.exec(url.pathname);
  if (!route || !env.NETPLAY_ROOM) return new Response(null, { status: 404 });
  const [, archive, rtc, target] = route;
  const archiveVersionId = Number(archive);
  if (!Number.isSafeInteger(archiveVersionId)) return new Response(null, { status: 404 });
  const directory = target === "rooms";
  if (rtc && !directory && url.searchParams.get("rtc") !== "1") return new Response(null, { status: 404 });
  const websocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
  if (request.method !== "GET" || (!directory && !websocket)) {
    return new Response(null, { status: 426 });
  }
  const runtime = createRuntime(request, env, ctx, import.meta.env.DEV);
  const origin = request.headers.get("Origin");
  const stagingEdge = runtime.origin === stagingNetplaySiteOrigin && url.origin === stagingNetplayEdgeOrigin;
  if ((!stagingEdge && url.origin !== runtime.origin) ||
      ((websocket || origin !== null) && origin !== runtime.origin)) {
    return new Response(null, { status: 403 });
  }
  const record = await getPublishedArchiveDownloadRecord(runtime, archiveVersionId, true);
  if (!record?.netplayService) return new Response(null, { status: 404 });
  const pool = rtc ? `v1/${archiveVersionId}/rtc` : `v1/${archiveVersionId}`;
  const rooms = env.NETPLAY_ROOM.getByName(pool);
  if (directory && !websocket) {
    const response = await rooms.fetch(request);
    if (!stagingEdge) return response;
    const edgeResponse = new Response(response.body, response);
    edgeResponse.headers.set("Access-Control-Allow-Origin", stagingNetplaySiteOrigin);
    return edgeResponse;
  }

  const user = stagingEdge ? null : await getCurrentUser(runtime);
  const guest = url.searchParams.get("guest");
  const identity: Identity = {
    name: user?.displayName ?? "访客 " + (guest && /^[0-9a-f]{4}$/.test(guest) ? guest : crypto.randomUUID().slice(0, 4)),
    avatar: getUserAvatarSrc(user?.avatarBlobSha256),
  };
  const headers = new Headers(request.headers);
  headers.set("X-Netplay-Identity", encodeURIComponent(JSON.stringify(identity)));
  return rooms.fetch(new Request(request, { headers }));
}
