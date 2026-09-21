import { buildAuthCallbackUrl } from "@/app/.server/auth/callback-url";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { assertAuthEmailRateLimit } from "@/app/.server/auth/rate-limit";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { getRequestFingerprints } from "@/app/.server/auth/request-context";
import {
  generateVerificationCode,
  hashVerificationCode,
} from "@/app/.server/auth/tokens";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import {
  assertEmailChallengeQuota,
  createEmailChallenge,
  deletePendingEmailChallenge,
} from "@/app/.server/db/auth-challenges";
import { findUserByEmail, normalizeEmail } from "@/app/.server/db/users";
import { sendPasswordResetCodeEmail } from "@/app/.server/email/auth-email";
import {
  readRequiredFormString,
  redirectWithParams,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const email = normalizeEmail(readRequiredFormString(formData, "email"));

  try {
    assertSameOrigin(runtime, request);
    await assertAuthEmailRateLimit(runtime, `password-reset:${email}`);

    const user = await findUserByEmail(runtime, email);

    if (user) {
      await assertEmailChallengeQuota(runtime, {
        email,
        purpose: "password_reset",
      });

      const code = generateVerificationCode();
      const codeHash = await hashVerificationCode(runtime, {
        email,
        purpose: "password_reset",
        code,
      });
      const fingerprints = await getRequestFingerprints(runtime, request);

      await createEmailChallenge(runtime, {
        email,
        purpose: "password_reset",
        codeHash,
      });

      try {
        await sendPasswordResetCodeEmail(runtime, {
          to: email,
          code,
          callbackUrl: buildAuthCallbackUrl(runtime, "/reset-password", {
            next: nextPath,
            email,
            sent: "1",
          }, code),
        });
      } catch (sendError) {
        await deletePendingEmailChallenge(runtime, {
          email,
          purpose: "password_reset",
          codeHash,
        }).catch(() => undefined);
        throw sendError;
      }

      await writeAuthAuditLog(runtime, {
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
