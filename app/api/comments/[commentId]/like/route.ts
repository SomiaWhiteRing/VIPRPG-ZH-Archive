import { requireUser } from "@/lib/server/auth/guards";
import { likeComment, unlikeComment } from "@/lib/server/db/work-community";
import { jsonError } from "@/lib/server/http/json";
import { parsePositiveId } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    await likeComment(parsePositiveId((await context.params).commentId, "comment id"), auth.user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError("Comment like failed", error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    await unlikeComment(parsePositiveId((await context.params).commentId, "comment id"), auth.user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError("Comment unlike failed", error);
  }
}
