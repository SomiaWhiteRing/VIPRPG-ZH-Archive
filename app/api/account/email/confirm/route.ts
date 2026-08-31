import { getAuthContextFromRequest } from "@/lib/server/auth/current-user";
import { assertSameOrigin } from "@/lib/server/auth/origin";
import { hashVerificationCode } from "@/lib/server/auth/tokens";
import { consumeLatestEmailChallenge } from "@/lib/server/db/auth-challenges";
import { changeOwnEmail, normalizeEmail } from "@/lib/server/db/users";
import { redirectWithParams } from "@/lib/server/http/form";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let newEmail = "";
  try {
    assertSameOrigin(request);
    const auth = await getAuthContextFromRequest(request);
    if (!auth) return redirectWithParams(request, "/login", { next: "/me/profile/email" });
    const form = await request.formData();
    newEmail = normalizeEmail(String(form.get("newEmail") ?? ""));
    const code = String(form.get("code") ?? "").trim();
    await consumeLatestEmailChallenge({ userId: auth.user.id, email: newEmail, purpose: "email_change", codeHash: await hashVerificationCode({ userId: auth.user.id, email: newEmail, purpose: "email_change", code }) });
    await changeOwnEmail({ user: auth.user, currentSessionId: auth.session.id, newEmail });
    return redirectWithParams(request, "/me/profile/email", { emailUpdated: "1" });
  } catch (error) {
    return redirectWithParams(request, "/me/profile/email", { newEmail, emailSent: "1", error: error instanceof Error ? error.message : "邮箱更新失败" });
  }
}
