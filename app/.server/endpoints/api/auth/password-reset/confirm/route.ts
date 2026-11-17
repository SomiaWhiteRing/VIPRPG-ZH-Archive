import { formatFeedbackError } from "@/lib/i18n/feedback";
import { translate } from "@/lib/i18n/core";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { hashPassword } from "@/app/.server/auth/password";
import { assertAuthSourceRateLimit } from "@/app/.server/auth/rate-limit";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { hashVerificationCode } from "@/app/.server/auth/tokens";
import { consumeLatestEmailChallenge } from "@/app/.server/db/auth-challenges";
import { normalizeEmail, setUserPasswordByEmail } from "@/app/.server/db/users";
import {
  readRequiredFormString,
  readRequiredPassword,
  redirectWithParams,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"), "/login");
  let email = "";

  try {
    assertSameOrigin(runtime, request);
    email = normalizeEmail(readRequiredFormString(formData, "email", "auth.error.emailRequired"));
    await assertAuthSourceRateLimit(runtime, "password-reset-confirm");
    const passwordHash = await hashPassword(readRequiredPassword(formData, "password"));
    await consumeLatestEmailChallenge(runtime, {
      email,
      purpose: "password_reset",
      codeHash: await hashVerificationCode(runtime, {
        email,
        purpose: "password_reset",
        code: readRequiredFormString(formData, "code", "auth.error.codeRequired"),
      }),
    });

    await setUserPasswordByEmail(runtime, {
      email,
      passwordHash,
    });
    return redirectWithParams(request, "/login", {
      next: nextPath,
      reset: "1",
    });
  } catch (error) {
    return redirectWithParams(request, "/reset-password", {
      next: nextPath,
      email,
      sent: "1",
      error: formatFeedbackError(error, runtime.uiLocale, translate(runtime.uiLocale, "auth.error.resetFailed")),
    });
  }
}
