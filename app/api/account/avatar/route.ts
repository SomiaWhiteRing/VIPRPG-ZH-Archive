import { getAuthContextFromRequest } from "@/lib/server/auth/current-user";
import { assertSameOrigin } from "@/lib/server/auth/origin";
import { sha256Hex } from "@/lib/server/crypto/sha256";
import { assertObjectUploadAllowed, insertBlobRecord } from "@/lib/server/db/archive-objects";
import { updateOwnAvatar } from "@/lib/server/db/users";
import { json, jsonError, HttpError } from "@/lib/server/http/json";
import { putBlob } from "@/lib/server/storage/archive-bucket";

export const dynamic = "force-dynamic";
const MAX_AVATAR_BYTES = 512 * 1024;

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await getAuthContextFromRequest(request);
    if (!auth) return json({ ok: false, error: "Authentication required" }, { status: 401 });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("image/png")) throw new HttpError(415, "头像必须是 PNG 文件");
    const body = await request.arrayBuffer();
    assertAvatarPng(body);
    const sha256 = await sha256Hex(body);
    await assertObjectUploadAllowed({ kind: "blob", sha256 });
    await putBlob(sha256, body, body.byteLength, "image/png");
    await insertBlobRecord({ sha256, sizeBytes: body.byteLength, contentTypeHint: "image/png", observedExt: "png" });
    await updateOwnAvatar(auth.user, sha256);
    return json({ ok: true, avatarBlobSha256: sha256 });
  } catch (error) {
    return jsonError("头像上传失败", error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await getAuthContextFromRequest(request);
    if (!auth) return json({ ok: false, error: "Authentication required" }, { status: 401 });
    await updateOwnAvatar(auth.user, null);
    return json({ ok: true });
  } catch (error) {
    return jsonError("头像删除失败", error);
  }
}

function assertAvatarPng(buffer: ArrayBuffer): void {
  if (buffer.byteLength > MAX_AVATAR_BYTES) throw new HttpError(413, "头像文件不能超过 512 KiB");
  if (buffer.byteLength < 24) throw new HttpError(400, "PNG 文件不完整");
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) throw new HttpError(400, "PNG 文件签名不正确");
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") throw new HttpError(400, "PNG 文件缺少 IHDR");
  const view = new DataView(buffer);
  if (view.getUint32(16) !== 192 || view.getUint32(20) !== 192) throw new HttpError(400, "头像尺寸必须精确为 192×192");
}
