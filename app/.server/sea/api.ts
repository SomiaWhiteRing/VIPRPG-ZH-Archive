import { Hono } from "hono";
import { requireAnyPermission, requirePermission } from "@/app/.server/auth/authorize";
import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json } from "@/lib/http";
import { prepareSeaActor, seaIpKey } from "./identity";
import { seaRoom, seaSubmission } from "./service";

export const seaApi = new Hono<{ Bindings: CloudflareEnv; Variables: { runtime: AppRuntime } }>();
seaApi.get("/api/sea/messages", async c => json({ ok: true, ...await seaRoom(c.get("runtime")).snapshot() }));
seaApi.post("/api/sea/messages", async c => {
  const runtime = c.get("runtime");
  try { assertSameOrigin(runtime, c.req.raw); }
  catch (error) {
    if (error instanceof SameOriginError) throw new HttpError(403, error.message);
    throw error;
  }
  const { actor, cookie } = await prepareSeaActor(runtime);
  const input = seaSubmission(await readJsonObject(c.req.raw, "发言格式无效", { maximumBytes: 4096, requireJsonContentType: true, fatalUtf8: true }), actor);
  const result = await seaRoom(runtime).publish(actor, input);
  if (!result.ok) throw new HttpError(result.status, result.detail, result.code);
  return json(result, { status: result.repeated ? 200 : 201, headers: cookie ? { "Set-Cookie": cookie } : undefined });
});
seaApi.get("/api/sea/socket", async c => {
  const runtime = c.get("runtime");
  // assertSameOrigin skips GET; WebSocket handshakes need an explicit Origin check.
  if (c.req.header("Origin") !== runtime.origin) throw new HttpError(403, "连接来源无效");
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Sea-IP", await seaIpKey(runtime));
  return seaRoom(runtime).fetch(new Request(c.req.url, { headers }));
});
seaApi.get("/api/sea/moderation", async c => {
  const runtime = c.get("runtime");
  const auth = await requireAnyPermission(runtime, c.req.raw, ["sea.message.moderate_any", "sea.user.mute_any"]);
  if ("response" in auth) return auth.response;
  return json({ ok: true, ...await seaRoom(runtime).moderation() });
});
seaApi.delete("/api/sea/messages/:id", async c => {
  const runtime = c.get("runtime");
  const auth = await requirePermission(runtime, c.req.raw, "sea.message.moderate_any");
  if ("response" in auth) return auth.response;
  if (!await seaRoom(runtime).hide(parsePositiveId(c.req.param("id")), auth.user.id)) throw new HttpError(404, "对话不存在");
  return json({ ok: true });
});
seaApi.put("/api/sea/mutes", async c => {
  const runtime = c.get("runtime");
  const auth = await requirePermission(runtime, c.req.raw, "sea.user.mute_any");
  if ("response" in auth) return auth.response;
  const body = await readJsonObject(c.req.raw, "禁言格式无效", { maximumBytes: 1024, requireJsonContentType: true });
  if (typeof body.messageId !== "number" || !Number.isSafeInteger(body.messageId) || body.messageId <= 0
    || typeof body.minutes !== "number" || !Number.isInteger(body.minutes) || body.minutes < 0 || body.minutes > 10080)
    throw new HttpError(400, "禁言参数无效");
  if (!await seaRoom(runtime).mute(body.messageId, body.minutes, auth.user.id)) throw new HttpError(404, "对话不存在");
  return json({ ok: true });
});
