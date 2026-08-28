import { requirePermission } from "@/lib/server/auth/authorize";
import { moderateComment } from "@/lib/server/db/work-community";
import { json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
) {
  const auth = await requirePermission(request, "work_comment.manage_any");
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid moderation body");
    if (body.status !== "published" && body.status !== "hidden") {
      return json({ ok: false, error: "status is invalid" }, { status: 400 });
    }
    const comment = await moderateComment(
      parsePositiveId((await context.params).commentId, "comment id"),
      auth.user,
      body.status,
    );
    return json({ ok: true, comment });
  } catch (error) {
    return jsonError("Comment moderation failed", error);
  }
}
