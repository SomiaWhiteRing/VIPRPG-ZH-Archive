import { requireUser } from "@/app/.server/auth/guards";
import { likeComment, unlikeComment } from "@/app/.server/db/work-community";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { jsonError } from "@/lib/http";

export async function PUT(
  runtime: AppRuntime,
  request: Request,
  context: { params: { commentId: string } },
) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    await likeComment(
      runtime,
      parsePositiveId((await context.params).commentId, "comment id"),
      auth.user.id,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError("Comment like failed", error);
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
    await unlikeComment(
      runtime,
      parsePositiveId((await context.params).commentId, "comment id"),
      auth.user.id,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError("Comment unlike failed", error);
  }
}
