import { requirePermission } from "@/app/.server/auth/authorize";
import { changeWorkLifecycle } from "@/app/.server/db/work-lifecycle";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request, context: { params: { workId: string } }) {
  const auth = await requirePermission(runtime, request, "work.status.update_any");
  if ("response" in auth) return auth.response;
  try {
    const workId = parsePositiveId(context.params.workId, "work id");
    const form = await request.formData();
    const operation = form.get("operation");
    const expectedStatus = form.get("expected_status");
    if ((operation !== "delete" && operation !== "restore") ||
      (expectedStatus !== "processing" && expectedStatus !== "published" && expectedStatus !== "deleted"))
      throw new HttpError(400, "作品管理操作不合法");
    await changeWorkLifecycle(runtime, workId, auth.user, operation, expectedStatus);
    return json({ ok: true, redirectTo: `/admin/works/${workId}` });
  } catch (error) {
    return jsonError("作品状态更新失败", error);
  }
}
