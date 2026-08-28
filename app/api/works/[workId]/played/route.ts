import { requireUser } from "@/lib/server/auth/guards";
import { recordWorkPlayed } from "@/lib/server/db/work-community";
import { jsonError } from "@/lib/server/http/json";
import { parsePositiveId } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ workId: string }> },
) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    await recordWorkPlayed(parsePositiveId((await context.params).workId, "work id"), auth.user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError("Work play recording failed", error);
  }
}
