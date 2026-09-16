import { buildAuthCallbackUrl } from "@/app/.server/auth/callback-url";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { hashPassword } from "@/app/.server/auth/password";
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
import { sendRegistrationCodeEmail } from "@/app/.server/email/auth-email";
import {
  readRequiredFormString,
  redirectWithParams,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));

  try {
    assertSameOrigin(runtime, request);
    const email = normalizeEmail(readRequiredFormString(formData, "email"));
    const existingUser = await findUserByEmail(runtime, email);

    if (existingUser?.emailVerifiedAt) {
      throw new Error("该邮箱已经注册，请直接登录或找回密码");
    }

    await assertAuthEmailRateLimit(runtime, `register:${email}`);
    await assertEmailChallengeQuota(runtime, { email, purpose: "register" });

    const pendingPasswordHash = await hashPassword(
      readRequiredFormString(formData, "password"),
    );
    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(runtime, {
      email,
      purpose: "register",
      code,
    });
    const fingerprints = await getRequestFingerprints(runtime, request);

    await createEmailChallenge(runtime, {
      email,
      purpose: "register",
      codeHash,
      pendingPasswordHash,
    });

    try {
      await sendRegistrationCodeEmail(runtime, {
        to: email,
        code,
        callbackUrl: buildAuthCallbackUrl(runtime, "/register", {
          next: nextPath,
          email,
          sent: "1",
        }),
      });
    } catch (sendError) {
      await deletePendingEmailChallenge(runtime, {
        email,
        purpose: "register",
        codeHash,
      }).catch(() => undefined);
      throw sendError;
    }

    await writeAuthAuditLog(runtime, {
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
