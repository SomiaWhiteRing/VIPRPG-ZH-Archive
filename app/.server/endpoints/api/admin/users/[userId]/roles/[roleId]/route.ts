import { requirePermission } from "@/app/.server/auth/authorize";
import { removeRoleFromUser } from "@/app/.server/db/permissions";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function DELETE(
  runtime: AppRuntime,
  request: Request,
  context: { params: { userId: string; roleId: string } },
) {
  const auth = await requirePermission(runtime, request, "user.role.assign");
  if ("response" in auth) return auth.response;
  try {
    const params = await context.params;
    const userId = Number(params.userId);
    const roleId = Number(params.roleId);
    if (!Number.isInteger(userId) || !Number.isInteger(roleId))
      return json(
        { ok: false, error: "Invalid role assignment" },
        { status: 400 },
      );
    await removeRoleFromUser(runtime, {
      actor: auth.user,
      targetUserId: userId,
      roleId,
      reason: "direct_admin_removal",
    });
    return json({ ok: true });
  } catch (error) {
    return jsonError("Failed to remove role", error);
  }
}
