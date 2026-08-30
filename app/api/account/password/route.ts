import { getAuthContextFromRequest } from "@/lib/server/auth/current-user";
import { assertSameOrigin } from "@/lib/server/auth/origin";
import { changeOwnPassword } from "@/lib/server/db/users";
import { redirectWithParams } from "@/lib/server/http/form";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const auth = await getAuthContextFromRequest(request);
    if (!auth) return redirectWithParams(request, "/login", { next: "/me/profile/password" });
    const form = await request.formData();
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmPassword") ?? "")) throw new Error("两次输入的新密码不一致");
    await changeOwnPassword({ userId: auth.user.id, currentSessionId: auth.session.id, currentPassword: String(form.get("currentPassword") ?? ""), newPassword });
    return redirectWithParams(request, "/me/profile/password", { passwordUpdated: "1" });
  } catch (error) {
    return redirectWithParams(request, "/me/profile/password", { error: error instanceof Error ? error.message : "密码更新失败" });
  }
}
