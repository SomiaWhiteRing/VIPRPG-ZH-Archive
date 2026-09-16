import { requirePermission } from "@/app/.server/auth/authorize";
import { mergeWorks } from "@/app/.server/db/catalog-maintenance";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  const auth = await requirePermission(runtime, request, "work.merge_any");
  if ("response" in auth) return auth.response;
  try {
    const source = parsePositiveId((await context.params).workId, "work id");
    const target = parsePositiveId(
      String((await request.formData()).get("target_id") ?? ""),
      "target id",
    );
    await mergeWorks(runtime, auth.user, source, target);
    return json({ ok: true, redirectTo: `/admin/works/${target}` });
  } catch (error) {
    return jsonError("作品合并失败", error);
  }
}
