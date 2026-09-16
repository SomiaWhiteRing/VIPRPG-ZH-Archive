import { requirePermission } from "@/app/.server/auth/authorize";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import {
  parseArchiveVersionEditForm,
  updateArchiveVersionForAdmin,
} from "@/app/.server/db/game-library";
import { redirectResponse } from "@/app/.server/http/form";
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
    "archive_version.update",
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
    const formData = await request.formData();
    const input = parseArchiveVersionEditForm(formData);

    if (input.archiveVersionId !== archiveVersionId) {
      throw new Error("ArchiveVersion id mismatch");
    }

    const archiveVersion = await updateArchiveVersionForAdmin(runtime, input);

    await writeAuthAuditLog(runtime, {
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_archive_version_update",
      detail: {
        archiveVersionId: archiveVersion.id,
        workId: archiveVersion.workId,
        status: archiveVersion.status,
      },
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({
        ok: true,
        archiveVersion,
      });
    }

    return redirectResponse(
      new URL(`/admin/archive-versions/${archiveVersion.id}`, request.url),
    );
  } catch (error) {
    return jsonError("ArchiveVersion update failed", error);
  }
}
