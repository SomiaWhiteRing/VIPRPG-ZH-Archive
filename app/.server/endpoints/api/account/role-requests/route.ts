import { requireUser } from "@/app/.server/auth/guards";
import { requestRole } from "@/app/.server/db/permissions";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const body = await request.json() as { roleId?: unknown; reason?: unknown } | null;
    if (!body || typeof body.roleId !== "number" || !Number.isSafeInteger(body.roleId) || body.roleId <= 0 ||
      (body.reason !== undefined && typeof body.reason !== "string")) {
      return json({ ok: false, detail: "请选择要申请的权限，并以纯文本填写申请理由。" }, { status: 400 });
    }
    const item = await requestRole(runtime, auth.user, { roleId: body.roleId, reason: body.reason });
    return json({ ok: true, inboxItem: item });
  } catch (error) {
    return jsonError("Role request failed", error);
  }
}
