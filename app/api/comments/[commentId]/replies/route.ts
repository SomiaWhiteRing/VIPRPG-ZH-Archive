import { getCurrentUserFromRequest } from "@/lib/server/auth/current-user";
import { listReplies } from "@/lib/server/db/work-community";
import { json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const url = new URL(request.url);
    const page = await listReplies(
      parsePositiveId((await context.params).commentId, "comment id"),
      user?.id ?? null,
      url.searchParams.get("cursor"),
      Number(url.searchParams.get("limit") ?? 20),
    );
    return json({ ok: true, ...page });
  } catch (error) {
    return jsonError("Replies could not be loaded", error);
  }
}
