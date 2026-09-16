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
    const page = await listReplies(
      runtime,
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
