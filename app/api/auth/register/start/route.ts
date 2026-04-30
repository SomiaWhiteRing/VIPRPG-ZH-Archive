import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { buildAuthCallbackUrl } from "@/lib/server/auth/callback-url";
import { hashPassword } from "@/lib/server/auth/password";
import { assertAuthEmailRateLimit } from "@/lib/server/auth/rate-limit";
import { getRequestFingerprints } from "@/lib/server/auth/request-context";
import { generateVerificationCode, hashVerificationCode } from "@/lib/server/auth/tokens";
import { verifyTurnstile } from "@/lib/server/auth/turnstile";
import {
  assertEmailChallengeQuota,
  createEmailChallenge,
  deletePendingEmailChallenge,
} from "@/lib/server/db/auth-challenges";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { findUserByEmail, normalizeEmail } from "@/lib/server/db/users";
import { sendRegistrationCodeEmail } from "@/lib/server/email/auth-email";
import { readRequiredFormString, redirectWithParams } from "@/lib/server/http/form";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));

  try {
    const email = normalizeEmail(readRequiredFormString(formData, "email"));
    const existingUser = await findUserByEmail(email);

    if (existingUser?.emailVerifiedAt) {
      throw new Error("该邮箱已经注册，请直接登录或找回密码");
    }

    await verifyTurnstile({
      token: readRequiredFormString(formData, "cf-turnstile-response"),
      request,
    });
    await assertAuthEmailRateLimit(`register:${email}`);
    await assertEmailChallengeQuota({ email, purpose: "register" });

    const pendingPasswordHash = await hashPassword(
      readRequiredFormString(formData, "password"),
    );
    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode({
      email,
      purpose: "register",
      code,
    });
    const fingerprints = await getRequestFingerprints(request);

    await createEmailChallenge({
      email,
      purpose: "register",
      codeHash,
      pendingPasswordHash,
    });

    try {
      await sendRegistrationCodeEmail({
        to: email,
        code,
        callbackUrl: buildAuthCallbackUrl("/register", {
          next: nextPath,
          email,
          sent: "1",
        }),
      });
    } catch (sendError) {
      await deletePendingEmailChallenge({
        email,
        purpose: "register",
        codeHash,
      }).catch(() => undefined);
      throw sendError;
    }

    await writeAuthAuditLog({
      email,
      eventType: "register_code_sent",
      ...fingerprints,
    });

    return redirectWithParams(request, "/register", {
      next: nextPath,
      email,
      sent: "1",
    });
  } catch (error) {
    return redirectWithParams(request, "/register", {
      next: nextPath,
      email:
        typeof formData.get("email") === "string"
          ? String(formData.get("email"))
          : null,
      error: error instanceof Error ? error.message : "注册验证码发送失败",
    });
  }
}
