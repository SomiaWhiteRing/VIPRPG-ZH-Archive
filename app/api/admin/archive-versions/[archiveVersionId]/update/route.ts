import { requireAdmin } from "@/lib/server/auth/guards";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import {
  parseArchiveVersionEditForm,
  updateArchiveVersionForAdmin,
} from "@/lib/server/db/game-library";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    archiveVersionId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { archiveVersionId: rawArchiveVersionId } = await context.params;
    const archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
    const formData = await request.formData();
    const input = parseArchiveVersionEditForm(formData);

    if (input.archiveVersionId !== archiveVersionId) {
      throw new Error("ArchiveVersion id mismatch");
    }

    const archiveVersion = await updateArchiveVersionForAdmin(input);

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_archive_version_update",
      detail: {
        archiveVersionId: archiveVersion.id,
        releaseId: archiveVersion.releaseId,
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

function parseArchiveVersionId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid archive version id");
  }

  return id;
}
