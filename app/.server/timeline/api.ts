import { translate, type MessageKey } from "@/lib/i18n/core";
import { json as jsonResponse, HttpError } from "@/lib/http";
import { requirePermission } from "@/app/.server/auth/authorize";
import { Hono } from "hono";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { requireUser } from "@/app/.server/auth/guards";
import { listUserFollows, readFollowSummary, setUserFollow } from "@/app/.server/db/user-follows";
import { createTimelineReply, deleteTimelineReply, listTimelineReplies, setTimelineLike } from "@/app/.server/db/timeline-interactions";
import { createTimelineStatus, deleteTimelineEvent, listTimeline, readTimelineSettings, updateTimelineSettings } from "@/app/.server/db/timeline";
import { recordWorkPlayed } from "@/app/.server/db/work-community";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { isTimelineKind, isTimelineView } from "@/lib/dto/db/timeline";


export const timelineApi = new Hono<{ Bindings: CloudflareEnv; Variables: { runtime: AppRuntime } }>();
timelineApi.use("*", async (c, next) => { await next(); c.header("Cache-Control", "private, no-store"); });
timelineApi.on(["GET", "HEAD"], "/api/timeline", async (c) => {
  const runtime = c.get("runtime"), params = new URL(c.req.url).searchParams;
  const userId = params.get("userId"), kind = params.get("kind"), viewer = await getCurrentUser(runtime);
  const view = params.get("view") ?? "all";
  if (!isTimelineView(view) || (view !== "all" && userId !== null)) throw new HttpError(400, translate(runtime.uiLocale, "timeline.error.scope"), undefined, "timeline.error.scope");
  if (view !== "all" && !viewer) throw new HttpError(401, translate(runtime.uiLocale, "timeline.error.login"), undefined, "timeline.error.login");
  if (kind !== null && !isTimelineKind(kind)) throw new HttpError(400, translate(runtime.uiLocale, "timeline.error.kind"), undefined, "timeline.error.kind");
  return jsonResponse({ ok: true, ...await listTimeline(runtime, { viewerId: viewer?.id,
    actorUserId: view === "mine" ? viewer!.id : userId === null ? undefined : parseTimelineId(userId, "timeline.error.userId"), following: view === "following",
    cursor: params.get("cursor"), kind: kind ?? undefined }) });
});
timelineApi.on(["GET", "HEAD"], "/api/users/:userId/follow", async (c) => {
  const runtime = c.get("runtime");
  const summary = await readFollowSummary(runtime, parseTimelineId(c.req.param("userId"), "timeline.error.userId"), await getCurrentUser(runtime));
  if (!summary) throw new HttpError(404, translate(runtime.uiLocale, "timeline.error.userNotFound"), undefined, "timeline.error.userNotFound");
  return jsonResponse({ ok: true, ...summary });
});
timelineApi.put("/api/users/:userId/follow", async (c) => {
  const runtime = c.get("runtime"), auth = await requirePermission(runtime, c.req.raw, "timeline.follow.create");
  if ("response" in auth) return auth.response;
  await setUserFollow(runtime, auth.user.id, parseTimelineId(c.req.param("userId"), "timeline.error.userId"), true);
  return jsonResponse({ ok: true });
});
timelineApi.delete("/api/users/:userId/follow", async (c) => {
  const runtime = c.get("runtime"), auth = await requirePermission(runtime, c.req.raw, "timeline.follow.delete_own");
  if ("response" in auth) return auth.response;
  await setUserFollow(runtime, auth.user.id, parseTimelineId(c.req.param("userId"), "timeline.error.userId"), false);
  return jsonResponse({ ok: true });
});
timelineApi.on(["GET", "HEAD"], "/api/users/:userId/follows", async (c) => {
  const runtime = c.get("runtime");
  const params = new URL(c.req.url).searchParams, direction = params.get("view") ?? "following";
  if (direction !== "following" && direction !== "followers") throw new HttpError(400, translate(runtime.uiLocale, "timeline.error.followType"), undefined, "timeline.error.followType");
  return jsonResponse({ ok: true, ...await listUserFollows(runtime, parseTimelineId(c.req.param("userId"), "timeline.error.userId"), direction, params.get("cursor")) });
});
timelineApi.post("/api/timeline", async (c) => {
  const runtime = c.get("runtime"), auth = await requirePermission(runtime, c.req.raw, "timeline.status.create");
  if ("response" in auth) return auth.response;
  return jsonResponse({ ok: true, id: await createTimelineStatus(runtime, auth.user.id, await readJsonObject(c.req.raw, translate(runtime.uiLocale, "timeline.error.postPayload"))) }, { status: 201 });
});
timelineApi.on(["GET", "HEAD"], "/api/account/timeline", async (c) => {
  const runtime = c.get("runtime"), auth = await requireUser(runtime, c.req.raw);
  if ("response" in auth) return auth.response;
  return jsonResponse({ ok: true, settings: await readTimelineSettings(runtime, auth.user.id) });
});
timelineApi.patch("/api/account/timeline", async (c) => {
  const runtime = c.get("runtime"), auth = await requireUser(runtime, c.req.raw);
  if ("response" in auth) return auth.response;
  return jsonResponse({ ok: true, settings: await updateTimelineSettings(runtime, auth.user.id, await readJsonObject(c.req.raw, translate(runtime.uiLocale, "timeline.error.settings"))) });
});
timelineApi.delete("/api/timeline/:id", async (c) => {
  const runtime = c.get("runtime"), auth = await requireUser(runtime, c.req.raw);
  if ("response" in auth) return auth.response;
  await deleteTimelineEvent(runtime, parseTimelineId(c.req.param("id"), "timeline.error.eventId"), auth.user.id);
  return jsonResponse({ ok: true });
});
timelineApi.put("/api/timeline/:id/like", async (c) => {
  const runtime = c.get("runtime"), auth = await requirePermission(runtime, c.req.raw, "timeline.status.like");
  if ("response" in auth) return auth.response;
  await setTimelineLike(runtime, parseTimelineId(c.req.param("id"), "timeline.error.eventId"), auth.user.id, true);
  return jsonResponse({ ok: true });
});
timelineApi.delete("/api/timeline/:id/like", async (c) => {
  const runtime = c.get("runtime"), auth = await requirePermission(runtime, c.req.raw, "timeline.status.like");
  if ("response" in auth) return auth.response;
  await setTimelineLike(runtime, parseTimelineId(c.req.param("id"), "timeline.error.eventId"), auth.user.id, false);
  return jsonResponse({ ok: true });
});
timelineApi.on(["GET", "HEAD"], "/api/timeline/:id/replies", async (c) =>
  jsonResponse({ ok: true, ...await listTimelineReplies(c.get("runtime"), parseTimelineId(c.req.param("id"), "timeline.error.eventId"), new URL(c.req.url).searchParams.get("cursor")) }));
timelineApi.post("/api/timeline/:id/replies", async (c) => {
  const runtime = c.get("runtime"), auth = await requirePermission(runtime, c.req.raw, "timeline.reply.create");
  if ("response" in auth) return auth.response;
  return jsonResponse({ ok: true, id: await createTimelineReply(runtime, parseTimelineId(c.req.param("id"), "timeline.error.eventId"), auth.user.id, await readJsonObject(c.req.raw, translate(runtime.uiLocale, "timeline.error.replyPayload"))) }, { status: 201 });
});
timelineApi.delete("/api/timeline/replies/:replyId", async (c) => {
  const runtime = c.get("runtime"), auth = await requireUser(runtime, c.req.raw);
  if ("response" in auth) return auth.response;
  await deleteTimelineReply(runtime, parseTimelineId(c.req.param("replyId"), "timeline.error.replyId"), auth.user.id);
  return jsonResponse({ ok: true });
});
// Existing clients keep this URL; both endpoints now use the same play path.
timelineApi.post("/api/works/:workId/first-play", async (c) => {
  const runtime = c.get("runtime"), auth = await requireUser(runtime, c.req.raw);
  if ("response" in auth) return auth.response;
  await recordWorkPlayed(runtime, parseTimelineId(c.req.param("workId"), "relation.error.invalidWork"), auth.user.id);
  return c.body(null, 204);
});
for (const [path, allow] of [
  ["/api/timeline", "GET, HEAD, POST, OPTIONS"], ["/api/timeline/:id", "DELETE, OPTIONS"],
  ["/api/timeline/:id/like", "PUT, DELETE, OPTIONS"], ["/api/timeline/:id/replies", "GET, HEAD, POST, OPTIONS"],
  ["/api/timeline/replies/:replyId", "DELETE, OPTIONS"],
  ["/api/account/timeline", "GET, HEAD, PATCH, OPTIONS"], ["/api/works/:workId/first-play", "POST, OPTIONS"],
  ["/api/users/:userId/follow", "GET, HEAD, PUT, DELETE, OPTIONS"], ["/api/users/:userId/follows", "GET, HEAD, OPTIONS"],
]) {
  timelineApi.options(path, (c) => c.body(null, 204, { Allow: allow }));
  timelineApi.all(path, (_c) => jsonResponse({ ok: false, error: "Method not allowed" }, { status: 405, headers: { Allow: allow } }));
}

function parseTimelineId(value: string, messageKey: MessageKey) {
  return parsePositiveId(value, undefined, undefined, undefined, messageKey);
}
