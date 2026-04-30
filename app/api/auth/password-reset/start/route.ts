import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { assertAuthEmailRateLimit } from "@/lib/server/auth/rate-limit";
import { getRequestFingerprints } from "@/lib/server/auth/request-context";
import { generateVerificationCode, hashVerificationCode } from "@/lib/server/auth/tokens";
import { verifyTurnstile } from "@/lib/server/auth/turnstile";
import {
  assertEmailChallengeQuota,
  createEmailChallenge,
} from "@/lib/server/db/auth-challenges";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { findUserByEmail, normalizeEmail } from "@/lib/server/db/users";
import { sendPasswordResetCodeEmail } from "@/lib/server/email/auth-email";
import { readRequiredFormString, redirectWithParams } from "@/lib/server/http/form";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const email = normalizeEmail(readRequiredFormString(formData, "email"));

  try {
    await verifyTurnstile({
      token: readRequiredFormString(formData, "cf-turnstile-response"),
      request,
    });
    await assertAuthEmailRateLimit(`password-reset:${email}`);

    const user = await findUserByEmail(email);

    if (user) {
      await assertEmailChallengeQuota({ email, purpose: "password_reset" });

      const code = generateVerificationCode();
      const codeHash = await hashVerificationCode({
        email,
        purpose: "password_reset",
        code,
      });
      const fingerprints = await getRequestFingerprints(request);

      await createEmailChallenge({
        email,
        purpose: "password_reset",
        codeHash,
      });
      await sendPasswordResetCodeEmail({ to: email, code });
      await writeAuthAuditLog({
        userId: user.id,
        email,
        eventType: "password_reset_code_sent",
        ...fingerprints,
      });
    }

    return redirectWithParams(request, "/reset-password", {
      next: nextPath,
      email,
      sent: "1",
    });
  } catch (error) {
    return redirectWithParams(request, "/forgot-password", {
      next: nextPath,
      email,
      error: error instanceof Error ? error.message : "找回密码验证码发送失败",
    });
  }
}
