import { UiFeedbackError, formatFeedbackError } from "@/lib/i18n/feedback";
import { translate } from "@/lib/i18n/core";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { assertAuthSourceRateLimit } from "@/app/.server/auth/rate-limit";
import { authReturnUrl, sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { createSessionCookie } from "@/app/.server/auth/session";
import { hashVerificationCode } from "@/app/.server/auth/tokens";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import { consumeLatestEmailChallenge } from "@/app/.server/db/auth-challenges";
import {
  createOrActivateVerifiedUser,
  normalizeEmail,
} from "@/app/.server/db/users";
import {
  readRequiredFormString,
  redirectResponse,
  redirectWithParams,
  requestWantsJson,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  let email = "";
  let displayName: string | null = null;

  try {
    assertSameOrigin(runtime, request);
    email = normalizeEmail(readRequiredFormString(formData, "email", "auth.error.emailRequired"));
    await assertAuthSourceRateLimit(runtime, "register-verify");
    const challenge = await consumeLatestEmailChallenge(runtime, {
      email,
      purpose: "register",
      codeHash: await hashVerificationCode(runtime, {
        email,
        purpose: "register",
        code: readRequiredFormString(formData, "code", "auth.error.codeRequired"),
      }),
    });

    if (!challenge.pendingPasswordHash || !challenge.pendingDisplayName) {
      throw new UiFeedbackError("auth.error.registerState");
    }
    displayName = challenge.pendingDisplayName;

    const user = await createOrActivateVerifiedUser(runtime, {
      email,
      passwordHash: challenge.pendingPasswordHash,
      displayName,
    });
    await writeAuthAuditLog(runtime, {
      userId: user.id,
      email,
      eventType: "register_verified",
    });

    const target = authReturnUrl(nextPath, request.url);
    const response = requestWantsJson(request)
      ? json({ ok: true, redirectTo: target.href })
      : redirectResponse(target);
    response.headers.append(
      "Set-Cookie",
      await createSessionCookie(runtime, user.id, request),
    );

    return response;
  } catch (error) {
    const message = formatFeedbackError(error, runtime.uiLocale, translate(runtime.uiLocale, "auth.error.registerFailed"));
    if (requestWantsJson(request)) return json({ ok: false, error: message, detail: message },
      { status: error instanceof HttpError ? error.status : 400 });
    return redirectWithParams(request, "/register", {
      next: nextPath,
      email,
      sent: error instanceof HttpError && error.code === "display_name_taken" ? null : "1",
      displayName,
      error: message,
    });
  }
}
