import { requirePermission } from "@/app/.server/auth/authorize";
import { updateCreatorAvatar } from "@/app/.server/db/creator-library";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { storeAvatarPng } from "@/app/.server/storage/avatar";
import { HttpError, json, jsonError } from "@/lib/http";

type RouteContext = {
  params: { creatorId: string };
};

export async function PUT(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requirePermission(
    runtime,
    request,
    "creator.metadata.update_any",
  );
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
    const sha256 = await storeAvatarPng(runtime, await request.arrayBuffer());
    await updateCreatorAvatar(runtime, creatorId, sha256, auth.user);
    return json({ ok: true, avatarBlobSha256: sha256 });
  } catch (error) {
    return jsonError("作者头像上传失败", error);
  }
}

export async function DELETE(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requirePermission(
    runtime,
    request,
    "creator.metadata.update_any",
  );
  if ("response" in auth) return auth.response;
  try {
    const creatorId = parsePositiveId(
      (await context.params).creatorId,
      "creator id",
    );
    await updateCreatorAvatar(runtime, creatorId, null, auth.user);
    return json({ ok: true });
  } catch (error) {
    return jsonError("作者头像删除失败", error);
  }
}
