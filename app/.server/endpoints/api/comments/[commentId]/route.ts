import { requireUser } from "@/app/.server/auth/guards";
import { deleteComment, pinComment, updateComment } from "@/app/.server/db/work-community";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function PATCH(
  runtime: AppRuntime,
  request: Request,
  context: { params: { commentId: string } },
) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid comment body");
    const comment = "pinned" in body ? await pinComment(runtime, parsePositiveId(context.params.commentId, "comment id"), auth.user, body.pinned) : await updateComment(
      runtime,
      parsePositiveId((await context.params).commentId, "comment id"),
      auth.user.id,
      body.body,
      body.imageIds,
    );
    return json({ ok: true, comment });
  } catch (error) {
    return jsonError("Comment update failed", error);
  }
}

export async function DELETE(
  runtime: AppRuntime,
  request: Request,
  context: { params: { commentId: string } },
) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    await deleteComment(
      runtime,
      parsePositiveId((await context.params).commentId, "comment id"),
      auth.user.id,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError("Comment deletion failed", error);
  }
}
