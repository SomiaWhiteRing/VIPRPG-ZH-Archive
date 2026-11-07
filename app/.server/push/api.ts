import { Hono } from "hono";
import { requireUser } from "@/app/.server/auth/guards";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json } from "@/lib/http";
import { availablePushCategories, PUSH_CATEGORIES, type DeviceNotificationPosition, type PushCategory } from "@/lib/push";
import { getInboxItemForUser, listUnreadInboxNotificationIds, markInboxItemRead } from "@/app/.server/db/inbox";
import { listUnreadDirectNotificationIds } from "@/app/.server/db/messages";
import { setUserFollow } from "@/app/.server/db/user-follows";
import { listReplies, readCommentForUser } from "@/app/.server/db/work-community";
import { getAuthContext } from "@/app/.server/auth/current-user";
import { webPushSubscriptionStatement } from "./settings";
import { webPushContent } from "./content";

export const pushApi = new Hono<{ Bindings: CloudflareEnv; Variables: { runtime: AppRuntime } }>();

pushApi.get("/api/inbox/device-notifications", async c => {
  const runtime = c.get("runtime");
  const auth = await getAuthContext(runtime);
  const headers = { "Cache-Control": "private, no-store" };
  if (!auth) return json({ ok: false }, { status: 401, headers });

  const { user, session } = auth;
  const params = new URL(c.req.url).searchParams;
  const [sessionId, inboxAfter, messageAfter] = ["sessionId", "inboxAfter", "messageAfter"].map(name => {
    const value = params.get(name) ?? "0";
    if (value === "0") return 0;
    return parsePositiveId(value, name);
  });
  const selected = params.get("categories");
  const requested = selected ? selected.split(",") : [];
  if (requested.length > PUSH_CATEGORIES.length || requested.some(value => !PUSH_CATEGORIES.some(item => item.value === value))) {
    throw new HttpError(400, "接收类型无效");
  }

  const head = await runtime.db.prepare(`SELECT
    COALESCE((SELECT MAX(id) FROM inbox_items),0) AS inboxAfter,
    COALESCE((SELECT MAX(id) FROM direct_messages),0) AS messageAfter`).first<Pick<DeviceNotificationPosition, "inboxAfter" | "messageAfter">>();
  const position = { userId: user.id, sessionId: session.id, inboxAfter: head?.inboxAfter ?? 0, messageAfter: head?.messageAfter ?? 0 };
  if (sessionId !== session.id) return json({ ok: true, ...position, items: [], more: false }, { headers });

  const pageSize = 5;
  const categories = availablePushCategories(user.preferences).filter(category => requested.includes(category));
  const [inboxIds, messageIds] = await Promise.all([
    listUnreadInboxNotificationIds(runtime, user, categories, inboxAfter, position.inboxAfter, pageSize + 1),
    categories.includes("messages") ? listUnreadDirectNotificationIds(runtime, user.id, messageAfter, position.messageAfter, pageSize + 1) : [],
  ]);
  const items = await Promise.all([
    ...inboxIds.slice(0, pageSize).map(id => webPushContent(runtime, user, "inbox", id, false)),
    ...messageIds.slice(0, pageSize).map(id => webPushContent(runtime, user, "messages", id, false)),
  ]);
  return json({ ok: true, ...position,
    inboxAfter: inboxIds.length > pageSize ? inboxIds[pageSize - 1] : Math.max(inboxAfter, position.inboxAfter),
    messageAfter: messageIds.length > pageSize ? messageIds[pageSize - 1] : Math.max(messageAfter, position.messageAfter),
    items: items.filter(item => item !== null), more: inboxIds.length > pageSize || messageIds.length > pageSize,
  }, { headers });
});

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

pushApi.put("/api/push/subscription", async c => {
  const runtime = c.get("runtime");
  const auth = await requireUser(runtime, c.req.raw);
  if ("response" in auth) return auth.response;
  const context = (await getAuthContext(runtime))!;
  const input = await readJsonObject(c.req.raw, "订阅信息无效", { maximumBytes: 8192, requireJsonContentType: true });
  const { statement, categories } = await webPushSubscriptionStatement(runtime, auth.user.id, context.session.id, input, auth.user.preferences);
  await statement.run();
  return json({ ok: true, categories });
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
