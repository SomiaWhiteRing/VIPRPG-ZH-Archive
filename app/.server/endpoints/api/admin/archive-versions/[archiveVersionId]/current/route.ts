import { requirePermission } from "@/app/.server/auth/authorize";
import { setCurrentArchiveVersion } from "@/app/.server/db/archive-maintenance";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import { redirectBack } from "@/app/.server/http/form";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

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
    "archive_version.set_current",
  );

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { archiveVersionId: rawArchiveVersionId } = await context.params;
    const archiveVersionId = parsePositiveId(
      rawArchiveVersionId,
      "archive version id",
    );
    const archiveVersion = await setCurrentArchiveVersion(
      runtime,
      archiveVersionId,
    );

    await writeAuthAuditLog(runtime, {
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "archive_version_set_current",
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

    return redirectBack(request, "/admin/archive-versions");
  } catch (error) {
    return jsonError("ArchiveVersion current update failed", error);
  }
}
