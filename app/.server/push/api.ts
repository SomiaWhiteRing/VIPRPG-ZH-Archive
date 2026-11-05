import { Hono } from "hono";
import { requireUser } from "@/app/.server/auth/guards";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json } from "@/lib/http";
import type { PushCategory } from "@/lib/push";
import { getInboxItemForUser, markInboxItemRead } from "@/app/.server/db/inbox";
import { setUserFollow } from "@/app/.server/db/user-follows";
import { listReplies, readCommentForUser } from "@/app/.server/db/work-community";

export const pushApi = new Hono<{ Bindings: CloudflareEnv; Variables: { runtime: AppRuntime } }>();

// Look up settings for the current browser's subscription endpoint.
pushApi.post("/api/push/subscription", async c => {
  const runtime = c.get("runtime");
  const auth = await requireUser(runtime, c.req.raw);
  if ("response" in auth) return auth.response;
  const input = await readJsonObject(c.req.raw, "订阅信息无效", { maximumBytes: 8192, requireJsonContentType: true });
  if (typeof input.endpoint !== "string" || input.endpoint.length > 4096) throw new HttpError(400, "订阅信息无效");
  const row = await runtime.db.prepare(`SELECT p.categories_json FROM web_push_subscriptions p
    JOIN user_sessions s ON s.id=p.session_id WHERE p.user_id=? AND p.endpoint=?
    AND s.revoked_at IS NULL AND datetime(s.expires_at)>CURRENT_TIMESTAMP`)
    .bind(auth.user.id, input.endpoint).first<{ categories_json: string }>();
  return json({ ok: true, categories: row ? JSON.parse(row.categories_json) as PushCategory[] : null },
    { headers: { "Cache-Control": "private, no-store" } });
});

pushApi.post("/api/push/inbox/:id/friend", async c => {
  const runtime = c.get("runtime");
  const auth = await requireUser(runtime, c.req.raw);
  if ("response" in auth) return auth.response;
  const input = await readJsonObject(c.req.raw, "提醒目标无效。", { maximumBytes: 1024, requireJsonContentType: true });
  if (input.userId !== auth.user.id || (input.decision !== "accept" && input.decision !== "ignore")) throw new HttpError(409, "提醒对应的内容已变化或不可用。");
  const item = await getInboxItemForUser(runtime, parsePositiveId(c.req.param("id")), auth.user);
  const friend = item.friendNotification;
  if (!friend || friend.kind !== "added") throw new HttpError(409, "提醒对应的内容已变化或不可用。");
  if (input.decision === "accept") {
    if (!friend.isFollowing) {
      if (!friend.canFollow || friend.userId === null) throw new HttpError(409, "暂时无法同意这位用户的好友请求。");
      await setUserFollow(runtime, auth.user.id, friend.userId, true);
    }
  } else await markInboxItemRead(runtime, { user: auth.user, itemId: item.id });
  return json({ ok: true });
});

pushApi.get("/api/push/inbox/:id/comment", async c => {
  const runtime = c.get("runtime");
  const auth = await requireUser(runtime, c.req.raw);
  if ("response" in auth) return auth.response;
  const item = await getInboxItemForUser(runtime, parsePositiveId(c.req.param("id")), auth.user);
  const target = item.commentNotification;
  if (!target) throw new HttpError(404, "评论不存在");
  const root = await readCommentForUser(runtime, target.rootCommentId, auth.user.id);
  const reply = target.commentId === root.id ? root : await readCommentForUser(runtime, target.commentId, auth.user.id);
  if (reply.status !== "published" || reply.rootDeleted || root.status !== "published") throw new HttpError(404, "评论不存在");
  const replies = await listReplies(runtime, root.id, auth.user.id);
  root.replyCount = replies.total;
  root.replyPreview = replies.preview;
  return json({ ok: true, itemId: item.id, root, reply }, { headers: { "Cache-Control": "private, no-store" } });
});
