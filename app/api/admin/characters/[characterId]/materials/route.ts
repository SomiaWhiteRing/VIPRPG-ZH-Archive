import { CHARACTER_DETAIL_PERMISSIONS } from "@/lib/authz/permissions";
import { ForumImageValidationError, inspectForumImage } from "@/lib/forum-image-format";
import { requireAnyPermission, requirePermission } from "@/lib/server/auth/authorize";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { getD1 } from "@/lib/server/db/d1";
import { parseCharacterPortraitLibraryForm, prepareCharacterPortraitLibraryUpdate, searchCharacterMaterialsForAdmin, type AdminCharacterMaterial } from "@/lib/server/db/character-portrait-library";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { getBlob } from "@/lib/server/storage/archive-bucket";
import { storeWorkImages } from "@/lib/server/storage/work-images";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ characterId: string }> };

async function requireCharacter(context: Context) {
  const { characterId: raw } = await context.params;
  const id = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id)) throw new HttpError(400, "角色 ID 不合法");
  if (!await getD1().prepare("SELECT id FROM characters WHERE id=?").bind(id).first()) throw new HttpError(404, "角色不存在");
  return id;
}

// The workbench can preview unbound materials without making them public.
export async function GET(request: Request, context: Context) {
  const auth = await requireAnyPermission(request, CHARACTER_DETAIL_PERMISSIONS);
  if ("response" in auth) return auth.response;
  try {
    await requireCharacter(context);
    const params = new URL(request.url).searchParams;
    if (!params.has("blob")) {
      const page = await searchCharacterMaterialsForAdmin({
        kind: params.get("kind") ?? "faceset", query: params.get("q") ?? "", offset: Number(params.get("offset") ?? 0),
      });
      return json({ ok: true, ...page }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const hash = params.get("blob") ?? "";
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new HttpError(400, "素材地址不合法");
    const row = await getD1().prepare(`SELECT content_type_hint AS type,size_bytes AS size FROM blobs b
      WHERE sha256=? AND status='active' AND (
        EXISTS (SELECT 1 FROM character_materials m WHERE m.blob_sha256=b.sha256)
        OR EXISTS (SELECT 1 FROM face_sheets fs WHERE fs.blob_sha256=b.sha256 AND fs.library_status!='rejected'))`)
      .bind(hash).first<{ type: string; size: number }>();
    if (!row || !["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"].includes(row.type)) throw new HttpError(404, "素材不存在");
    const object = await getBlob(hash);
    if (!object) throw new HttpError(404, "素材文件缺失");
    return new Response(object.body, { headers: {
      "Content-Type": row.type, "Content-Length": String(row.size),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return jsonError("素材读取失败", error); }
}

export async function POST(request: Request, context: Context) {
  const auth = await requirePermission(request, "character.portrait.upload");
  if ("response" in auth) return auth.response;
  try {
    const characterId = await requireCharacter(context);
    const form = await request.formData();
    const kind = String(form.get("kind"));
    if (!["charset", "monster", "other"].includes(kind)) throw new HttpError(400, "请选择素材分类");
    const file = form.get("image");
    if (!(file instanceof File) || !file.size || file.size > 2 * 1024 * 1024) throw new HttpError(400, "请选择不超过 2 MiB 的图片");
    let info;
    try { info = inspectForumImage(await file.arrayBuffer()); }
    catch (error) {
      if (error instanceof ForumImageValidationError) throw new HttpError(error.status, error.message);
      throw error;
    }
    if (info.width > 8192 || info.height > 8192 || info.width * info.height > 16_777_216) throw new HttpError(400, "图片尺寸过大，最长边不能超过 8192 像素，总像素不能超过 1600 万");
    const [hash] = await storeWorkImages([new File([file], file.name, { type: `image/${info.format}` })]);
    const db = getD1();
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO character_materials(blob_sha256,kind,width_px,height_px) VALUES(?,?,?,?)`).bind(hash, kind, info.width, info.height),
      db.prepare(`INSERT OR IGNORE INTO character_material_bindings(character_id,material_id)
        SELECT ?,id FROM character_materials WHERE blob_sha256=? AND kind=?`).bind(characterId, hash, kind),
    ]);
    const material = await db.prepare(`SELECT id,kind,blob_sha256 AS blobSha256,width_px AS width,height_px AS height,'' AS relatedNames,1 AS isPublic
      FROM character_materials WHERE blob_sha256=? AND kind=?`).bind(hash, kind).first<AdminCharacterMaterial>();
    if (!material) throw new HttpError(500, "素材已上传，但没有返回素材记录");
    await writeAuthAuditLog({ userId: auth.user.id, email: auth.user.email, eventType: "admin_character_material_upload", detail: { characterId, kind, sha256: hash } });
    return json({ ok: true, material }, { status: 201 });
  } catch (error) { return jsonError("素材上传失败", error); }
}

export async function PUT(request: Request, context: Context) {
  const auth = await requirePermission(request, "character.portrait.manage_any");
  if ("response" in auth) return auth.response;
  try {
    const characterId = await requireCharacter(context);
    const form = await request.formData();
    if (!["face_sheet_ids", "default_portrait", "material_ids"].every((key) => form.has(key))) throw new HttpError(400, "素材配置不完整，请刷新重试");
    const portrait = parseCharacterPortraitLibraryForm(form);
    let parsed: unknown;
    try { parsed = JSON.parse(String(form.get("material_ids"))); }
    catch { throw new HttpError(400, "素材配置格式不合法"); }
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) throw new HttpError(400, "素材 ID 不合法");
    const ids = [...new Set(parsed as number[])];
    const db = getD1();
    const selected = JSON.stringify(ids);
    const count = await db.prepare(`SELECT count(*) AS count FROM character_materials m JOIN blobs b ON b.sha256=m.blob_sha256
      WHERE m.id IN (SELECT value FROM json_each(?)) AND b.status='active'`).bind(selected).first<{ count: number }>();
    if (count?.count !== ids.length) throw new HttpError(400, "部分素材已不可用，请刷新后重试");
    const statements = await prepareCharacterPortraitLibraryUpdate({ ...portrait, characterId, actorUserId: auth.user.id });
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO character_material_bindings(character_id,material_id)
        SELECT ?,value FROM json_each(?)`).bind(characterId, selected),
      db.prepare(`DELETE FROM character_material_bindings WHERE character_id=? AND material_id NOT IN (SELECT value FROM json_each(?))`).bind(characterId, selected),
      db.prepare(`UPDATE character_material_bindings SET sort_order=(
        SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=material_id
      ) WHERE character_id=?`).bind(selected, characterId),
      db.prepare(`UPDATE character_face_sheet_bindings SET sort_order=(
        SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=face_sheet_id
      ) WHERE character_id=?`).bind(JSON.stringify(portrait.faceSheetIds), characterId),
    );
    await db.batch(statements);
    await writeAuthAuditLog({ userId: auth.user.id, email: auth.user.email, eventType: "admin_character_material_update", detail: { characterId, faceSheetIds: JSON.stringify(portrait.faceSheetIds), materialIds: selected } });
    return json({ ok: true });
  } catch (error) { return jsonError("素材保存失败", error); }
}
