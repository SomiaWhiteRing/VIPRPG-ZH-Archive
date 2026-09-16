import { requirePermission } from "@/app/.server/auth/authorize";
import { moderateComment } from "@/app/.server/db/work-community";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function PATCH(
  runtime: AppRuntime,
  request: Request,
  context: { params: { commentId: string } },
) {
  const auth = await requirePermission(runtime, request, "comment.manage_any");
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid moderation body");
    if (body.status !== "published" && body.status !== "hidden") {
      return json({ ok: false, error: "status is invalid" }, { status: 400 });
    }
    const comment = await moderateComment(
      runtime,
      parsePositiveId((await context.params).commentId, "comment id"),
      auth.user,
      body.status,
    );
    return json({ ok: true, comment });
  } catch (error) {
    return jsonError("Comment moderation failed", error);
  }
}
