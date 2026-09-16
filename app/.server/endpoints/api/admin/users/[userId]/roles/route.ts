import { requirePermission } from "@/app/.server/auth/authorize";
import { assignRoleToUser } from "@/app/.server/db/permissions";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { userId: string } },
) {
  const auth = await requirePermission(runtime, request, "user.role.assign");
  if ("response" in auth) return auth.response;
  try {
    const userId = Number((await context.params).userId);
    const body = (await request.json()) as { roleId?: number };
    if (
      !Number.isInteger(userId) ||
      typeof body.roleId !== "number" ||
      !Number.isInteger(body.roleId)
    ) {
      return json(
        { ok: false, error: "Invalid role assignment" },
        { status: 400 },
      );
    }
    const roleId = body.roleId;
    await assignRoleToUser(runtime, {
      actor: auth.user,
      targetUserId: userId,
      roleId,
      reason: "direct_admin_assignment",
    });
    return json({ ok: true });
  } catch (error) {
    return jsonError("Failed to assign role", error);
  }
}
