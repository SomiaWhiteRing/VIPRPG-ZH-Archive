import { requirePermission } from "@/app/.server/auth/authorize";
import { saveNetplaySpace, setWorkNetplaySpace } from "@/app/.server/db/netplay-spaces";
import { formOrJsonError, redirectResponse } from "@/app/.server/http/form";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requirePermission(runtime, request, "system.maintenance.run");
  if ("response" in auth) return auth.response;
  const destination = "/admin/netplay-spaces";
  try {
    await saveNetplaySpace(runtime, await request.formData());
    return redirectResponse(new URL(destination, request.url));
  } catch (error) {
    return formOrJsonError(request, destination, "Netplay space update failed", error);
  }
}

export async function bindWork(runtime: AppRuntime, request: Request, rawWorkId: string) {
  const auth = await requirePermission(runtime, request, "work.distribution.update_any");
  if ("response" in auth) return auth.response;
  const workId = parsePositiveId(rawWorkId);
  const destination = `/admin/works/${workId}`;
  try {
    const form = await request.formData();
    const space = form.get("space_id");
    await setWorkNetplaySpace(runtime, workId, space === "none" ? null : parsePositiveId(String(space ?? "")));
    return redirectResponse(new URL(destination, request.url));
  } catch (error) {
    return formOrJsonError(request, destination, "Work netplay binding failed", error);
  }
}
