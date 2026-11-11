import { Hono } from "hono";
import { DurableObject } from "cloudflare:workers";
import { createRequestHandler, RouterContextProvider } from "react-router";
import { api } from "./app/.server/api";
import { getSiteAnalyticsConfig } from "./app/.server/analytics";
import { refreshSessionCookie } from "./app/.server/auth/session";
import { parseCookie, SESSION_COOKIE_NAME } from "./app/.server/auth/session-token";
import { createRuntime } from "./app/.server/runtime";
import type { AppRuntime } from "./app/.server/runtime";
import { runtimeContext } from "./app/.server/router-context";
import { maybeHandleArchiveDownload } from "./worker/archive-download.mjs";
import { maybeHandleEasyRpgAsset } from "./worker/easyrpg-assets";
import { maybeHandleNetplayRoom } from "./worker/netplay-room";
import { runScheduledArchiveGc } from "./worker/archive-gc.mjs";
import { cleanupCommentImages } from "./app/.server/comments/image-cleanup";
import { cleanupDirectMessageImages } from "./app/.server/messages/image-cleanup";
import { drainViewMerges } from "./app/.server/views/service";
import { runScheduledAuditReports } from "./app/.server/db/audit-reports";
import { DAILY_AUDIT_CRON } from "./lib/audit-report-config.mjs";
import { consumeWebPush, enqueueWebPush } from "./app/.server/push/service";
import { crawlerResponse, publicRobots, isFilteredGameList } from "./lib/crawl-policy";

export { ViewStats } from "./app/.server/views/durable-object";
export { EternalSeaRoom } from "./app/.server/sea/durable-object";
export { MessageRoom } from "./app/.server/messages/durable-object";
export { NetplayRoom } from "./worker/netplay-room";

// Preserve the provisioned staging namespace from the netplay experiment.
export class GyokuroLobby extends DurableObject<CloudflareEnv> {}

const developmentRender = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);
let productionRender: Promise<{ handler: ReturnType<typeof createRequestHandler>; version: string }> | undefined;
async function render(request: Request, context: RouterContextProvider, runtime: AppRuntime) {
  if (import.meta.env.DEV) return developmentRender(request, context);
  // A function build asks React Router to derive its route matcher on every call.
  // Production builds are immutable for the lifetime of this Worker isolate.
  productionRender ??= import("virtual:react-router/server-build").then((build) => ({
    handler: createRequestHandler(build, import.meta.env.MODE),
    version: build.assets.version,
  }));
  const { handler, version } = await productionRender;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== runtime.origin || url.search
    || !["/", "/explore", "/games"].includes(url.pathname)
    || request.headers.has("Authorization")
    || parseCookie(request.headers.get("Cookie"), SESSION_COOKIE_NAME)
    || request.headers.get("Sec-Fetch-Dest") === "iframe") {
    return handler(request, context);
  }

  // HTML embeds build-specific asset URLs and network dimensions for analytics.
  const analytics = encodeURIComponent(JSON.stringify(getSiteAnalyticsConfig(runtime)));
  const cacheKey = `${url.origin}/__cache/anonymous-pages/${version}/${analytics}${url.pathname}`;
  const cache = await caches.open("viprpg-public-pages");
  const cached = await cache.match(cacheKey).catch(() => undefined);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.append("Server-Timing", "public-page-cache;desc=HIT");
    return response;
  }

  const response = await handler(request, context);
  if (response.status === 200 && response.headers.get("Content-Type")?.startsWith("text/html")
    && !response.headers.has("Set-Cookie") && !response.headers.has("Vary")) {
    // The shared copy is short-lived. The client response remains private, no-store.
    const shared = new Response(response.clone().body, response);
    shared.headers.set("Cache-Control", "public, max-age=30");
    runtime.execution.waitUntil(cache.put(cacheKey, shared).catch(() => {
      console.error("Public page cache write failed");
    }));
  }
  return response;
}
const app = new Hono<{
  Bindings: CloudflareEnv;
  Variables: { runtime: AppRuntime };
}>();

app.use("*", async (c, next) => {
  const crawlResponse = crawlerResponse(c.req.raw);
  if (crawlResponse) {
    if (c.env.SITE_NOINDEX === "true") crawlResponse.headers.set("X-Robots-Tag", "noindex, nofollow");
    return crawlResponse;
  }
  const runtime = createRuntime(c.req.raw, c.env, c.executionCtx, import.meta.env.DEV);
  c.set("runtime", runtime);
  await next();
  if (runtime.sessionCookieRefresh && c.res.status >= 200 && c.res.status < 400
    && c.req.path !== "/api/inbox/device-notifications"
    && !c.res.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))) {
    const cookie = await refreshSessionCookie(runtime, runtime.sessionCookieRefresh).catch(() => {
      console.error("Session renewal failed");
    });
    if (cookie) {
      c.header("Cache-Control", "private, no-store");
      c.header("Set-Cookie", cookie, { append: true });
    }
  }
  if (c.req.path.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)
    && c.req.path !== "/api/push/subscription") {
    c.executionCtx.waitUntil(enqueueWebPush(c.env).catch(() => console.error("Web Push enqueue failed")));
  }
  if (c.env.SITE_NOINDEX === "true") {
    c.header("X-Robots-Tag", "noindex, nofollow");
  } else if (/^\/games(?:\.data)?\/?$/.test(c.req.path) &&
      isFilteredGameList(new URL(c.req.url).searchParams)) {
    c.header("X-Robots-Tag", "noindex, follow");
  }
});
app.get("/robots.txt", (c) => c.text(c.env.SITE_NOINDEX === "true"
  ? "User-agent: *\nDisallow: /\n"
  : publicRobots(c.get("runtime").origin)));
app.all(
  "/api/archive-versions/:id/file-index",
  async (c) =>
    (await maybeHandleArchiveDownload(c.req.raw, c.env, c.executionCtx)) ??
    c.notFound(),
);
app.all(
  "/api/archive-versions/:id/kai-import",
  async (c) =>
    (await maybeHandleArchiveDownload(c.req.raw, c.env, c.executionCtx)) ??
    c.notFound(),
);
app.all(
  "/api/archive-versions/:id/download",
  async (c) =>
    (await maybeHandleArchiveDownload(c.req.raw, c.env, c.executionCtx)) ??
    c.notFound(),
);
app.route("/", api);
app.all("*", async (c) => {
  if (
    /^\/(?:assets\/|icon\/|notification-sw\.js$|play\/runtime\/|play\/sw\.js$|play\/player(?:\.html)?$)/.test(
      c.req.path,
    )
  )
    return c.env.ASSETS.fetch(c.req.raw);
  const context = new RouterContextProvider();
  const runtime = c.get("runtime");
  context.set(runtimeContext, runtime);
  const response = await render(c.req.raw, context, runtime);
  const headers = new Headers(response.headers);
  if (c.req.path !== "/__manifest" || response.status !== 200) {
    headers.set("Cache-Control", "private, no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});

export default {
  async fetch(request, env, ctx) {
    return (await maybeHandleNetplayRoom(request, env, ctx))
      ?? (await maybeHandleEasyRpgAsset(request, env.ASSETS))
      ?? app.fetch(request, env, ctx);
  },
  async queue(batch, env, ctx) {
    await consumeWebPush(batch, createRuntime(new Request(env.APP_ORIGIN), env, ctx));
  },
  scheduled(controller, env, ctx) {
    if (controller.cron === DAILY_AUDIT_CRON) {
      ctx.waitUntil(runScheduledAuditReports(env.DB, controller.scheduledTime));
      return;
    }
    ctx.waitUntil(drainViewMerges(env).catch(() => {
      console.error("Scheduled view merge retry failed");
    }));
    ctx.waitUntil(enqueueWebPush(env).catch(() => console.error("Web Push outbox retry failed")));
    ctx.waitUntil(
      runScheduledArchiveGc(env, {
        trigger: "scheduled",
        cron: controller.cron,
      })
        .then(async (report) => {
          console.log("Scheduled archive GC completed", JSON.stringify(report));
          console.log("Comment image cleanup completed", JSON.stringify(await cleanupCommentImages(env.DB, env.ARCHIVE_BUCKET)));
          await cleanupDirectMessageImages(env.DB, env.ARCHIVE_BUCKET);
        })
        .catch((error) => {
          console.error("Scheduled archive GC failed", error);
        }),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
