import { assertSameOrigin, SameOriginError } from "@/app/.server/auth/origin";
import { recordView } from "@/app/.server/views/service";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, jsonError } from "@/lib/http";
import { canReadWork } from "@/app/.server/db/work-visibility";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  try {
    assertSameOrigin(runtime, request);
    const workId = parsePositiveId((await context.params).workId, "work id");
    if (!await canReadWork(runtime, workId)) throw new HttpError(404, "作品不存在");
    await recordView(
      runtime,
      "work",
      workId,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof SameOriginError) {
      return new Response(null, { status: 403 });
    }
    return jsonError("Work view recording failed", error);
  }
}
