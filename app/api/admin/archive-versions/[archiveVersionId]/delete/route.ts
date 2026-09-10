import { requireAnyPermission } from "@/lib/server/auth/authorize";
import { moveArchiveVersionToTrash } from "@/lib/server/db/archive-maintenance";
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
  const auth = await requireAnyPermission(request, ["archive_version.delete_own", "archive_version.delete_any"]);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { archiveVersionId: rawArchiveVersionId } = await context.params;
    const archiveVersionId = parsePositiveId(rawArchiveVersionId, "archive version id");
    const archiveVersion = await moveArchiveVersionToTrash(archiveVersionId, auth.user);

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "archive_version_move_to_trash",
      detail: {
        archiveVersionId,
        workId: archiveVersion.workId,
        uploaderId: archiveVersion.uploaderId,
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
    return jsonError("ArchiveVersion delete failed", error);
  }
}
