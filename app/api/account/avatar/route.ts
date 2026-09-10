import { getAuthContextFromRequest } from "@/lib/server/auth/current-user";
import { assertSameOrigin } from "@/lib/server/auth/origin";
import { updateOwnAvatar } from "@/lib/server/db/users";
import { json, jsonError, HttpError } from "@/lib/server/http/json";
import { storeAvatarPng } from "@/lib/server/storage/avatar";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await getAuthContextFromRequest(request);
    if (!auth) return json({ ok: false, error: "Authentication required" }, { status: 401 });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("image/png")) throw new HttpError(415, "头像必须是 PNG 文件");
    const body = await request.arrayBuffer();
    const sha256 = await storeAvatarPng(body);
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
