import { requirePermission } from "@/app/.server/auth/authorize";
import { mergeWorkGenreGroups } from "@/app/.server/db/work-genres";
import { formOrJsonError, redirectResponse } from "@/app/.server/http/form";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requirePermission(runtime, request, "genre.manage");
  if ("response" in auth) return auth.response;
  try {
    const form = await request.formData();
    await mergeWorkGenreGroups(runtime, {
      sourceGroup: parsePositiveId(String(form.get("source_group") ?? "")),
      targetGroup: parsePositiveId(String(form.get("target_group") ?? "")),
      sourceSnapshot: String(form.get("source_snapshot") ?? ""),
      targetSnapshot: String(form.get("target_snapshot") ?? ""),
      userId: auth.user.id,
    });
    return redirectResponse(new URL("/admin/genres", request.url));
  } catch (error) {
    return formOrJsonError(request, "/admin/genres", "Genre merge failed", error);
  }
}
