import { monitors, type Monitor } from "./monitors";

interface Env {
  STATUS_DB: D1Database;
  ASSETS: Fetcher;
}

type CheckResult = {
  monitor: Monitor;
  checkedAt: string;
  success: boolean;
  latencyMs: number;
  error: string | null;
};

type StoredState = {
  last_status: "operational" | "degraded" | "outage";
  consecutive_failures: number;
  last_checked_at: string;
  last_success_at: string | null;
};

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function beijingDay(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

async function check(monitor: Monitor, checkedAt: string): Promise<CheckResult> {
  const started = Date.now();
  let error: string | null = null;
  try {
    const response = await fetch(monitor.url, {
      headers: {
        Accept: monitor.kind === "html" ? "text/html" : "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "VIPRPG-Status/1.0",
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
      cf: { cacheTtl: 0 },
    });
    if (!response.ok) {
      error = `HTTP ${response.status}`;
    } else if (monitor.kind === "html") {
      const body = await response.text();
      if (!response.headers.get("content-type")?.includes("text/html") ||
          !body.includes("<title>VIPRPG.org")) {
        error = "网页内容不符合预期";
      }
    } else {
      const data = await response.json() as { ok?: unknown; dependency?: unknown };
      if (data.ok !== true ||
          (monitor.dependency && data.dependency !== monitor.dependency)) {
        error = "健康接口报告异常";
      }
    }
  } catch (cause) {
    error = cause instanceof Error && cause.name === "TimeoutError"
      ? "请求超时"
      : "连接或响应失败";
  }
  return {
    monitor,
    checkedAt,
    success: error === null,
    latencyMs: Math.max(0, Date.now() - started),
    error,
  };
}

async function saveResult(db: D1Database, result: CheckResult): Promise<void> {
  const { monitor, checkedAt, success, latencyMs, error } = result;
  const previous = await db.prepare(
    "SELECT last_status, consecutive_failures, last_checked_at, last_success_at FROM monitor_state WHERE monitor_id = ?",
  ).bind(monitor.id).first<StoredState>();

  // A scheduled invocation may overlap a prior one. Replaying the same minute
  // must not increase the failure count or create a second incident.
  if (previous && previous.last_checked_at >= checkedAt) return;

  const failures = success ? 0 : (previous?.consecutive_failures ?? 0) + 1;
  const status = success ? "operational" : failures >= 2 ? "outage" : "degraded";
  const statements = [
    db.prepare(
      "INSERT INTO check_results (monitor_id, checked_at, success, latency_ms, error) VALUES (?, ?, ?, ?, ?)",
    ).bind(monitor.id, checkedAt, success ? 1 : 0, latencyMs, error),
    db.prepare(
      `INSERT INTO monitor_state
        (monitor_id, last_status, consecutive_failures, last_checked_at, last_success_at, latency_ms, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(monitor_id) DO UPDATE SET
         last_status = excluded.last_status,
         consecutive_failures = excluded.consecutive_failures,
         last_checked_at = excluded.last_checked_at,
         last_success_at = excluded.last_success_at,
         latency_ms = excluded.latency_ms,
         last_error = excluded.last_error`,
    ).bind(
      monitor.id,
      status,
      failures,
      checkedAt,
      success ? checkedAt : previous?.last_success_at ?? null,
      latencyMs,
      error,
    ),
    db.prepare(
      `INSERT INTO daily_rollups (monitor_id, day_bjt, checks, successful, latency_sum_ms)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(monitor_id, day_bjt) DO UPDATE SET
         checks = checks + 1,
         successful = successful + excluded.successful,
         latency_sum_ms = latency_sum_ms + excluded.latency_sum_ms`,
    ).bind(monitor.id, beijingDay(checkedAt), success ? 1 : 0, success ? latencyMs : 0),
  ];

  if (status === "outage" && previous?.last_status !== "outage") {
    statements.push(db.prepare(
      "INSERT INTO incidents (monitor_id, started_at, summary) VALUES (?, ?, ?)",
    ).bind(monitor.id, previous?.last_status === "degraded"
      ? previous.last_checked_at : checkedAt, `${monitor.name} 连续两次检查失败`));
  } else if (success && previous?.last_status === "outage") {
    statements.push(db.prepare(
      "UPDATE incidents SET resolved_at = ? WHERE monitor_id = ? AND resolved_at IS NULL",
    ).bind(checkedAt, monitor.id));
  }

  await db.batch(statements);
}

async function runChecks(db: D1Database, scheduledTime: number): Promise<void> {
  const checkedAt = new Date(scheduledTime).toISOString();
  const results = await Promise.all(monitors.map((monitor) => check(monitor, checkedAt)));
  for (const result of results) {
    await saveResult(db, result);
  }

  const date = new Date(scheduledTime);
  if (date.getUTCHours() === 16 && date.getUTCMinutes() === 0) {
    const recentCutoff = new Date(scheduledTime - 48 * 60 * 60 * 1000).toISOString();
    const dayCutoff = beijingDay(new Date(scheduledTime - 31 * 24 * 60 * 60 * 1000).toISOString());
    const incidentCutoff = new Date(scheduledTime - 90 * 24 * 60 * 60 * 1000).toISOString();
    await db.batch([
      db.prepare("DELETE FROM check_results WHERE checked_at < ?").bind(recentCutoff),
      db.prepare("DELETE FROM daily_rollups WHERE day_bjt < ?").bind(dayCutoff),
      db.prepare("DELETE FROM incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?").bind(incidentCutoff),
    ]);
  }
}

async function statusData(db: D1Database): Promise<Response> {
  const now = new Date();
  const dayCutoff = beijingDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString());
  const incidentCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentCutoff = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  const states = await db.prepare(
    "SELECT monitor_id, last_status, consecutive_failures, last_checked_at, last_success_at, latency_ms, last_error FROM monitor_state",
  ).all();
  const days = await db.prepare(
    "SELECT monitor_id, day_bjt, checks, successful, latency_sum_ms FROM daily_rollups WHERE day_bjt >= ? ORDER BY day_bjt",
  ).bind(dayCutoff).all();
  const incidents = await db.prepare(
    "SELECT id, monitor_id, started_at, resolved_at, summary FROM incidents WHERE started_at >= ? OR resolved_at IS NULL ORDER BY started_at DESC LIMIT 20",
  ).bind(incidentCutoff).all();
  const recent = await db.prepare(
    "SELECT monitor_id, checked_at, success, latency_ms FROM check_results WHERE checked_at >= ? ORDER BY checked_at DESC LIMIT 300",
  ).bind(recentCutoff).all();

  return json({
    generatedAt: now.toISOString(),
    timezone: "Asia/Shanghai",
    intervalSeconds: 60,
    monitors: monitors.map(({ id, name, description, group }) => ({ id, name, description, group })),
    states: states.results,
    days: days.results,
    incidents: incidents.results,
    recent: recent.results,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/api/health") {
      try {
        const row = await env.STATUS_DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        return json({ ok: row?.ok === 1, service: "viprpg-status", timestamp: new Date().toISOString() });
      } catch {
        return json({ ok: false, service: "viprpg-status" }, 503);
      }
    }
    if (url.pathname === "/api/status") {
      try {
        return await statusData(env.STATUS_DB);
      } catch (error) {
        console.error("Status data query failed", error);
        return json({ ok: false, error: "Status data unavailable" }, 503);
      }
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Not found" }, 404);
    }

    const assetRequest = url.pathname === "/"
      ? new Request(new URL("/index.html", url), request)
      : request;
    const response = await env.ASSETS.fetch(assetRequest);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      headers.set("Cache-Control", "no-cache");
    }
    return new Response(response.body, { status: response.status, headers });
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runChecks(env.STATUS_DB, controller.scheduledTime).catch((error) => {
      console.error("Status checks failed", error);
    }));
  },
} satisfies ExportedHandler<Env>;
