import { requirePermission } from "@/app/.server/auth/authorize";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import {
  parseTagEditForm,
  updateTagForAdmin,
} from "@/app/.server/db/taxonomy-library";
import {
  formOrJsonError,
  redirectResponse,
  requestWantsJson,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { json } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
) {
  const auth = await requirePermission(
    runtime,
    request,
    "tag.metadata.update_any",
  );

  if ("response" in auth) {
    return auth.response;
  }

  let fallbackPath = "/admin/tags";
  try {
    const formData = await request.formData();
    const input = parseTagEditForm(formData);
    if (input.originalName) {
      fallbackPath = `/admin/tags/edit?name=${encodeURIComponent(input.originalName)}`;
    }

    const tag = await updateTagForAdmin(runtime, input);

    await writeAuthAuditLog(runtime, {
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_tag_update",
      detail: {
        originalName: input.originalName,
        resultingName: tag.name,
      },
    });

    const redirectTo = `/admin/tags/edit?name=${encodeURIComponent(tag.name)}`;
    if (requestWantsJson(request)) {
      return json({ ok: true, redirectTo, tag });
    }

    return redirectResponse(new URL(redirectTo, request.url));
  } catch (error) {
    return formOrJsonError(request, fallbackPath, "Tag update failed", error);
  }
}
