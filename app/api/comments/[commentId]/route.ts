import { requireUser } from "@/lib/server/auth/guards";
import { updateComment, deleteComment } from "@/lib/server/db/work-community";
import { json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid comment body");
    const comment = await updateComment(
      parsePositiveId((await context.params).commentId, "comment id"),
      auth.user.id,
      body.body,
    );
    return json({ ok: true, comment });
  } catch (error) {
    return jsonError("Comment update failed", error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    await deleteComment(parsePositiveId((await context.params).commentId, "comment id"), auth.user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError("Comment deletion failed", error);
  }
}
