import { requirePermission } from "@/lib/server/auth/authorize";
import { json, jsonError } from "@/lib/server/http/json";
import { removeRoleFromUser } from "@/lib/server/db/permissions";

export async function DELETE(request: Request, context: { params: Promise<{ userId: string; roleId: string }> }) {
  const auth = await requirePermission(request, "user.role.assign");
  if ("response" in auth) return auth.response;
  try {
    const params = await context.params;
    const userId = Number(params.userId);
    const roleId = Number(params.roleId);
    if (!Number.isInteger(userId) || !Number.isInteger(roleId)) return json({ ok: false, error: "Invalid role assignment" }, { status: 400 });
    await removeRoleFromUser({ actor: auth.user, targetUserId: userId, roleId, reason: "direct_admin_removal" });
    return json({ ok: true });
  } catch (error) {
    return jsonError("Failed to remove role", error);
  }
}
