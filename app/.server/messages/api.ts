import { translate } from "@/lib/i18n/core";
import { Hono } from "hono";
import { requireUser } from "@/app/.server/auth/guards";
import { userPermissionSql } from "@/app/.server/auth/permission-sql";
import { assertInteractionAllowed, interactionRestrictedSql } from "@/app/.server/db/interaction-restrictions";
import { directMessagePeer, findSentDirectMessage, listDirectConversations, listDirectMessages, markDirectMessagesRead, sendDirectMessage, setDirectMessageReceiving } from "@/app/.server/db/messages";
import { createDirectMessageReport, readDirectMessageReport } from "@/app/.server/db/message-reports";
import { parsePositiveId, readJsonObject, readRequestBody } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { privateMessageImageKey } from "@/lib/archive/object-keys";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError, json } from "@/lib/http";
import { ImageValidationError, inspectImage } from "@/lib/image-format";
import { MESSAGE_IMAGE_BYTES, messageBody, messageClientId } from "@/lib/messages";

export const messageApi = new Hono<{ Bindings: CloudflareEnv; Variables: { runtime: AppRuntime; messageUser: ArchiveUser } }>();
messageApi.use("/api/messages/*", async (c, next) => {
  const auth = await requireUser(c.get("runtime"), c.req.raw);
  if ("response" in auth) return auth.response;
  c.set("messageUser", auth.user);
  await next();
});
async function imageResponse(runtime: AppRuntime, image: { object_key: string; format: string } | null) {
  if (!image) throw new HttpError(404, translate(runtime.uiLocale, "messages.error.imageMissing"), undefined, "messages.error.imageMissing");
  const object = await runtime.bucket.get(image.object_key);
  if (!object) throw new HttpError(404, translate(runtime.uiLocale, "messages.error.imageMissing"), undefined, "messages.error.imageMissing");
  return new Response(object.body, { headers: { "Content-Type": `image/${image.format}`, "Content-Length": String(object.size),
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
}
messageApi.get("/api/messages/conversations", async c => {
  const before = c.req.query("before");
  return json({ ok: true, ...await listDirectConversations(c.get("runtime"), c.get("messageUser"),
    before === undefined ? undefined : parseMessageId(before, "messages.error.cursor")) });
});
messageApi.get("/api/messages/images/:messageId", async c => {
  const runtime = c.get("runtime"), user = c.get("messageUser");
  const id = parseMessageId(c.req.param("messageId"));
  const image = await runtime.db.prepare(`SELECT i.object_key,i.format FROM direct_messages m
    JOIN direct_message_images i ON i.id=m.image_id AND i.state='ready'
    WHERE m.id=? AND (m.sender_user_id=? OR (m.recipient_user_id=? AND m.delivered=1))`)
    .bind(id, user.id, user.id).first<{ object_key: string; format: string }>();
  return imageResponse(runtime, image);
});
messageApi.get("/api/messages/reports/:reportId/images/:messageId", async c => {
  const runtime = c.get("runtime");
  const report = await readDirectMessageReport(runtime, c.get("messageUser"), parseMessageId(c.req.param("reportId")));
  const image = await runtime.db.prepare(`SELECT i.object_key,i.format FROM direct_messages m
    JOIN direct_message_images i ON i.id=m.image_id AND i.state='ready' WHERE m.id=? AND m.conversation_id=?`)
    .bind(parseMessageId(c.req.param("messageId")), report.conversationId).first<{ object_key: string; format: string }>();
  return imageResponse(runtime, image);
});
messageApi.get("/api/messages/:peerId/socket", async c => {
  const runtime = c.get("runtime"), user = c.get("messageUser");
  if (c.req.header("Origin") !== runtime.origin) throw new HttpError(403, translate(runtime.uiLocale, "messages.error.origin"), undefined, "messages.error.origin");
  const peerId = parseMessageId(c.req.param("peerId"));
  await directMessagePeer(runtime, user, peerId);
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Message-User", String(user.id));
  return runtime.env.MESSAGE_ROOM.getByName(`${Math.min(user.id, peerId)}:${Math.max(user.id, peerId)}`)
    .fetch(new Request(c.req.url, { headers }));
});
messageApi.get("/api/messages/:peerId", async c => {
  const runtime = c.get("runtime");
  const before = c.req.query("before"), after = c.req.query("after");
  if (before && after) throw new HttpError(400, translate(runtime.uiLocale, "messages.error.cursor"), undefined, "messages.error.cursor");
  return json({ ok: true, ...await listDirectMessages(runtime, c.get("messageUser"), parseMessageId(c.req.param("peerId")), {
    before: before === undefined ? undefined : parseMessageId(before, "messages.error.cursor"),
    after: after === undefined ? undefined : after === "0" ? 0 : parseMessageId(after, "messages.error.cursor"),
  }) });
});
messageApi.post("/api/messages/:peerId/read", async c => {
  const runtime = c.get("runtime");
  const input = await readJsonObject(c.req.raw, translate(runtime.uiLocale, "messages.error.readPosition"), { maximumBytes: 1024 });
  if (typeof input.through !== "number" || !Number.isSafeInteger(input.through) || input.through < 1)
    throw new HttpError(400, translate(runtime.uiLocale, "messages.error.readPosition"), undefined, "messages.error.readPosition");
  await markDirectMessagesRead(runtime, c.get("messageUser").id, parseMessageId(c.req.param("peerId")), input.through);
  return json({ ok: true });
});
messageApi.post("/api/messages/:peerId/receiving", async c => {
  const runtime = c.get("runtime");
  const input = await readJsonObject(c.req.raw, translate(runtime.uiLocale, "messages.error.receiving"), { maximumBytes: 1024 });
  if (typeof input.receive !== "boolean") throw new HttpError(400, translate(runtime.uiLocale, "messages.error.receiving"), undefined, "messages.error.receiving");
  await setDirectMessageReceiving(runtime, c.get("messageUser"), parseMessageId(c.req.param("peerId")), input.receive);
  return json({ ok: true });
});
messageApi.post("/api/messages/:peerId/report", async c => {
  const runtime = c.get("runtime");
  const input = await readJsonObject(c.req.raw, translate(runtime.uiLocale, "messages.error.reportPayload"), { maximumBytes: 16384 });
  const report = await createDirectMessageReport(runtime, c.get("messageUser"), parseMessageId(c.req.param("peerId")), input);
  return json({ ok: true, ...report });
});
messageApi.post("/api/messages/:peerId", async c => {
  const runtime = c.get("runtime");
  const input = await readJsonObject(c.req.raw, translate(runtime.uiLocale, "messages.error.payload"), { maximumBytes: 20000, requireJsonContentType: true });
  const message = await sendDirectMessage(runtime, c.get("messageUser"), parseMessageId(c.req.param("peerId")),
    { kind: "text", clientId: messageClientId(input.clientId, runtime.uiLocale), body: messageBody(input.body, runtime.uiLocale) });
  return json({ ok: true, message });
});
messageApi.post("/api/messages/:peerId/image", async c => {
  const runtime = c.get("runtime"), user = c.get("messageUser"), peerId = parseMessageId(c.req.param("peerId"));
  const peer = await directMessagePeer(runtime, user, peerId);
  if (!peer.canSend) throw new HttpError(403, translate(runtime.uiLocale, "messages.error.cannotSend"), undefined, "messages.error.cannotSend");
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.startsWith("multipart/form-data;")) throw new HttpError(415, translate(runtime.uiLocale, "messages.error.imageFormat"), undefined, "messages.error.imageFormat");
  const bytes = await readRequestBody(c.req.raw, MESSAGE_IMAGE_BYTES + 16384);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new HttpError(400, translate(runtime.uiLocale, "messages.error.imageFormat"), undefined, "messages.error.imageFormat"); }
  const clientId = messageClientId(form.get("clientId"), runtime.uiLocale), file = form.get("image");
  if (!(file instanceof File)) throw new HttpError(400, translate(runtime.uiLocale, "image.choose"), undefined, "image.choose");
  const existing = await findSentDirectMessage(runtime, user.id, peerId, { kind: "image", clientId });
  if (existing) return json({ ok: true, message: existing });
  await assertInteractionAllowed(runtime.db, peerId, user.id, "message");
  const imageBytes = await file.arrayBuffer();
  let meta: ReturnType<typeof inspectImage>;
  try { meta = inspectImage(imageBytes, MESSAGE_IMAGE_BYTES); }
  catch (error) {
    if (!(error instanceof ImageValidationError)) throw error;
    const messageKey = error.status === 413 ? "image.size" : "messages.error.imageFormat";
    throw new HttpError(error.status, translate(runtime.uiLocale, messageKey), undefined, messageKey);
  }
  if (meta.format === "bmp" || (file.type && file.type !== `image/${meta.format}`)) throw new HttpError(400, translate(runtime.uiLocale, "messages.error.imageFormat"), undefined, "messages.error.imageFormat");
  const imageId = crypto.randomUUID();
  await runtime.db.prepare(`INSERT INTO direct_message_images(id,sender_user_id,recipient_user_id,client_id,object_key,format,size,width,height,state)
    SELECT ?,?,?,?,?,?,?,?,?,'uploading' WHERE ${userPermissionSql(String(user.id), "message.send")}
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND receive_private_messages=1
        AND NOT ${interactionRestrictedSql("users.id", String(user.id), "message")})
      AND (SELECT COUNT(*) FROM direct_message_images WHERE sender_user_id=? AND created_at>=datetime('now','-1 minute'))<12
    ON CONFLICT(sender_user_id,client_id) DO NOTHING`)
    .bind(imageId, user.id, peerId, clientId, privateMessageImageKey(imageId), meta.format, meta.size, meta.width, meta.height, peerId, user.id).run();
  const image = await runtime.db.prepare(`SELECT id,recipient_user_id,object_key,format,size,width,height,state
    FROM direct_message_images WHERE sender_user_id=? AND client_id=?`).bind(user.id, clientId)
    .first<{ id: string; recipient_user_id: number; object_key: string; format: string; size: number; width: number; height: number; state: string }>();
  if (!image) throw new HttpError(429, translate(runtime.uiLocale, "messages.error.rate"), undefined, "messages.error.rate");
  if (image.recipient_user_id !== peerId || image.format !== meta.format || image.size !== meta.size || image.width !== meta.width || image.height !== meta.height)
    throw new HttpError(409, translate(runtime.uiLocale, "messages.error.imageConflict"), undefined, "messages.error.imageConflict");
  if (image.state === "uploading")
    await runtime.bucket.put(image.object_key, imageBytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: `image/${meta.format}` } });
  else if (image.state !== "ready") throw new HttpError(409, translate(runtime.uiLocale, "messages.error.imageState"), undefined, "messages.error.imageState");
  return json({ ok: true, message: await sendDirectMessage(runtime, user, peerId, { kind: "image", clientId, imageId: image.id }) });
});

function parseMessageId(value: string, messageKey: "messages.error.recordId" | "messages.error.cursor" = "messages.error.recordId") {
  return parsePositiveId(value, undefined, undefined, undefined, messageKey);
}
