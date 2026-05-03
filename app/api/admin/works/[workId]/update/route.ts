import { requireAdmin } from "@/lib/server/auth/guards";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import {
  parseWorkEditForm,
  updateWorkForAdmin,
} from "@/lib/server/db/game-library";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    workId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireAdmin(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { workId: rawWorkId } = await context.params;
    const workId = parseWorkId(rawWorkId);
    const formData = await request.formData();
    const input = parseWorkEditForm(formData);

    if (input.workId !== workId) {
      throw new Error("Work id mismatch");
    }

    const work = await updateWorkForAdmin(input);

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_work_update",
      detail: {
        workId: work.id,
        status: work.status,
        usesManiacsPatch: work.usesManiacsPatch,
      },
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({
        ok: true,
        work,
      });
    }

    return redirectResponse(new URL(`/admin/works/${work.id}`, request.url));
  } catch (error) {
    return jsonError("Work update failed", error);
  }
}

function parseWorkId(value: string): number {
  const workId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(workId) || workId <= 0) {
    throw new Error("Invalid work id");
  }

  return workId;
}
