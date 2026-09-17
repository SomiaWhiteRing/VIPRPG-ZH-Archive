import { getCurrentUser } from "@/app/.server/auth/current-user";
import { listReplies } from "@/app/.server/db/work-community";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function GET(
  runtime: AppRuntime,
  request: Request,
  context: { params: { commentId: string } },
) {
  try {
    const user = await getCurrentUser(runtime);
    const url = new URL(request.url);
    const replyId = url.searchParams.get("comment");
    const page = await listReplies(
      runtime,
      parsePositiveId((await context.params).commentId, "comment id"),
      user?.id ?? null,
      Number(url.searchParams.get("page") ?? 1),
      replyId === null ? undefined : parsePositiveId(replyId, "reply id"),
    );
    return json({ ok: true, ...page });
  } catch (error) {
    return jsonError("Replies could not be loaded", error);
  }
}
