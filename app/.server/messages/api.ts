import { Hono } from "hono";
import { requireUser } from "@/app/.server/auth/guards";
import { userPermissionSql } from "@/app/.server/auth/permission-sql";
import { directMessagePeer, findSentDirectMessage, listDirectConversations, listDirectMessages, markDirectMessagesRead, sendDirectMessage } from "@/app/.server/db/messages";
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
messageApi.get("/api/messages/conversations", async c => {
  const before = c.req.query("before");
  return json({ ok: true, ...await listDirectConversations(c.get("runtime"), c.get("messageUser"),
    before === undefined ? undefined : parsePositiveId(before)) });
});
messageApi.get("/api/messages/images/:messageId", async c => {
  const runtime = c.get("runtime"), user = c.get("messageUser");
  const id = parsePositiveId(c.req.param("messageId"));
  const image = await runtime.db.prepare(`SELECT i.object_key,i.format FROM direct_messages m
    JOIN direct_message_images i ON i.id=m.image_id AND i.state='ready'
    WHERE m.id=? AND (m.sender_user_id=? OR m.recipient_user_id=?)`)
    .bind(id, user.id, user.id).first<{ object_key: string; format: string }>();
  if (!image) throw new HttpError(404, "图片不存在");
  const object = await runtime.bucket.get(image.object_key);
  if (!object) throw new HttpError(404, "图片不存在");
  return new Response(object.body, { headers: { "Content-Type": `image/${image.format}`, "Content-Length": String(object.size),
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
});
messageApi.get("/api/messages/:peerId/socket", async c => {
  const runtime = c.get("runtime"), user = c.get("messageUser");
  if (c.req.header("Origin") !== runtime.origin) throw new HttpError(403, "连接来源无效");
  const peerId = parsePositiveId(c.req.param("peerId"));
  await directMessagePeer(runtime, user, peerId);
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Message-User", String(user.id));
  return runtime.env.MESSAGE_ROOM.getByName(`${Math.min(user.id, peerId)}:${Math.max(user.id, peerId)}`)
    .fetch(new Request(c.req.url, { headers }));
});
messageApi.get("/api/messages/:peerId", async c => {
  const before = c.req.query("before"), after = c.req.query("after");
  if (before && after) throw new HttpError(400, "分页位置无效");
  return json({ ok: true, ...await listDirectMessages(c.get("runtime"), c.get("messageUser"), parsePositiveId(c.req.param("peerId")), {
    before: before === undefined ? undefined : parsePositiveId(before),
    after: after === undefined ? undefined : after === "0" ? 0 : parsePositiveId(after),
  }) });
});
messageApi.post("/api/messages/:peerId/read", async c => {
  const input = await readJsonObject(c.req.raw, "已读位置无效", { maximumBytes: 1024 });
  if (typeof input.through !== "number" || !Number.isSafeInteger(input.through) || input.through < 1)
    throw new HttpError(400, "已读位置无效");
  await markDirectMessagesRead(c.get("runtime"), c.get("messageUser").id, parsePositiveId(c.req.param("peerId")), input.through);
  return json({ ok: true });
});
messageApi.post("/api/messages/:peerId", async c => {
  const input = await readJsonObject(c.req.raw, "消息格式无效", { maximumBytes: 20000, requireJsonContentType: true });
  const message = await sendDirectMessage(c.get("runtime"), c.get("messageUser"), parsePositiveId(c.req.param("peerId")),
    { kind: "text", clientId: messageClientId(input.clientId), body: messageBody(input.body) });
  return json({ ok: true, message });
});
messageApi.post("/api/messages/:peerId/image", async c => {
  const runtime = c.get("runtime"), user = c.get("messageUser"), peerId = parsePositiveId(c.req.param("peerId"));
  const peer = await directMessagePeer(runtime, user, peerId);
  if (!peer.canSend) throw new HttpError(403, "无法向此用户发送短信");
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.startsWith("multipart/form-data;")) throw new HttpError(415, "图片格式无效");
  const bytes = await readRequestBody(c.req.raw, MESSAGE_IMAGE_BYTES + 16384);
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new HttpError(400, "图片格式无效"); }
  const clientId = messageClientId(form.get("clientId")), file = form.get("image");
  if (!(file instanceof File)) throw new HttpError(400, "请选择图片");
  const existing = await findSentDirectMessage(runtime, user.id, peerId, { kind: "image", clientId });
  if (existing) return json({ ok: true, message: existing });
  const imageBytes = await file.arrayBuffer();
  let meta: ReturnType<typeof inspectImage>;
  try { meta = inspectImage(imageBytes, MESSAGE_IMAGE_BYTES); }
  catch (error) { if (error instanceof ImageValidationError) throw new HttpError(error.status, error.message); throw error; }
  if (meta.format === "bmp" || (file.type && file.type !== `image/${meta.format}`)) throw new HttpError(400, "图片格式无效");
  const imageId = crypto.randomUUID();
  await runtime.db.prepare(`INSERT INTO direct_message_images(id,sender_user_id,recipient_user_id,client_id,object_key,format,size,width,height,state)
    SELECT ?,?,?,?,?,?,?,?,?,'uploading' WHERE ${userPermissionSql(String(user.id), "message.send")}
      AND EXISTS(SELECT 1 FROM users WHERE id=? AND status='active' AND receive_private_messages=1)
      AND (SELECT COUNT(*) FROM direct_message_images WHERE sender_user_id=? AND created_at>=datetime('now','-1 minute'))<12
    ON CONFLICT(sender_user_id,client_id) DO NOTHING`)
    .bind(imageId, user.id, peerId, clientId, privateMessageImageKey(imageId), meta.format, meta.size, meta.width, meta.height, peerId, user.id).run();
  const image = await runtime.db.prepare(`SELECT id,recipient_user_id,object_key,format,size,width,height,state
    FROM direct_message_images WHERE sender_user_id=? AND client_id=?`).bind(user.id, clientId)
    .first<{ id: string; recipient_user_id: number; object_key: string; format: string; size: number; width: number; height: number; state: string }>();
  if (!image) throw new HttpError(429, "发送过于频繁，请稍后重试");
  if (image.recipient_user_id !== peerId || image.format !== meta.format || image.size !== meta.size || image.width !== meta.width || image.height !== meta.height)
    throw new HttpError(409, "消息编号已用于其他图片");
  if (image.state === "uploading")
    await runtime.bucket.put(image.object_key, imageBytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: `image/${meta.format}` } });
  else if (image.state !== "ready") throw new HttpError(409, "图片发送状态已变化");
  return json({ ok: true, message: await sendDirectMessage(runtime, user, peerId, { kind: "image", clientId, imageId: image.id }) });
});
