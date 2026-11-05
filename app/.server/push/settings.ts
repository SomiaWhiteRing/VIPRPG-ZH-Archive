import type { AppRuntime } from "@/app/.server/runtime";
import { base64UrlDecodeBytes, toArrayBuffer } from "@/app/.server/crypto/encoding";
import { HttpError } from "@/lib/http";
import { availablePushCategories, PUSH_CATEGORIES, type PushCategory } from "@/lib/push";
import { webPushConfiguration } from "./service";

export async function webPushSettingsStatement(runtime: AppRuntime, userId: number, sessionId: number, form: FormData) {
  const raw = form.get("webPush");
  if (raw === null) return null;
  if (typeof raw !== "string" || raw.length > 8192) throw new HttpError(400, "订阅信息无效");
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object" || typeof input.enabled !== "boolean"
    || (input.endpoint !== null && (typeof input.endpoint !== "string" || input.endpoint.length > 4096)))
    throw new HttpError(400, "订阅信息无效");
  if (!input.enabled) return runtime.db.prepare("DELETE FROM web_push_subscriptions WHERE user_id=? AND endpoint=?")
    .bind(userId, input.endpoint);
  if (!webPushConfiguration(runtime.env)) throw new HttpError(503, "系统通知不可用");
  if (!Array.isArray(input.categories) || input.categories.length > PUSH_CATEGORIES.length
    || input.categories.some((category: unknown) => !PUSH_CATEGORIES.some(item => item.value === category))
    || new Set(input.categories).size !== input.categories.length) throw new HttpError(400, "订阅信息无效");
  const subscription = input.subscription;
  if (!subscription || typeof subscription !== "object" || typeof subscription.endpoint !== "string"
    || subscription.endpoint !== input.endpoint) throw new HttpError(400, "订阅信息无效");
  const endpoint = new URL(subscription.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash || (endpoint.port && endpoint.port !== "443"))
    throw new HttpError(400, "订阅地址无效");
  const keys = subscription.keys;
  if (!keys || typeof keys.p256dh !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh)
    || typeof keys.auth !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth)) throw new HttpError(400, "订阅密钥无效");
  await crypto.subtle.importKey("raw", toArrayBuffer(base64UrlDecodeBytes(keys.p256dh)), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const available = availablePushCategories({
    notifyUploadedWorkComments: form.get("notifyUploadedWorkComments") === "1",
    notifyFriendAdditions: form.getAll("notifyFriendAdditions").includes("1"),
    receivePrivateMessages: form.getAll("receivePrivateMessages").includes("1"),
  });
  const categories = (input.categories as PushCategory[]).filter(category => available.includes(category));
  return runtime.db.prepare(`INSERT INTO web_push_subscriptions
    (user_id,session_id,endpoint,p256dh,auth,categories_json,inbox_after_id,message_after_id)
    VALUES(?,?,?,?,?,?,COALESCE((SELECT MAX(id) FROM inbox_items),0),COALESCE((SELECT MAX(id) FROM direct_messages),0))
    ON CONFLICT(endpoint) DO UPDATE SET
      inbox_after_id=CASE WHEN web_push_subscriptions.user_id<>excluded.user_id OR web_push_subscriptions.session_id<>excluded.session_id
        OR web_push_subscriptions.categories_json<>excluded.categories_json THEN excluded.inbox_after_id ELSE web_push_subscriptions.inbox_after_id END,
      message_after_id=CASE WHEN web_push_subscriptions.user_id<>excluded.user_id OR web_push_subscriptions.session_id<>excluded.session_id
        OR web_push_subscriptions.categories_json<>excluded.categories_json THEN excluded.message_after_id ELSE web_push_subscriptions.message_after_id END,
      user_id=excluded.user_id,session_id=excluded.session_id,p256dh=excluded.p256dh,auth=excluded.auth,
      categories_json=excluded.categories_json`)
    .bind(userId, sessionId, endpoint.href, keys.p256dh, keys.auth, JSON.stringify(categories));
}
