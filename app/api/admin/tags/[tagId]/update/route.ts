import { requirePermission } from "@/lib/server/auth/authorize";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { parseTagEditForm, updateTagForAdmin } from "@/lib/server/db/taxonomy-library";
import { formOrJsonError, redirectResponse, requestWantsJson } from "@/lib/server/http/form";
import { HttpError, json } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tagId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePermission(request, "tag.update");

  if ("response" in auth) {
    return auth.response;
  }

  const { tagId: rawTagId } = await context.params;
  const fallbackPath = /^[1-9]\d*$/.test(rawTagId)
    ? `/admin/tags/${rawTagId}`
    : "/admin/tags";
  try {
    const tagId = parseId(rawTagId);
    const formData = await request.formData();
    const input = parseTagEditForm(formData);

    if (input.tagId !== tagId) {
      throw new HttpError(400, "标签 ID 与当前页面不一致，请刷新页面后重试。", "tag_id_mismatch");
    }

    const tag = await updateTagForAdmin(input);

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_tag_update",
      detail: {
        tagId,
        resultingTagId: tag.id,
        merged: Boolean(input.mergeTargetId),
      },
    });

    const redirectTo = `/admin/tags/${tag.id}`;
    if (requestWantsJson(request)) {
      return json({ ok: true, redirectTo, tag });
    }

    return redirectResponse(new URL(redirectTo, request.url));
  } catch (error) {
    return formOrJsonError(request, fallbackPath, "Tag update failed", error);
  }
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, "标签 ID 不合法，请返回标签维护页重新进入。", "tag_id_invalid");
  }

  return id;
}
