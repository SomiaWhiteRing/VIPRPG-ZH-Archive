import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";

import { requireBootstrapAdmin } from "@/app/.server/auth/authorize";
import { setUserPermissionBlocked } from "@/app/.server/db/permissions";
import type { AppRuntime } from "@/app/.server/runtime";
import { isPermissionKey } from "@/lib/authz/permissions";
import { HttpError, json, jsonError } from "@/lib/http";
import { readAdminUserAccess } from "@/app/.server/admin-user-access";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { userId: string } },
) {
  const auth = await requireBootstrapAdmin(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const userId = parsePositiveId((await context.params).userId);
    const body: unknown = await readJsonObject(request, "请求必须为 JSON 对象");
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new HttpError(400, "权限设置无效");
    const { permissionKey, blocked } = body as Record<string, unknown>;
    if (!isPermissionKey(permissionKey) || typeof blocked !== "boolean")
      throw new HttpError(400, "权限设置无效");
    await setUserPermissionBlocked(runtime, { actor: auth.user, targetUserId: userId, permissionKey, blocked });
    return json({ ok: true, access: await readAdminUserAccess(runtime, auth.user, userId) });
  } catch (error) {
    return jsonError("单独权限设置失败", error);
  }
}
