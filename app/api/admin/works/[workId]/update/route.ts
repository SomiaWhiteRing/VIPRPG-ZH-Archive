import { requirePermission } from "@/lib/server/auth/authorize";
import {
  getWorkForAdminEdit,
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
  const auth = await requirePermission(request, "work.update");

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

    await updateWorkForAdmin(input, auth.user);

    if (request.headers.get("accept")?.includes("application/json")) {
      const work = await getWorkForAdminEdit(workId);
      if (!work) throw new Error("游戏更新后不可读取");
      return json({
        ok: true,
        work,
      });
    }

    return redirectResponse(new URL(`/admin/works/${workId}`, request.url));
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
