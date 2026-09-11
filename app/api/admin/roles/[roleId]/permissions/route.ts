import { requireBootstrapAdmin } from "@/lib/server/auth/authorize";
import { json, jsonError } from "@/lib/server/http/json";
import { replaceRolePermissions, RoleConflictError } from "@/lib/server/db/permissions";

export async function POST(request: Request, context: { params: Promise<{ roleId: string }> }) {
  const auth = await requireBootstrapAdmin(request);
  if ("response" in auth) return auth.response;
  try {
    const roleId = Number((await context.params).roleId);
    const body = await request.json() as { permissionKeys?: unknown; expected?: unknown };
    if (typeof body.expected !== "string" || !Number.isInteger(roleId) || !Array.isArray(body.permissionKeys) || body.permissionKeys.some((value) => typeof value !== "string")) {
      return json({ ok: false, error: "Invalid permissions" }, { status: 400 });
    }
    await replaceRolePermissions({ actor: auth.user, roleId, permissionKeys: body.permissionKeys, expected: body.expected });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof RoleConflictError) return json({ ok: false, code: error.code, detail: error.message, currentRole: error.currentRole }, { status: 409 });
    return jsonError("Failed to update role permissions", error);
  }
}
