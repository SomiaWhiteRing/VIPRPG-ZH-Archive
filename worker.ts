import { Hono } from "hono";
import { createRequestHandler, RouterContextProvider } from "react-router";
import { api } from "./app/.server/api";
import { createRuntime } from "./app/.server/runtime";
import type { AppRuntime } from "./app/.server/runtime";
import { runtimeContext } from "./app/.server/router-context";
import { maybeHandleArchiveDownload } from "./worker/archive-download.mjs";
import { runScheduledArchiveGc } from "./worker/archive-gc.mjs";

const render = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);
const app = new Hono<{
  Bindings: CloudflareEnv;
  Variables: { runtime: AppRuntime };
}>();

app.use("*", async (c, next) => {
  c.set(
    "runtime",
    createRuntime(c.req.raw, c.env, c.executionCtx, import.meta.env.DEV),
  );
  await next();
});
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
    /^\/(?:assets\/|icon\/|play\/runtime\/|play\/sw\.js$|play\/player(?:\.html)?$)/.test(
      c.req.path,
    )
  )
    return c.env.ASSETS.fetch(c.req.raw);
  const context = new RouterContextProvider();
  context.set(runtimeContext, c.get("runtime"));
  const response = await render(c.req.raw, context);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runScheduledArchiveGc(env, {
        trigger: "scheduled",
        cron: controller.cron,
      })
        .then((report) => {
          console.log("Scheduled archive GC completed", JSON.stringify(report));
        })
        .catch((error) => {
          console.error("Scheduled archive GC failed", error);
        }),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
