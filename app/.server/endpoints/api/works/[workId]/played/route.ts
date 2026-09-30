import { getCurrentUser } from "@/app/.server/auth/current-user";
import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import { recordWorkPlayed } from "@/app/.server/db/work-community";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  try {
    assertSameOrigin(runtime, request);
    const user = await getCurrentUser(runtime);
    await recordWorkPlayed(
      runtime,
      parsePositiveId((await context.params).workId, "work id"),
      user?.id ?? null,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof SameOriginError) return new Response(null, { status: 403 });
    return jsonError("Work play recording failed", error);
  }
}
