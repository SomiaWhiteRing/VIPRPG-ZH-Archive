import { requireBootstrapAdmin } from "@/app/.server/auth/authorize";
import {
  replaceRolePermissions,
  RoleConflictError,
} from "@/app/.server/db/permissions";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { roleId: string } },
) {
  const auth = await requireBootstrapAdmin(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const roleId = Number((await context.params).roleId);
    const body = (await request.json()) as {
      permissionKeys?: unknown;
      expected?: unknown;
    };
    if (
      typeof body.expected !== "string" ||
      !Number.isInteger(roleId) ||
      !Array.isArray(body.permissionKeys) ||
      body.permissionKeys.some((value) => typeof value !== "string")
    ) {
      return json({ ok: false, error: "Invalid permissions" }, { status: 400 });
    }
    await replaceRolePermissions(runtime, {
      actor: auth.user,
      roleId,
      permissionKeys: body.permissionKeys,
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
    return jsonError("Failed to update role permissions", error);
  }
}
