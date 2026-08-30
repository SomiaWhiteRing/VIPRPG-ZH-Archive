import { getAuthContextFromRequest } from "@/lib/server/auth/current-user";
import { assertSameOrigin } from "@/lib/server/auth/origin";
import { assertAuthEmailRateLimit } from "@/lib/server/auth/rate-limit";
import { buildAuthCallbackUrl } from "@/lib/server/auth/callback-url";
import { generateVerificationCode, hashVerificationCode } from "@/lib/server/auth/tokens";
import { assertEmailChallengeQuota, createEmailChallenge, deletePendingEmailChallenge } from "@/lib/server/db/auth-challenges";
import { findUserByEmail, normalizeEmail, verifyOwnPassword } from "@/lib/server/db/users";
import { sendEmailChangeCodeEmail } from "@/lib/server/email/auth-email";
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
    await verifyOwnPassword(auth.user.id, String(form.get("currentPassword") ?? ""));
    const existing = await findUserByEmail(newEmail);
    if (existing) throw new Error(existing.id === auth.user.id ? "这已经是当前邮箱" : "该邮箱已被使用");
    await assertAuthEmailRateLimit(`email-change:${auth.user.id}:${newEmail}`);
    await assertEmailChallengeQuota({ userId: auth.user.id, email: newEmail, purpose: "email_change" });
    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode({ userId: auth.user.id, email: newEmail, purpose: "email_change", code });
    await createEmailChallenge({ userId: auth.user.id, email: newEmail, purpose: "email_change", codeHash });
    try {
      await sendEmailChangeCodeEmail({ to: newEmail, code, callbackUrl: buildAuthCallbackUrl("/me/profile/email", { newEmail, emailSent: "1" }) });
    } catch (error) {
      await deletePendingEmailChallenge({ userId: auth.user.id, email: newEmail, purpose: "email_change", codeHash }).catch(() => undefined);
      throw error;
    }
    return redirectWithParams(request, "/me/profile/email", { newEmail, emailSent: "1" });
  } catch (error) {
    return redirectWithParams(request, "/me/profile/email", { newEmail, error: error instanceof Error ? error.message : "验证码发送失败" });
  }
}
