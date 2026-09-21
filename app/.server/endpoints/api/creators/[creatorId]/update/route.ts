import { requireAnyPermission } from "@/app/.server/auth/authorize";
import { editPublicCreator } from "@/app/.server/db/creator-edit";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { CREATOR_PUBLIC_EDIT_PERMISSIONS } from "@/lib/authz/creator-permissions";
import { parseCreatorLinks } from "@/lib/creator-links";
import { HttpError, json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { creatorId: string } },
) {
  const auth = await requireAnyPermission(runtime, request, CREATOR_PUBLIC_EDIT_PERMISSIONS);
  if ("response" in auth) return auth.response;
  try {
    const id = parsePositiveId(context.params.creatorId, "creator id");
    const form = await request.formData();
    function field(name: string) {
      const value = form.get(name);
      if (typeof value !== "string") throw new HttpError(400, "资料不完整，请重新打开编辑器");
      return value;
    }
    const aliases = form.getAll("alias");
    if (aliases.some((value) => typeof value !== "string")) throw new HttpError(400, "别名格式不正确");
    await editPublicCreator(runtime, id, auth.user.id, {
      snapshot: field("snapshot"),
      metadata: { name: field("name"), links: parseCreatorLinks(field("links_json")), bio: field("bio"), aliases: aliases as string[] },
    });
    return json({ ok: true });
  } catch (error) {
    return jsonError("作者资料保存失败", error);
  }
}
