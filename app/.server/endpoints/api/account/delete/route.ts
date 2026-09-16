import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { createClearSessionCookie } from "@/app/.server/auth/session";
import { deleteOwnAccount } from "@/app/.server/db/users";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    assertSameOrigin(runtime, request);
    const auth = await getAuthContext(runtime);
    if (!auth) throw new HttpError(401, "请先登录");
    const form = await request.formData();
    if (form.get("confirm") !== "delete")
      throw new HttpError(400, "请确认注销账户");
    await deleteOwnAccount(
      runtime,
      auth.user,
      String(form.get("password") ?? ""),
    );
    const response = json({ ok: true, redirectTo: "/login" });
    response.headers.append(
      "Set-Cookie",
      createClearSessionCookie(request.url),
    );
    return response;
  } catch (error) {
    return jsonError("注销失败", error);
  }
}
