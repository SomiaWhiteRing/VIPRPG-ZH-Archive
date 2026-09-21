import { requireBootstrapAdmin } from "@/app/.server/auth/authorize";
import { RoleConflictError, updateRole } from "@/app/.server/db/permissions";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function PATCH(
  runtime: AppRuntime,
  request: Request,
  context: { params: { roleId: string } },
) {
  const auth = await requireBootstrapAdmin(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const roleId = Number((await context.params).roleId);
    const body = (await request.json()) as {
      name?: unknown;
      description?: unknown;
      priority?: unknown;
      status?: unknown;
      applicationEnabled?: unknown;
      availableToAll?: unknown;
      expected?: unknown;
    };
    if (
      typeof body.expected !== "string" ||
      !Number.isInteger(roleId) ||
      typeof body.name !== "string" ||
      typeof body.description !== "string" ||
      typeof body.applicationEnabled !== "boolean" ||
      typeof body.availableToAll !== "boolean" ||
      !Number.isInteger(body.priority) ||
      (body.status !== "active" && body.status !== "disabled")
    ) {
      return json({ ok: false, error: "Invalid role update" }, { status: 400 });
    }
    await updateRole(runtime, {
      actor: auth.user,
      roleId,
      name: body.name,
      description: body.description,
      priority: body.priority as number,
      status: body.status,
      applicationEnabled: body.applicationEnabled,
      availableToAll: body.availableToAll,
      expected: body.expected,
    });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof RoleConflictError)
      return json(
        {
          ok: false,
          code: error.code,
          detail: error.message,
          currentRole: error.currentRole,
        },
        { status: 409 },
      );
    return jsonError("Failed to update role", error);
  }
}
