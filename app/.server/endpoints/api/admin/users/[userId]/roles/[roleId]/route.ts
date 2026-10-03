import { parsePositiveId } from "@/app/.server/http/request";
import { requirePermission } from "@/app/.server/auth/authorize";
import { removeRoleFromUser } from "@/app/.server/db/permissions";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";
import { readAdminUserAccess } from "@/app/.server/admin-user-access";

export async function DELETE(
  runtime: AppRuntime,
  request: Request,
  context: { params: { userId: string; roleId: string } },
) {
  const auth = await requirePermission(runtime, request, "user.role.assign");
  if ("response" in auth) return auth.response;
  try {
    const params = await context.params;
    const userId = parsePositiveId(params.userId);
    const roleId = parsePositiveId(params.roleId);
    if ( !Number.isInteger(roleId))
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
    return json({ ok: true, access: await readAdminUserAccess(runtime, auth.user, userId) });
  } catch (error) {
    return jsonError("Failed to remove role", error);
  }
}
