import { requireBootstrapAdmin } from "@/lib/server/auth/authorize";
import { json, jsonError } from "@/lib/server/http/json";
import { replaceRolePermissions } from "@/lib/server/db/permissions";

export async function POST(request: Request, context: { params: Promise<{ roleId: string }> }) {
  const auth = await requireBootstrapAdmin(request);
  if ("response" in auth) return auth.response;
  try {
    const roleId = Number((await context.params).roleId);
    const body = await request.json() as { permissionKeys?: unknown };
    if (!Number.isInteger(roleId) || !Array.isArray(body.permissionKeys) || body.permissionKeys.some((value) => typeof value !== "string")) {
      return json({ ok: false, error: "Invalid permissions" }, { status: 400 });
    }
    await replaceRolePermissions({ actor: auth.user, roleId, permissionKeys: body.permissionKeys });
    return json({ ok: true });
  } catch (error) {
    return jsonError("Failed to update role permissions", error);
  }
}
