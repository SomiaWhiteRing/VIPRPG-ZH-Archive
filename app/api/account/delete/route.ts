import { getAuthContextFromRequest } from "@/lib/server/auth/current-user";
import { assertSameOrigin } from "@/lib/server/auth/origin";
import { createClearSessionCookie } from "@/lib/server/auth/session";
import { deleteOwnAccount } from "@/lib/server/db/users";
import { json, jsonError, HttpError } from "@/lib/server/http/json";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await getAuthContextFromRequest(request);
    if (!auth) throw new HttpError(401, "请先登录");
    const form = await request.formData();
    if (form.get("confirm") !== "delete") throw new HttpError(400, "请确认注销账户");
    await deleteOwnAccount(auth.user, String(form.get("password") ?? ""));
    const response = json({ ok: true, redirectTo: "/login" });
    response.headers.append("Set-Cookie", createClearSessionCookie(request.url));
    return response;
  } catch (error) { return jsonError("注销失败", error); }
}
