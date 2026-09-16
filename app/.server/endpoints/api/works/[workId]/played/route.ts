import { requireUser } from "@/app/.server/auth/guards";
import { recordWorkPlayed } from "@/app/.server/db/work-community";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    await recordWorkPlayed(
      runtime,
      parsePositiveId((await context.params).workId, "work id"),
      auth.user.id,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError("Work play recording failed", error);
  }
}
