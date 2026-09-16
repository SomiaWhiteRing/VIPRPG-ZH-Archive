import { requirePermission } from "@/app/.server/auth/authorize";
import { mergeCreators } from "@/app/.server/db/catalog-maintenance";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { creatorId: string } },
) {
  const auth = await requirePermission(runtime, request, "creator.merge_any");
  if ("response" in auth) return auth.response;
  try {
    const source = parsePositiveId(
      (await context.params).creatorId,
      "creator id",
    );
    const target = parsePositiveId(
      String((await request.formData()).get("target_id") ?? ""),
      "target id",
    );
    await mergeCreators(runtime, auth.user, source, target);
    return json({ ok: true, redirectTo: `/admin/creators/${target}` });
  } catch (error) {
    return jsonError("人物合并失败", error);
  }
}
