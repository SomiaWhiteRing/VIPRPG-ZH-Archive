import { requirePermission } from "@/lib/server/auth/authorize";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { updateCreatorAvatar } from "@/lib/server/db/creator-library";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId } from "@/lib/server/http/request";
import { storeAvatarPng } from "@/lib/server/storage/avatar";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ creatorId: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requirePermission(request, "creator.metadata.update_any");
  if ("response" in auth) return auth.response;
  try {
    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("image/png")
    ) {
      throw new HttpError(415, "头像必须是 PNG 文件");
    }
    const creatorId = parsePositiveId(
      (await context.params).creatorId,
      "creator id",
    );
    const sha256 = await storeAvatarPng(await request.arrayBuffer());
    await updateCreatorAvatar(creatorId, sha256);
    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_creator_avatar_update",
      detail: { creatorId, avatarBlobSha256: sha256 },
    });
    return json({ ok: true, avatarBlobSha256: sha256 });
  } catch (error) {
    return jsonError("作者头像上传失败", error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requirePermission(request, "creator.metadata.update_any");
  if ("response" in auth) return auth.response;
  try {
    const creatorId = parsePositiveId(
      (await context.params).creatorId,
      "creator id",
    );
    await updateCreatorAvatar(creatorId, null);
    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_creator_avatar_delete",
      detail: { creatorId },
    });
    return json({ ok: true });
  } catch (error) {
    return jsonError("作者头像删除失败", error);
  }
}
