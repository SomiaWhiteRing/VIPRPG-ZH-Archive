import { requireBootstrapAdmin } from "@/lib/server/auth/authorize";
import { updateRole } from "@/lib/server/db/permissions";
import { json, jsonError } from "@/lib/server/http/json";

export async function PATCH(request: Request, context: { params: Promise<{ roleId: string }> }) {
  const auth = await requireBootstrapAdmin(request);
  if ("response" in auth) return auth.response;
  try {
    const roleId = Number((await context.params).roleId);
    const body = await request.json() as {
      name?: unknown;
      description?: unknown;
      priority?: unknown;
      status?: unknown;
    };
    if (!Number.isInteger(roleId) || typeof body.name !== "string" ||
      typeof body.description !== "string" || !Number.isInteger(body.priority) ||
      (body.status !== "active" && body.status !== "disabled")) {
      return json({ ok: false, error: "Invalid role update" }, { status: 400 });
    }
    await updateRole({
      actor: auth.user,
      roleId,
      name: body.name,
      description: body.description,
      priority: body.priority as number,
      status: body.status,
    });
    return json({ ok: true });
  } catch (error) {
    return jsonError("Failed to update role", error);
  }
}
