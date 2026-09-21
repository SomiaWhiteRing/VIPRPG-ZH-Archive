import { requireAnyPermission } from "@/app/.server/auth/authorize";
import { editPublicCreator } from "@/app/.server/db/creator-edit";
import { getPublicCreatorDetail } from "@/app/.server/db/creator-library";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { storeAvatarPng } from "@/app/.server/storage/avatar";
import { CREATOR_PUBLIC_EDIT_PERMISSIONS } from "@/lib/authz/creator-permissions";
import { HttpError, json, jsonError } from "@/lib/http";

type RouteContext = { params: { creatorId: string } };

export async function PUT(runtime: AppRuntime, request: Request, context: RouteContext) {
  return updateAvatar(runtime, request, context);
}

export async function DELETE(runtime: AppRuntime, request: Request, context: RouteContext) {
  return updateAvatar(runtime, request, context);
}

async function updateAvatar(runtime: AppRuntime, request: Request, context: RouteContext) {
  const auth = await requireAnyPermission(runtime, request, CREATOR_PUBLIC_EDIT_PERMISSIONS);
  if ("response" in auth) return auth.response;
  try {
    const creatorId = parsePositiveId(context.params.creatorId, "creator id");
    const previousAvatar = new URL(request.url).searchParams.get("previous");
    if (previousAvatar === null || (previousAvatar !== "none" && !/^[a-f0-9]{64}$/.test(previousAvatar))) throw new HttpError(400, "缺少头像版本，请刷新后重试");
    const creator = await getPublicCreatorDetail(runtime, creatorId);
    if (!creator) throw new HttpError(404, "作者不存在或尚未公开");
    const previous = previousAvatar === "none" ? null : previousAvatar;
    if (creator.avatarBlobSha256 !== previous) throw new HttpError(409, "头像已被其他人修改，请刷新后重试");
    let avatarBlobSha256: string | null = null;
    if (request.method === "PUT") {
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("image/png")) throw new HttpError(415, "头像必须是 PNG 文件");
      avatarBlobSha256 = await storeAvatarPng(runtime, await request.arrayBuffer());
    }
    await editPublicCreator(runtime, creatorId, auth.user.id, { avatarBlobSha256, previousAvatar: previous });
    return json({ ok: true, avatarBlobSha256 });
  } catch (error) {
    return jsonError("作者头像保存失败", error);
  }
}
