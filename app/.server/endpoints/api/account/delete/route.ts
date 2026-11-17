import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { createClearSessionCookie } from "@/app/.server/auth/session";
import { deleteOwnAccount } from "@/app/.server/db/users";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";
import { preserveUiLocale } from "@/lib/i18n/locale";

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    assertSameOrigin(runtime, request);
    const auth = await getAuthContext(runtime);
    if (!auth) throw new HttpError(401, "请先登录", undefined, "timeline.error.login");
    const form = await request.formData();
    await deleteOwnAccount(runtime, auth.user, {
      acknowledgement: String(form.get("acknowledgement") ?? ""),
      code: String(form.get("code") ?? "").trim(),
    });
    const source = new URL(request.url);
    const target = preserveUiLocale(new URL("/login?accountDeleted=1", source), source);
    const response = json({ ok: true, redirectTo: target.pathname + target.search });
    response.headers.append(
      "Set-Cookie",
      createClearSessionCookie(request.url),
    );
    return response;
  } catch (error) {
    return jsonError("注销失败", error);
  }
}
