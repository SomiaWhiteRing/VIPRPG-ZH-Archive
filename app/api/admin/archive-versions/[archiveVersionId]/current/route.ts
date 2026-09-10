import { requirePermission } from "@/lib/server/auth/authorize";
import { setCurrentArchiveVersion } from "@/lib/server/db/archive-maintenance";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { redirectBack } from "@/lib/server/http/form";
import { parsePositiveId } from "@/lib/server/http/request";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    archiveVersionId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePermission(request, "archive_version.set_current");

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { archiveVersionId: rawArchiveVersionId } = await context.params;
    const archiveVersionId = parsePositiveId(rawArchiveVersionId, "archive version id");
    const archiveVersion = await setCurrentArchiveVersion(archiveVersionId);

    await writeAuthAuditLog({
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
