import { formatFeedbackError } from "@/lib/i18n/feedback";
import { translate } from "@/lib/i18n/core";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { queuePublicEmailChallenge } from "@/app/.server/auth/public-email-challenge";
import { assertAuthEmailRateLimit, assertAuthSourceRateLimit } from "@/app/.server/auth/rate-limit";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { normalizeEmail } from "@/app/.server/db/users";
import { readRequiredFormString, redirectWithParams } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  let email = String(formData.get("email") ?? "");
  try {
    assertSameOrigin(runtime, request);
    email = normalizeEmail(readRequiredFormString(formData, "email", "auth.error.emailRequired"));
    await assertAuthSourceRateLimit(runtime, "password-reset");
    await assertAuthEmailRateLimit(runtime, `password-reset:${email}`);
    queuePublicEmailChallenge(runtime, { purpose: "password_reset", email, nextPath });
    return redirectWithParams(request, "/reset-password", { next: nextPath, email, sent: "1" });
  } catch (error) {
    return redirectWithParams(request, "/forgot-password", {
      next: nextPath, email,
      error: formatFeedbackError(error, runtime.uiLocale, translate(runtime.uiLocale, "auth.error.resetSendFailed")),
    });
  }
}
