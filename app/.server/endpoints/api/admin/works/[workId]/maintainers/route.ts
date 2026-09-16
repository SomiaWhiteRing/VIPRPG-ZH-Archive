import { requirePermission } from "@/app/.server/auth/authorize";
import { setWorkMaintainer } from "@/app/.server/db/catalog-maintenance";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  const auth = await requirePermission(
    runtime,
    request,
    "work.maintainer.manage_any",
  );
  if ("response" in auth) return auth.response;
  try {
    const id = parsePositiveId((await context.params).workId, "work id");
    const form = await request.formData();
    await setWorkMaintainer(
      runtime,
      auth.user,
      id,
      String(form.get("email") ?? ""),
      form.get("remove") === "1",
    );
    return json({ ok: true, redirectTo: `/admin/works/${id}` });
  } catch (error) {
    return jsonError("维护者调整失败", error);
  }
}
