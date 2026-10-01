import { DurableObject } from "cloudflare:workers";
import { VIEW_DAY_MS, VIEW_DAY_OFFSET_MS, viewDay, type StatKind, type ViewKind } from "@/lib/view-stats";

const MAX_IDS = 128;
const CLEANUP_BATCH = 5000;

function target(kind: StatKind, id: number) {
  if ((kind !== "work" && kind !== "topic" && kind !== "play") || !Number.isSafeInteger(id) || id <= 0)
    throw new Error("Invalid view target");
}

export class ViewStats extends DurableObject<CloudflareEnv> {
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS totals (
        kind TEXT NOT NULL, id INTEGER NOT NULL, count INTEGER NOT NULL,
        PRIMARY KEY (kind,id)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS days (day INTEGER PRIMARY KEY, salt BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS seen (
        day INTEGER NOT NULL, kind TEXT NOT NULL, id INTEGER NOT NULL, visitor BLOB NOT NULL,
        PRIMARY KEY (day,kind,id,visitor)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS applied_merges (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS play_users (
        id INTEGER NOT NULL, user_id INTEGER NOT NULL,
        PRIMARY KEY (id,user_id)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS play_user_initializations (id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS play_visitors (
        day INTEGER NOT NULL, id INTEGER NOT NULL, visitor BLOB NOT NULL, expires_at INTEGER NOT NULL,
        PRIMARY KEY (day,id,visitor)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS play_visitors_expiry ON play_visitors(expires_at);
    `);
  }

  async record(kind: ViewKind, id: number, site: string, ip: string, userAgent: string) {
    target(kind, id);
    if (!ip || ip.length > 64 || !userAgent || userAgent.length > 1024 || site.length > 256)
      throw new Error("Invalid view identity");
    // Keep salt creation, hashing and the unique insert in one serialized event.
    await this.ctx.blockConcurrencyWhile(async () => {
      const day = viewDay();
      const visitor = await this.#visitor(day, site, ip, userAgent, true);
      this.ctx.storage.transactionSync(() => {
        const inserted = this.ctx.storage.sql.exec(
          "INSERT OR IGNORE INTO seen(day,kind,id,visitor) VALUES(?,?,?,?) RETURNING id",
          day, kind, id, visitor,
        ).toArray().length;
        if (inserted) this.ctx.storage.sql.exec(
          `INSERT INTO totals(kind,id,count) VALUES(?,?,1)
           ON CONFLICT(kind,id) DO UPDATE SET count=count+1`, kind, id,
        );
      });
    });
  }

  initializePlayUsers(id: number, userIds: number[], initialCount: number) {
    target("play", id);
    if (!Number.isSafeInteger(initialCount) || initialCount < 0 ||
        userIds.some((userId) => !Number.isSafeInteger(userId) || userId <= 0))
      throw new Error("Invalid initial play users");
    this.ctx.storage.transactionSync(() => {
      if (this.#playUsersInitialized(id)) return;
      this.#seedPlays([id], { [id]: initialCount });
      this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO play_users(id,user_id)
        SELECT ?,value FROM json_each(?)`, id, JSON.stringify(userIds));
      this.ctx.storage.sql.exec("INSERT INTO play_user_initializations(id) VALUES(?)", id);
    });
  }

  async recordPlay(id: number, site: string, ip: string, userAgent: string, userId: number | null): Promise<boolean> {
    target("play", id);
    if (userId !== null && (!Number.isSafeInteger(userId) || userId <= 0)) throw new Error("Invalid play user");
    if (!ip || ip.length > 64 || !userAgent || userAgent.length > 1024 || site.length > 256)
      throw new Error("Invalid play identity");
    return this.ctx.blockConcurrencyWhile(async () => {
      // Request the legacy account IDs once, before any new history can be written.
      if (!this.#playUsersInitialized(id)) return false;
      const now = Date.now();
      const day = viewDay(now);
      const visitor = userId === null ? await this.#visitor(day, site, ip, userAgent, true) : null;
      const previous = userId === null ? await this.#visitor(day - 1, site, ip, userAgent, false) : null;
      return this.ctx.storage.transactionSync(() => {
        let inserted: number;
        if (userId !== null) {
          inserted = this.ctx.storage.sql.exec(
            "INSERT OR IGNORE INTO play_users(id,user_id) VALUES(?,?) RETURNING id", id, userId,
          ).toArray().length;
        } else {
          const alreadySeen = this.ctx.storage.sql.exec(`SELECT 1 FROM play_visitors
            WHERE id=? AND expires_at>? AND ((day=? AND visitor=?) OR (day=? AND visitor=?)) LIMIT 1`,
            id, now, day, visitor, day - 1, previous).toArray().length;
          if (alreadySeen) return true;
          inserted = this.ctx.storage.sql.exec(`INSERT INTO play_visitors(day,id,visitor,expires_at) VALUES(?,?,?,?)
            ON CONFLICT(day,id,visitor) DO UPDATE SET expires_at=excluded.expires_at RETURNING id`,
            day, id, visitor, now + VIEW_DAY_MS).toArray().length;
        }
        if (inserted) this.ctx.storage.sql.exec("UPDATE totals SET count=count+1 WHERE kind='play' AND id=?", id);
        return true;
      });
    });
  }

  #playUsersInitialized(id: number): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 FROM play_user_initializations WHERE id=?", id).toArray().length > 0;
  }

  async #visitor(day: number, site: string, ip: string, userAgent: string, create: boolean): Promise<ArrayBuffer | null> {
    let salt = this.ctx.storage.sql.exec<{ salt: ArrayBuffer }>("SELECT salt FROM days WHERE day=?", day).toArray()[0]?.salt;
    if (!salt) {
      if (!create) return null;
      // Arm cleanup before persisting identity data, including on a cold start.
      if (await this.ctx.storage.getAlarm() === null)
        await this.ctx.storage.setAlarm((day + 2) * VIEW_DAY_MS - VIEW_DAY_OFFSET_MS);
      salt = crypto.getRandomValues(new Uint8Array(32)).buffer;
      this.ctx.storage.sql.exec("INSERT INTO days(day,salt) VALUES(?,?)", day, salt);
    }
    const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify([site, ip, userAgent])));
  }

  counts(kind: StatKind, ids: number[], initialCounts: Record<number, number> = {}): Record<number, number> {
    if (ids.length > MAX_IDS) throw new Error("Too many view targets");
    for (const id of ids) target(kind, id);
    if (kind === "play") this.#seedPlays(ids, initialCounts);
    const rows = this.ctx.storage.sql.exec<{ id: number; count: number }>(
      "SELECT id,count FROM totals WHERE kind=? AND id IN (SELECT value FROM json_each(?))",
      kind, JSON.stringify(ids),
    ).toArray();
    const result: Record<number, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const row of rows) result[row.id] = row.count;
    return result;
  }

  rankWorks(ids: number[], limit: number, offset: number, kind: "work" | "play" = "work", initialCounts: Record<number, number> = {}): Array<{ id: number; count: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0)
      throw new Error("Invalid view ranking page");
    for (const id of ids) target(kind, id);
    if (kind === "play") this.#seedPlays(ids, initialCounts);
    // D1 supplies the complete filtered ID set; return only this page of counts.
    // LEFT JOIN keeps works with no recorded activity in the same stable ordering.
    return this.ctx.storage.sql.exec<{ id: number; count: number }>(
      `SELECT candidate.value AS id,COALESCE(t.count,0) AS count
       FROM json_each(?) candidate LEFT JOIN totals t ON t.kind=? AND t.id=candidate.value
       ORDER BY COALESCE(t.count,0) DESC,candidate.value DESC LIMIT ? OFFSET ?`,
      JSON.stringify(ids), kind, limit, offset,
    ).toArray();
  }

  mergeWorks(operation: number, source: number, destination: number) {
    target("work", source);
    target("work", destination);
    if (!Number.isSafeInteger(operation) || operation <= 0 || source === destination)
      throw new Error("Invalid view merge");
    this.ctx.storage.transactionSync(() => {
      if (!this.ctx.storage.sql.exec("INSERT OR IGNORE INTO applied_merges(id) VALUES(?) RETURNING id", operation).toArray().length)
        return;
      for (const kind of ["work", "play"]) {
        this.ctx.storage.sql.exec(`INSERT INTO totals(kind,id,count)
          SELECT kind,?,count FROM totals WHERE kind=? AND id=?
          ON CONFLICT(kind,id) DO UPDATE SET count=count+excluded.count`, destination, kind, source);
        this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO seen(day,kind,id,visitor)
          SELECT day,kind,?,visitor FROM seen WHERE kind=? AND id=?`, destination, kind, source);
        this.ctx.storage.sql.exec("DELETE FROM totals WHERE kind=? AND id=?", kind, source);
        this.ctx.storage.sql.exec("DELETE FROM seen WHERE kind=? AND id=?", kind, source);
      }
      this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO play_users(id,user_id)
        SELECT ?,user_id FROM play_users WHERE id=?`, destination, source);
      this.ctx.storage.sql.exec(`INSERT INTO play_visitors(day,id,visitor,expires_at)
        SELECT day,?,visitor,expires_at FROM play_visitors WHERE id=?
        ON CONFLICT(day,id,visitor) DO UPDATE SET expires_at=MAX(play_visitors.expires_at,excluded.expires_at)`, destination, source);
      this.ctx.storage.sql.exec("DELETE FROM play_users WHERE id=?", source);
      this.ctx.storage.sql.exec("DELETE FROM play_visitors WHERE id=?", source);
      this.ctx.storage.sql.exec("DELETE FROM play_user_initializations WHERE id=?", source);
    });
  }

  #seedPlays(ids: number[], initialCounts: Record<number, number>) {
    const counts = Object.fromEntries(ids.map((id) => {
      const count = initialCounts[id] ?? 0;
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid initial count");
      return [id, count];
    }));
    // Import the existing account count once; subsequent history updates are not added again.
    this.ctx.storage.sql.exec(`INSERT OR IGNORE INTO totals(kind,id,count)
      SELECT 'play',CAST(key AS INTEGER),value FROM json_each(?)`, JSON.stringify(counts));
  }

  async alarm() {
    const cutoff = viewDay() - 1;
    // Bound each alarm; large expired sets continue in another event.
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`DELETE FROM seen WHERE (day,kind,id,visitor) IN
        (SELECT day,kind,id,visitor FROM seen WHERE day<? LIMIT ?)`, cutoff, CLEANUP_BATCH);
      this.ctx.storage.sql.exec(`DELETE FROM play_visitors WHERE (day,id,visitor) IN
        (SELECT day,id,visitor FROM play_visitors WHERE expires_at<=? LIMIT ?)`, Date.now(), CLEANUP_BATCH);
      this.ctx.storage.sql.exec(`DELETE FROM days WHERE day<?
        AND NOT EXISTS(SELECT 1 FROM seen WHERE seen.day=days.day)
        AND NOT EXISTS(SELECT 1 FROM play_visitors WHERE play_visitors.day=days.day)`, cutoff);
    });
    const oldest = this.ctx.storage.sql.exec<{ day: number | null }>("SELECT MIN(day) AS day FROM days").one().day;
    if (oldest !== null) await this.ctx.storage.setAlarm(Math.max(
      Date.now() + 60_000, (oldest + 2) * VIEW_DAY_MS - VIEW_DAY_OFFSET_MS,
    ));
  }
}
