import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import { recordView } from "@/app/.server/views/service";
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
    await recordView(
      runtime,
      "work",
      parsePositiveId((await context.params).workId, "work id"),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof SameOriginError) {
      return new Response(null, { status: 403 });
    }
    return jsonError("Work view recording failed", error);
  }
}
