import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError } from "@/lib/http";
import type { StatKind } from "@/lib/view-stats";

const FRESH_MS = 15 * 60 * 1000;
const MAX_IDS = 128;
type CachedCount = { count: number; at: number };

function stats(env: CloudflareEnv) {
  return env.VIEW_STATS.getByName("site");
}

function cacheKey(origin: string, kind: StatKind, id: number) {
  return new Request(`${origin}/__view_stats/v1/${kind}/${id}`);
}

export async function recordView(runtime: AppRuntime, kind: StatKind, id: number, initialCount = 0) {
  const request = runtime.request;
  const userAgent = request.headers.get("user-agent")?.slice(0, 1024);
  // CF sets this header at the edge. Never accept an IP supplied in the body or X-Forwarded-For.
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || !userAgent || /bot\b|crawler|spider|headless|preview|facebookexternalhit/i.test(userAgent)) return;
  const limited = await runtime.env.VIEW_RATE_LIMITER.limit({ key: `${runtime.origin}:${ip}` });
  if (!limited.success) throw new HttpError(429, "请求过于频繁");
  await stats(runtime.env).record(kind, id, runtime.origin, ip, userAgent, initialCount);
}

export async function viewCounts(runtime: AppRuntime, kind: StatKind, ids: number[], initialCounts: Record<number, number> = {}): Promise<Record<number, number>> {
  const unique = [...new Set(ids)];
  const values: Record<number, number> = {};
  if (!unique.length) return values;
  const cache = typeof caches === "undefined" ? undefined : await caches.open("view-stats").catch(() => undefined);
  const missing: number[] = [];
  // Cache only anonymous numbers, never the surrounding authenticated page/DTO.
  await Promise.all(unique.map(async (id) => {
    let cached: CachedCount | undefined;
    try {
      const response = await cache?.match(cacheKey(runtime.origin, kind, id));
      if (response) cached = await response.json() as CachedCount;
    } catch { /* A cache failure must not prevent reading the counter. */ }
    values[id] = cached?.count ?? initialCounts[id] ?? 0;
    if (!cached || Date.now() - cached.at >= FRESH_MS) missing.push(id);
  }));
  for (let offset = 0; offset < missing.length; offset += MAX_IDS) {
    const batch = missing.slice(offset, offset + MAX_IDS);
    try {
      const counts = await stats(runtime.env).counts(kind, batch, initialCounts);
      Object.assign(values, counts);
      if (cache) runtime.execution.waitUntil(Promise.all(batch.map((id) => cache.put(
        cacheKey(runtime.origin, kind, id),
        Response.json({ count: counts[id], at: Date.now() }, { headers: { "Cache-Control": "public, max-age=86400" } }),
      ))).catch(() => undefined));
    } catch {
      // Keep a stale value when available; never write outage fallbacks into storage/cache.
      console.error("View count service unavailable", { kind, targets: batch.length });
    }
  }
  return values;
}

export async function topicViews<T extends { id: number }>(runtime: AppRuntime, items: T[]) {
  const counts = await viewCounts(runtime, "topic", items.map((item) => item.id));
  return items.map((item) => ({ ...item, views: counts[item.id] }));
}

export async function rankWorkStats(runtime: AppRuntime, kind: "work" | "play", ids: number[], limit: number, offset: number, initialCounts: Record<number, number> = {}) {
  if (!ids.length) return [];
  return stats(runtime.env).rankWorks(ids, limit, offset, kind, initialCounts);
}

// Preserve both pre-merge account totals before D1 moves/deduplicates personal histories.
export async function initializeWorkPlays(runtime: AppRuntime, ids: number[]) {
  const rows = await runtime.db.prepare(`SELECT w.id,
    (SELECT COUNT(*) FROM user_work_entries e WHERE e.work_id=w.id AND e.last_played_at IS NOT NULL) AS count
    FROM works w WHERE w.id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids)).all<{ id: number; count: number }>();
  await stats(runtime.env).counts("play", rows.results.map((row) => row.id),
    Object.fromEntries(rows.results.map((row) => [row.id, row.count])));
}

// View reports and counter reads use only the DO/cache; callers supply legacy play baselines.
// The outbox is committed with the catalog transaction; retries are idempotent in the DO.
export async function drainViewMerges(env: CloudflareEnv) {
  const pending = await env.DB.prepare("SELECT id,source_id,target_id FROM view_stat_merges ORDER BY id LIMIT 50")
    .all<{ id: number; source_id: number; target_id: number }>();
  for (const item of pending.results) {
    await stats(env).mergeWorks(item.id, item.source_id, item.target_id);
    await env.DB.prepare("DELETE FROM view_stat_merges WHERE id=?").bind(item.id).run();
  }
}
