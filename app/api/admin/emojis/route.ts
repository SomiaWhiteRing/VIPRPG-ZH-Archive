import { requirePermission } from "@/lib/server/auth/authorize";
import { sha256Hex } from "@/lib/server/crypto/sha256";
import {
  createCustomEmoji,
  listAdminEmojis,
  updateCustomEmoji,
} from "@/lib/server/db/work-community";
import { insertBlobRecord } from "@/lib/server/db/archive-objects";
import { getD1 } from "@/lib/server/db/d1";
import { json, jsonError, HttpError } from "@/lib/server/http/json";
import { readJsonObject } from "@/lib/server/http/request";
import { putBlob } from "@/lib/server/storage/archive-bucket";

export const dynamic = "force-dynamic";
const MAX_EMOJI_BYTES = 512 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function GET(request: Request) {
  const auth = await requirePermission(request, "custom_emoji.manage");
  if ("response" in auth) return auth.response;
  try {
    return json({ ok: true, emojis: await listAdminEmojis() });
  } catch (error) {
    return jsonError("Admin emoji catalog could not be loaded", error);
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "custom_emoji.manage");
  if ("response" in auth) return auth.response;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new HttpError(400, "表情图片不能为空");
    if (!ALLOWED_TYPES.has(file.type.toLowerCase())) throw new HttpError(400, "只支持 PNG、JPEG、GIF 或 WebP 图片");
    if (file.size <= 0 || file.size > MAX_EMOJI_BYTES) throw new HttpError(400, "表情图片大小不合法");
    const body = await file.arrayBuffer();
    const sha256 = await sha256Hex(body);
    const existing = await getD1().prepare(`SELECT status FROM blobs WHERE sha256=? LIMIT 1`).bind(sha256).first<{ status: string }>();
    if (existing?.status !== "active") {
      await putBlob(sha256, body, body.byteLength, file.type);
      await insertBlobRecord({ sha256, sizeBytes: body.byteLength, contentTypeHint: file.type, observedExt: null });
    }
    const emoji = await createCustomEmoji({
      shortcode: String(form.get("shortcode") ?? ""),
      name: String(form.get("name") ?? ""),
      category: String(form.get("category") ?? "站点"),
      visibleInPicker: String(form.get("visibleInPicker") ?? "true") !== "false",
      imageBlobSha256: sha256,
    });
    return json({ ok: true, emoji }, { status: 201 });
  } catch (error) {
    return jsonError("Emoji upload failed", error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requirePermission(request, "custom_emoji.manage");
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid emoji body");
    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "表情 ID 不合法");
    const status = body.status === undefined ? undefined : body.status === "active" || body.status === "retired" ? body.status : null;
    if (status === null) throw new HttpError(400, "表情状态不合法");
    const emoji = await updateCustomEmoji(id, {
      name: body.name === undefined ? undefined : String(body.name),
      category: body.category === undefined ? undefined : String(body.category),
      visibleInPicker: body.visibleInPicker === undefined ? undefined : Boolean(body.visibleInPicker),
      status,
    });
    return json({ ok: true, emoji });
  } catch (error) {
    return jsonError("Emoji update failed", error);
  }
}
