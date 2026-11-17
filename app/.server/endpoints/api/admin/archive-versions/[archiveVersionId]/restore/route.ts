import { requirePermission } from "@/app/.server/auth/authorize";
import { restoreArchiveVersion } from "@/app/.server/db/archive-maintenance";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import { redirectBack } from "@/app/.server/http/form";
import { parseArchiveVersionId } from "@/app/.server/db/archive-downloads";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";
import { UiFeedbackError } from "@/lib/i18n/feedback";

type RouteContext = {
  params: {
    archiveVersionId: string;
  };
};

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requirePermission(
    runtime,
    request,
    "archive_version.restore",
  );

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { archiveVersionId: rawArchiveVersionId } = await context.params;
    const archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
    const archiveVersion = await restoreArchiveVersion(
      runtime,
      archiveVersionId,
    );

    await writeAuthAuditLog(runtime, {
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "archive_version_restore",
      detail: {
        archiveVersionId,
        workId: archiveVersion.workId,
      },
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({
        ok: true,
        archiveVersion,
      });
    }

    return redirectBack(request, "/admin/archive-versions/trash");
  } catch (error) {
    return jsonError("ArchiveVersion restore failed", error, error instanceof UiFeedbackError ? error.messageKey : undefined);
  }
}
