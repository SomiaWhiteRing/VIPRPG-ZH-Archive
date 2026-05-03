import { requireAdmin } from "@/lib/server/auth/guards";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import {
  parseReleaseEditForm,
  updateReleaseForAdmin,
} from "@/lib/server/db/game-library";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    releaseId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { releaseId: rawReleaseId } = await context.params;
    const releaseId = parseReleaseId(rawReleaseId);
    const formData = await request.formData();
    const input = parseReleaseEditForm(formData);

    if (input.releaseId !== releaseId) {
      throw new Error("Release id mismatch");
    }

    const release = await updateReleaseForAdmin(input);

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_release_update",
      detail: {
        releaseId: release.id,
        workId: release.workId,
        status: release.status,
      },
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({
        ok: true,
        release,
      });
    }

    return redirectResponse(new URL(`/admin/releases/${release.id}`, request.url));
  } catch (error) {
    return jsonError("Release update failed", error);
  }
}

function parseReleaseId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid release id");
  }

  return id;
}
