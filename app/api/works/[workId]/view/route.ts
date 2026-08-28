import { recordWorkView } from "@/lib/server/db/work-community";
import { jsonError } from "@/lib/server/http/json";
import { parsePositiveId } from "@/lib/server/http/request";
import { assertSameOrigin, SameOriginError } from "@/lib/server/auth/origin";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ workId: string }> },
) {
  try {
    assertSameOrigin(request);
    await recordWorkView(parsePositiveId((await context.params).workId, "work id"));
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof SameOriginError) {
      return new Response(null, { status: 403 });
    }
    return jsonError("Work view recording failed", error);
  }
}
