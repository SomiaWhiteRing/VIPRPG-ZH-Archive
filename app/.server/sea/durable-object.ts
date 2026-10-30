import { DurableObject } from "cloudflare:workers";
import { SEA_ROOM_LIMIT, type SeaAvatarMode, type SeaMessage, type SeaModeration, type SeaSubmission, type SeaWindow } from "@/lib/dto/sea";
import { getUserAvatarSrc } from "@/lib/user-profile";
import { layoutSeaDialogue } from "@/lib/ui/eternal-sea";
import type { SeaActor } from "./identity";
import { createSeaFontState, seaFontCodec, seaFontDay, seaFontDeadline, type SeaFontState, type SeaOriginalMessage } from "./font";

type Row = { id: number; actor_key: string; user_id: number | null; name: string; body: string; avatar_mode: SeaAvatarMode; created_at: number; hidden_at: number | null };
type Profile = { id: number; display_name: string; avatar_blob_sha256: string | null; status: string };
type Fault = { ok: false; status: number; detail: string; code: string };
type Published = { ok: true; revision: number; font: SeaWindow["font"]; message: SeaMessage; repeated: boolean };
const fault = (status: number, detail: string, code: string): Fault => ({ ok: false, status, detail, code });

export class EternalSeaRoom extends DurableObject<CloudflareEnv> {
  private fontsTask?: { day: number; task: Promise<{ current: ReturnType<typeof seaFontCodec>; previous?: ReturnType<typeof seaFontCodec> }> };
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor_key TEXT NOT NULL,
        user_id INTEGER, name TEXT NOT NULL, body TEXT NOT NULL,
        avatar_mode TEXT NOT NULL CHECK(avatar_mode IN ('own','alex')),
        client_message_id TEXT NOT NULL, created_at INTEGER NOT NULL, hidden_at INTEGER,
        UNIQUE(actor_key,client_message_id)
      );
      CREATE INDEX IF NOT EXISTS messages_visible ON messages(id DESC) WHERE hidden_at IS NULL;
      CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta VALUES(1,0);
      CREATE TABLE IF NOT EXISTS rates (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL, last_sent INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mutes (actor_key TEXT PRIMARY KEY, message_id INTEGER NOT NULL, name TEXT NOT NULL, until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS moderation_log (id INTEGER PRIMARY KEY AUTOINCREMENT, operator_id INTEGER NOT NULL, action TEXT NOT NULL, message_id INTEGER NOT NULL, minutes INTEGER, created_at INTEGER NOT NULL);
    `);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private revision() {
    return this.ctx.storage.sql.exec<{ revision: number }>("SELECT revision FROM meta WHERE id=1").one().revision;
  }
  private fonts() {
    const day = seaFontDay(Date.now());
    if (this.fontsTask?.day !== day) {
      const task = this.ctx.storage.get<{ current: SeaFontState; previous?: SeaFontState }>("fonts").then(async stored => {
        if (stored?.current.day !== day) {
          stored = { current: createSeaFontState(day), previous: stored?.current.day === day - 1 ? stored.current : undefined };
          await this.ctx.storage.put("fonts", stored);
        }
        await this.ctx.storage.setAlarm(seaFontDeadline(day));
        return { current: seaFontCodec(stored.current), previous: stored.previous ? seaFontCodec(stored.previous) : undefined };
      }).catch(error => { this.fontsTask = undefined; throw error; });
      this.fontsTask = { day, task };
    }
    return this.fontsTask.task;
  }
  async font(id: string) {
    const { current, previous } = await this.fonts();
    const codec = [current, previous].find(item => item?.font.id === id);
    return codec?.bytes() ?? null;
  }
  async alarm() {
    this.broadcast({ type: "snapshot", ...await this.snapshot() });
  }
  private advance() {
    return this.ctx.storage.sql.exec<{ revision: number }>("UPDATE meta SET revision=revision+1 WHERE id=1 RETURNING revision").one().revision;
  }
  private row(id: number) {
    return this.ctx.storage.sql.exec<Row>("SELECT * FROM messages WHERE id=?", id).toArray()[0];
  }
  private async profiles(rows: Row[]) {
    const ids = [...new Set(rows.filter(r => r.user_id !== null).map(r => r.user_id!))];
    const profiles = ids.length
      ? (await this.env.DB.prepare(`SELECT id,display_name,avatar_blob_sha256,status FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<Profile>()).results
      : [];
    return new Map(profiles.map(user => [user.id, user]));
  }
  private decorate(rows: Row[], users: Map<number, Profile>): SeaOriginalMessage[] {
    return rows.map(row => {
      const user = row.user_id === null ? undefined : users.get(row.user_id);
      return {
        id: row.id, name: row.avatar_mode === "alex" ? "无名的VIPPER" : user?.status === "deleted" ? "账户已注销" : row.name,
        body: row.body, faceIndex: 0,
        avatarUrl: row.avatar_mode === "own" && user && user.status !== "deleted" ? getUserAvatarSrc(user.avatar_blob_sha256) : undefined,
        side: row.id % 2 ? "left" : "right", createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }
  async snapshot(): Promise<SeaWindow> {
    // Capture the revision and rows before awaiting profile lookups.
    const revision = this.revision();
    const rows = this.ctx.storage.sql.exec<Row>("SELECT * FROM messages WHERE hidden_at IS NULL ORDER BY id DESC LIMIT ?", SEA_ROOM_LIMIT).toArray().reverse();
    const { current } = await this.fonts();
    return { revision, font: current.font, messages: this.decorate(rows, await this.profiles(rows)).map(message => current.message(message)) };
  }
  async moderation(requestedPage = 1): Promise<SeaModeration> {
    const revision = this.revision();
    const total = this.ctx.storage.sql.exec<{ total: number }>("SELECT COUNT(*) AS total FROM messages").one().total;
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / SEA_ROOM_LIMIT)));
    const rows = this.ctx.storage.sql.exec<Row>("SELECT * FROM messages ORDER BY id DESC LIMIT ? OFFSET ?", SEA_ROOM_LIMIT, (page - 1) * SEA_ROOM_LIMIT).toArray();
    const users = await this.profiles(rows);
    return {
      window: { revision, messages: this.decorate(rows, users).map((message, index) => {
        const row = rows[index];
        const user = row.user_id === null ? undefined : users.get(row.user_id);
        return {
          ...message,
          authorName: user?.status === "deleted" ? "账户已注销" : user?.display_name ?? row.name,
          authorAvatarBlobSha256: user && user.status !== "deleted" ? user.avatar_blob_sha256 : null,
          anonymous: row.avatar_mode === "alex",
          hiddenAt: row.hidden_at,
        };
      }) },
      page, total,
      mutes: this.ctx.storage.sql.exec<{ message_id: number; name: string; until: number }>("SELECT message_id,name,until FROM mutes WHERE until>? ORDER BY until DESC", Date.now()).toArray()
        .map(row => ({ messageId: row.message_id, name: row.name, until: row.until })),
    };
  }
  async publish(actor: SeaActor, input: SeaSubmission): Promise<Published | Fault> {
    if (!input.body.trim() || !layoutSeaDialogue(actor.name, input.body).fits)
      return fault(400, "发言超出对话框容量", "sea_body_invalid");
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => {
      const old = this.ctx.storage.sql.exec<Row>("SELECT * FROM messages WHERE actor_key=? AND client_message_id=?", actor.key, input.clientMessageId).toArray()[0];
      if (old) {
        if (old.body !== input.body || old.avatar_mode !== input.avatarMode) return fault(409, "同一次提交的内容发生变化", "sea_request_conflict");
        return { row: old, revision: this.revision(), repeated: true };
      }
      if (this.ctx.storage.sql.exec("SELECT 1 FROM mutes WHERE actor_key=? AND until>?", actor.key, now).toArray().length)
        return fault(403, "当前身份暂时无法发言", "sea_muted");
      const window = Math.floor(now / 60000);
      for (const [key, maximum, interval] of [[actor.key, 20, 3000], [`ip:${actor.ipKey}`, 60, 0]] as const) {
        const rate = this.ctx.storage.sql.exec<{ window: number; count: number; last_sent: number }>("SELECT * FROM rates WHERE key=?", key).toArray()[0];
        if (rate && ((rate.window === window && rate.count >= maximum) || now - rate.last_sent < interval))
          return fault(429, "发言过于频繁，请稍后再试", "sea_rate_limited");
      }
      this.ctx.storage.sql.exec("DELETE FROM rates WHERE window<?", window - 2);
      this.ctx.storage.sql.exec("DELETE FROM mutes WHERE until<=?", now);
      for (const key of [actor.key, `ip:${actor.ipKey}`]) {
        this.ctx.storage.sql.exec(`INSERT INTO rates VALUES(?,?,1,?)
          ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window,last_sent=excluded.last_sent`, key, window, now);
      }
      const id = this.ctx.storage.sql.exec<{ id: number }>("INSERT INTO messages(actor_key,user_id,name,body,avatar_mode,client_message_id,created_at) VALUES(?,?,?,?,?,?,?) RETURNING id",
        actor.key, actor.userId, actor.name, input.body, input.avatarMode, input.clientMessageId, now).one().id;
      return { row: this.row(id)!, revision: this.advance(), repeated: false };
    });
    if ("ok" in result) return result;
    const { current } = await this.fonts();
    const message = current.message(this.decorate([result.row], await this.profiles([result.row]))[0]);
    if (!result.repeated) this.broadcast({ type: "message", revision: result.revision, font: current.font, message });
    return { ok: true, revision: result.revision, font: current.font, message, repeated: result.repeated };
  }
  async hide(id: number, operatorId: number) {
    const found = this.ctx.storage.transactionSync(() => {
      if (!this.row(id)) return false;
      const changed = this.ctx.storage.sql.exec("UPDATE messages SET hidden_at=? WHERE id=? AND hidden_at IS NULL RETURNING id", Date.now(), id).toArray().length;
      if (changed) {
        this.advance();
        this.ctx.storage.sql.exec("INSERT INTO moderation_log(operator_id,action,message_id,created_at) VALUES(?,'hide',?,?)", operatorId, id, Date.now());
      }
      return true;
    });
    if (found) this.broadcast({ type: "snapshot", ...await this.snapshot() });
    return found;
  }
  mute(id: number, minutes: number, operatorId: number) {
    return this.ctx.storage.transactionSync(() => {
      const row = this.row(id);
      if (!row) return false;
      if (!minutes) this.ctx.storage.sql.exec("DELETE FROM mutes WHERE actor_key=?", row.actor_key);
      else this.ctx.storage.sql.exec("INSERT INTO mutes VALUES(?,?,?,?) ON CONFLICT(actor_key) DO UPDATE SET message_id=excluded.message_id,name=excluded.name,until=excluded.until",
        row.actor_key, id, row.name, Date.now() + minutes * 60000);
      this.ctx.storage.sql.exec("INSERT INTO moderation_log(operator_id,action,message_id,minutes,created_at) VALUES(?,'mute',?,?,?)", operatorId, id, minutes, Date.now());
      return true;
    });
  }
  private broadcast(event: unknown) {
    const text = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(text); } catch { this.close(socket, 1011, "连接已失效"); }
    }
  }
  private close(socket: WebSocket, code: number, reason: string) {
    try { socket.close(code, reason); }
    catch { /* A disconnected peer must not interrupt broadcasts or storage results. */ }
  }
  async fetch(request: Request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("需要 WebSocket", { status: 426 });
    const ip = request.headers.get("X-Sea-IP");
    if (!ip || !/^[A-Za-z0-9_-]{43}$/.test(ip)) return new Response("访问来源无效", { status: 403 });
    if (this.ctx.getWebSockets(ip).length >= 20 || this.ctx.getWebSockets().length >= 1000)
      return new Response("连接过多", { status: 429 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [ip]);
    this.ctx.waitUntil(this.snapshot().then(snapshot => pair[1].send(JSON.stringify({ type: "snapshot", ...snapshot }))).catch(() => this.close(pair[1], 1011, "同步失败")));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(socket: WebSocket) { this.close(socket, 1008, "请通过发言接口提交"); }
  webSocketClose(socket: WebSocket) { this.close(socket, 1000, "连接已结束"); }
  webSocketError(socket: WebSocket) { this.close(socket, 1011, "连接已失效"); }
}
