import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { updateOwnAvatar } from "@/app/.server/db/users";
import type { AppRuntime } from "@/app/.server/runtime";
import { storeAvatarPng } from "@/app/.server/storage/avatar";
import { HttpError, json, jsonError } from "@/lib/http";

export async function PUT(runtime: AppRuntime, request: Request) {
  try {
    assertSameOrigin(runtime, request);
    const auth = await getAuthContext(runtime);
    if (!auth)
      return json(
        { ok: false, error: "Authentication required" },
        { status: 401 },
      );
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("image/png")
    )
      throw new HttpError(415, "头像必须是 PNG 文件");
    const body = await request.arrayBuffer();
    const sha256 = await storeAvatarPng(runtime, body);
    await updateOwnAvatar(runtime, auth.user, sha256);
    return json({ ok: true, avatarBlobSha256: sha256 });
  } catch (error) {
    return jsonError("头像上传失败", error);
  }
}

export async function DELETE(runtime: AppRuntime, request: Request) {
  try {
    assertSameOrigin(runtime, request);
    const auth = await getAuthContext(runtime);
    if (!auth)
      return json(
        { ok: false, error: "Authentication required" },
        { status: 401 },
      );
    await updateOwnAvatar(runtime, auth.user, null);
    return json({ ok: true });
  } catch (error) {
    return jsonError("头像删除失败", error);
  }
}
