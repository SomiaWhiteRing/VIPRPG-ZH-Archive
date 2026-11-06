import { parseTimestamp } from "@/lib/format";
import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import type { AppRuntime } from "@/app/.server/runtime";
import { findUserById } from "@/app/.server/db/users";
import { isUnreadInboxItem } from "@/app/.server/db/inbox";
import { isUnreadDirectMessage } from "@/app/.server/db/messages";
import { ApiResponseError, requestOk } from "@/lib/ui/api-response";
import { availablePushCategories, type PushCategory, type WebPushJob } from "@/lib/push";
import { webPushContent } from "./content";

export function webPushConfiguration(env: CloudflareEnv): (VapidKeys & { queue: Queue<WebPushJob> }) | null {
  const queue = (env as CloudflareEnv & { WEB_PUSH_QUEUE?: Queue<WebPushJob> }).WEB_PUSH_QUEUE;
  if (env.WEB_PUSH_ENABLED !== "true" || !queue || !env.WEB_PUSH_PUBLIC_KEY || !env.WEB_PUSH_PRIVATE_KEY || !env.WEB_PUSH_SUBJECT) return null;
  return { publicKey: env.WEB_PUSH_PUBLIC_KEY, privateKey: env.WEB_PUSH_PRIVATE_KEY, subject: env.WEB_PUSH_SUBJECT, queue };
}

type SubscriptionRow = {
  id: number; user_id: number; session_id: number; endpoint: string; p256dh: string; auth: string;
  categories_json: string; inbox_after_id: number; message_after_id: number;
};

async function eligibleRecipient(runtime: AppRuntime, subscription: SubscriptionRow, kind: "inbox" | "messages", id: number) {
  const user = await findUserById(runtime, subscription.user_id);
  if (!user || user.status !== "active") return null;
  const available = availablePushCategories(user.preferences);
  const categories = (JSON.parse(subscription.categories_json) as PushCategory[]).filter(category => available.includes(category));
  const unread = kind === "inbox" ? await isUnreadInboxItem(runtime, user, id, categories)
    : categories.includes("messages") && await isUnreadDirectMessage(runtime, user.id, id);
  return unread ? user : null;
}

export async function consumeWebPush(batch: MessageBatch<unknown>, runtime: AppRuntime, now = Date.now()) {
  const config = webPushConfiguration(runtime.env);
  if (!config) { batch.ackAll(); return; }
  for (const message of batch.messages) {
    const body = message.body;
    if (!body || typeof body !== "object" || !("kind" in body)
      || !["drain", "inbox", "messages", "deliver"].includes(String(body.kind))
      || (body.kind !== "drain" && (!("id" in body) || !Number.isSafeInteger(body.id) || (body.id as number) <= 0))
      || ("afterSubscriptionId" in body && (!Number.isSafeInteger(body.afterSubscriptionId) || (body.afterSubscriptionId as number) < 0))
      || (body.kind === "deliver" && (!("eventKind" in body) || (body.eventKind !== "inbox" && body.eventKind !== "messages")
        || !["subscriptionId", "sessionId", "userId"].every(key => Number.isSafeInteger((body as Record<string, unknown>)[key]) && ((body as Record<string, number>)[key]) > 0)))) {
      console.error("Invalid Web Push queue job"); message.ack(); continue;
    }
    const job = body as WebPushJob;
    try {
      if (job.kind === "drain") await enqueueWebPush(runtime.env);
      else {
        const kind = job.kind === "deliver" ? job.eventKind : job.kind;
        const start = kind === "inbox" ? "inbox_after_id" : "message_after_id";
        const source = await runtime.db.prepare(kind === "inbox"
          ? "SELECT recipient_user_id,created_at,required_permission_key,type,work_maintainer_request_id FROM inbox_items WHERE id=? AND suppressed=0"
          : "SELECT recipient_user_id,created_at,NULL AS required_permission_key,NULL AS type,NULL AS work_maintainer_request_id FROM direct_messages WHERE id=? AND delivered=1")
          .bind(job.id).first<{ recipient_user_id: number | null; created_at: string; required_permission_key: string | null; type: string | null; work_maintainer_request_id: number | null }>();
        const timestamp = source ? parseTimestamp(source.created_at).getTime() : 0;
        if (!source || !Number.isFinite(timestamp) || now - timestamp >= 86_400_000) { message.ack(); continue; }
        if (job.kind === "deliver") {
          const subscription = await runtime.db.prepare(`SELECT p.* FROM web_push_subscriptions p
            JOIN user_sessions s ON s.id=p.session_id WHERE p.id=? AND p.user_id=? AND p.session_id=?
              AND p.${start}<? AND s.revoked_at IS NULL AND datetime(s.expires_at)>CURRENT_TIMESTAMP`)
            .bind(job.subscriptionId, job.userId, job.sessionId, job.id).first<SubscriptionRow>();
          if (!subscription) { message.ack(); continue; }
          const user = await eligibleRecipient(runtime, subscription, kind, job.id);
          const content = user ? await webPushContent(runtime, user, kind, job.id) : null;
          if (!content) { message.ack(); continue; }
          const payload = await buildPushPayload({ data: JSON.stringify(content),
            options: { ttl: Math.max(1, Math.floor((timestamp + 86_400_000 - now) / 1000)) } },
          { endpoint: subscription.endpoint, expirationTime: null, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, config);
          try { await requestOk(subscription.endpoint, { ...payload, redirect: "error", signal: AbortSignal.timeout(10_000) }); }
          catch (error) {
            if (!(error instanceof ApiResponseError) || (error.status !== 404 && error.status !== 410)) throw error;
            await runtime.db.prepare("DELETE FROM web_push_subscriptions WHERE id=? AND session_id=?")
              .bind(subscription.id, subscription.session_id).run();
          }
        } else {
          const broadcast = source.required_permission_key !== null || source.type === "role_change_request" || source.work_maintainer_request_id !== null;
          const candidates = await runtime.db.prepare(`SELECT p.* FROM web_push_subscriptions p
            JOIN user_sessions s ON s.id=p.session_id JOIN users u ON u.id=p.user_id
            WHERE ${broadcast ? "1" : "p.user_id=?"} AND p.id>? AND p.${start}<? AND u.status='active'
              AND s.revoked_at IS NULL AND datetime(s.expires_at)>CURRENT_TIMESTAMP ORDER BY p.id LIMIT 11`)
            .bind(...(broadcast ? [] : [source.recipient_user_id]), job.afterSubscriptionId ?? 0, job.id).all<SubscriptionRow>();
          const selected = candidates.results.slice(0, 10);
          const tasks: MessageSendRequest<WebPushJob>[] = [];
          for (const subscription of selected) {
            if (await eligibleRecipient(runtime, subscription, kind, job.id)) tasks.push({ body: { kind: "deliver", eventKind: kind,
              id: job.id, subscriptionId: subscription.id, sessionId: subscription.session_id, userId: subscription.user_id } });
          }
          if (candidates.results.length > selected.length) tasks.push({ body: { ...job, afterSubscriptionId: selected[selected.length - 1].id } });
          if (tasks.length) await config.queue.sendBatch(tasks);
        }
      }
      message.ack();
    } catch (error) {
      console.error("Web Push queue delivery failed", { kind: job.kind, attempts: message.attempts,
        error: error instanceof Error ? error.message : String(error),
        status: error instanceof ApiResponseError ? error.status : undefined });
      message.retry({ delaySeconds: 60 * 2 ** (message.attempts - 1) });
    }
  }
}

/** Flush committed outbox events after API mutations and during daily maintenance. */
export async function enqueueWebPush(env: CloudflareEnv) {
  const config = webPushConfiguration(env);
  if (!config) return;
  const pending = await env.DB.prepare("SELECT id,kind,event_id FROM web_push_outbox ORDER BY id LIMIT 100")
    .all<{ id: number; kind: "inbox" | "messages"; event_id: number }>();
  if (!pending.results.length) return;
  // Reserve one of the Queue batch's 100 slots to continue a larger backlog.
  const selected = pending.results.slice(0, 99);
  const jobs: MessageSendRequest<WebPushJob>[] = selected.map(row => ({ body: { kind: row.kind, id: row.event_id } }));
  if (pending.results.length > selected.length) jobs.push({ body: { kind: "drain" } });
  await config.queue.sendBatch(jobs);
  // If sending fails, the committed outbox remains available for a later request or daily retry.
  await env.DB.prepare("DELETE FROM web_push_outbox WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(selected.map(row => row.id))).run();
}
