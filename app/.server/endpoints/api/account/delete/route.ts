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
    await deleteOwnAccount(runtime, auth.user, {
      acknowledgement: String(form.get("acknowledgement") ?? ""),
      code: String(form.get("code") ?? "").trim(),
    });
    const response = json({ ok: true, redirectTo: "/login?accountDeleted=1" });
    response.headers.append(
      "Set-Cookie",
      createClearSessionCookie(request.url),
    );
    return response;
  } catch (error) {
    return jsonError("注销失败", error);
  }
}
