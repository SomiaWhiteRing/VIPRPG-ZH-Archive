import { translate } from "@/lib/i18n/core";
import { Hono } from "hono";
import { requireAnyPermission, requirePermission } from "@/app/.server/auth/authorize";
import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { SEA_MESSAGE_REQUEST_BYTES } from "@/lib/dto/sea";
import { HttpError, json } from "@/lib/http";
import { prepareSeaActor, seaIpKey } from "./identity";
import { seaRoom, seaSubmission } from "./service";
import { readCharacterPickerCategories, readCharacterPickerPage } from "@/app/.server/db/character-picker";
import { readShowcasePortraitSheets } from "@/app/.server/db/showcase-portraits";
import { PUBLIC_CHARACTER_PORTRAIT_CONDITION } from "@/app/.server/db/character-portrait-library";
import type { EmojiCharacter } from "@/lib/face-emojis";

export const seaApi = new Hono<{ Bindings: CloudflareEnv; Variables: { runtime: AppRuntime } }>();
seaApi.get("/api/sea/portraits", async c => {
  const runtime = c.get("runtime");
  const { DB } = runtime.env;
  const params = new URL(c.req.url).searchParams;
  const offset = Number(params.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, translate(runtime.uiLocale, "messages.error.cursor"));
  switch (params.get("op")) {
    case "categories":
      return json({ items: await readCharacterPickerCategories(DB, true) });
    case "characters":
      return json(await readCharacterPickerPage(DB, params.get("q") ?? "", offset, params.get("categoryId"), true));
    case "character": {
      const sheetId = parsePositiveId(params.get("faceSheetId") ?? "", "脸图");
      const row = Number(params.get("row") ?? -1);
      const column = Number(params.get("column") ?? -1);
      if (!Number.isSafeInteger(row) || row < 0 || !Number.isSafeInteger(column) || column < 0)
        throw new HttpError(400, translate(runtime.uiLocale, "sea.avatar.invalid"));
      const character = await DB.prepare(`SELECT ch.id,ch.primary_name AS name,ch.original_name AS originalName
        FROM character_face_sheet_bindings binding
        JOIN characters ch ON ch.id=binding.character_id
        JOIN face_sheets portrait_sheet ON portrait_sheet.id=binding.face_sheet_id
        LEFT JOIN character_default_portraits cdp ON cdp.character_id=ch.id
        LEFT JOIN character_portrait_refs ref ON ref.id=cdp.portrait_ref_id
        WHERE binding.face_sheet_id=? AND ?<portrait_sheet.height_px/48 AND ?<portrait_sheet.width_px/48
          AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}
        ORDER BY CASE WHEN ref.face_sheet_id=binding.face_sheet_id
          THEN CASE WHEN ref.cell_row=? AND ref.cell_column=? THEN 0 ELSE 1 END ELSE 2 END,ch.id LIMIT 1`)
        .bind(sheetId, row, column, row, column).first<Pick<EmojiCharacter, "id" | "name" | "originalName">>();
      return json({ character });
    }
    case "sheets":
      return json(await readShowcasePortraitSheets(DB, parsePositiveId(params.get("characterId") ?? "", "角色"), offset));
    default:
      throw new HttpError(400, translate(runtime.uiLocale, "sea.avatar.query"));
  }
});
seaApi.get("/api/sea/fonts/:id", async c => {
  const bytes = await seaRoom(c.get("runtime")).font(c.req.param("id"));
  if (!bytes) throw new HttpError(404, "资源不存在");
  return new Response(bytes, { headers: { "Content-Type": "font/woff", "Cache-Control": "public, max-age=86400, immutable" } });
});
seaApi.get("/api/sea/messages", async c => json({ ok: true, ...await seaRoom(c.get("runtime")).snapshot() }));
seaApi.post("/api/sea/messages", async c => {
  const runtime = c.get("runtime");
  try { assertSameOrigin(runtime, c.req.raw); }
  catch (error) {
    if (error instanceof SameOriginError) throw new HttpError(403, error.message);
    throw error;
  }
  const { actor, cookie } = await prepareSeaActor(runtime);
  const input = await seaSubmission(await readJsonObject(c.req.raw, translate(runtime.uiLocale, "sea.payload"), { maximumBytes: SEA_MESSAGE_REQUEST_BYTES, requireJsonContentType: true, fatalUtf8: true }), actor, runtime.env.DB, runtime.uiLocale);
  const result = await seaRoom(runtime).publish(actor, input);
  if (!result.ok) throw new HttpError(result.status, result.detail, result.code);
  return json(result, { status: result.repeated ? 200 : 201, headers: cookie ? { "Set-Cookie": cookie } : undefined });
});
seaApi.get("/api/sea/socket", async c => {
  const runtime = c.get("runtime");
  // assertSameOrigin skips GET; WebSocket handshakes need an explicit Origin check.
  if (c.req.header("Origin") !== runtime.origin) throw new HttpError(403, translate(runtime.uiLocale, "messages.error.origin"));
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Sea-IP", await seaIpKey(runtime));
  return seaRoom(runtime).fetch(new Request(c.req.url, { headers }));
});
seaApi.get("/api/sea/moderation", async c => {
  const runtime = c.get("runtime");
  const auth = await requireAnyPermission(runtime, c.req.raw, ["sea.message.moderate_any", "sea.user.mute_any"]);
  if ("response" in auth) return auth.response;
  const page = parsePositiveId(c.req.query("page") ?? "1", "page", translate(runtime.uiLocale, "admin.sea.page"));
  return json({ ok: true, ...await seaRoom(runtime).moderation(page) });
});
seaApi.delete("/api/sea/messages/:id", async c => {
  const runtime = c.get("runtime");
  const auth = await requirePermission(runtime, c.req.raw, "sea.message.moderate_any");
  if ("response" in auth) return auth.response;
  if (!await seaRoom(runtime).hide(parsePositiveId(c.req.param("id")), auth.user.id)) throw new HttpError(404, translate(runtime.uiLocale, "admin.sea.missing"));
  return json({ ok: true });
});
seaApi.put("/api/sea/mutes", async c => {
  const runtime = c.get("runtime");
  const auth = await requirePermission(runtime, c.req.raw, "sea.user.mute_any");
  if ("response" in auth) return auth.response;
  const body = await readJsonObject(c.req.raw, translate(runtime.uiLocale, "admin.sea.payload"), { maximumBytes: 4096, requireJsonContentType: true });
  const scope = body.scope ?? "identity";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (typeof body.messageId !== "number" || !Number.isSafeInteger(body.messageId) || body.messageId <= 0
    || (body.minutes !== null && (typeof body.minutes !== "number" || !Number.isInteger(body.minutes) || body.minutes < 0 || body.minutes > 5256000))
    || (scope !== "identity" && scope !== "ip") || (body.reason !== undefined && typeof body.reason !== "string") || reason.length > 1000)
    throw new HttpError(400, translate(runtime.uiLocale, "admin.sea.params"));
  if (!await seaRoom(runtime).mute(body.messageId, body.minutes as number | null, auth.user.id, scope, reason)) throw new HttpError(404, translate(runtime.uiLocale, "admin.sea.missingSource"));
  return json({ ok: true });
});
