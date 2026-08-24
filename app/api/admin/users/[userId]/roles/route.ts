import { requirePermission } from "@/lib/server/auth/authorize";
import { json, jsonError } from "@/lib/server/http/json";
import { assignRoleToUser } from "@/lib/server/db/permissions";

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  const auth = await requirePermission(request, "user.role.assign");
  if ("response" in auth) return auth.response;
  try {
    const userId = Number((await context.params).userId);
    const body = await request.json() as { roleId?: number };
    if (!Number.isInteger(userId) || typeof body.roleId !== "number" || !Number.isInteger(body.roleId)) {
      return json({ ok: false, error: "Invalid role assignment" }, { status: 400 });
    }
    const roleId = body.roleId;
    await assignRoleToUser({ actor: auth.user, targetUserId: userId, roleId, reason: "direct_admin_assignment" });
    return json({ ok: true });
  } catch (error) {
    return jsonError("Failed to assign role", error);
  }
}
