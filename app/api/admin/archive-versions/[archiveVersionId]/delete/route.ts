import { requireAnyPermission } from "@/lib/server/auth/authorize";
import { moveArchiveVersionToTrash } from "@/lib/server/db/archive-maintenance";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { redirectResponse } from "@/lib/server/http/form";
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
    const archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
    const archiveVersion = await moveArchiveVersionToTrash(archiveVersionId, auth.user);

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "archive_version_move_to_trash",
      detail: {
        archiveVersionId,
        workId: archiveVersion.workId,
        releaseId: archiveVersion.releaseId,
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

function parseArchiveVersionId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid archive version id");
  }

  return id;
}

function redirectBack(request: Request, fallbackPath: string): Response {
  const requestUrl = new URL(request.url);
  const referer = request.headers.get("referer");

  if (referer) {
    try {
      const refererUrl = new URL(referer);

      if (refererUrl.origin === requestUrl.origin) {
        return redirectResponse(refererUrl);
      }
    } catch {
      // Ignore malformed referer values and use the stable fallback.
    }
  }

  return redirectResponse(new URL(fallbackPath, requestUrl));
}
