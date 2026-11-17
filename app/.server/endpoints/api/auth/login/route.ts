import { formatFeedbackError } from "@/lib/i18n/feedback";
import { translate } from "@/lib/i18n/core";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { authReturnUrl, sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { getRequestFingerprints } from "@/app/.server/auth/request-context";
import { createSessionCookie } from "@/app/.server/auth/session";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import { authenticateUser } from "@/app/.server/db/users";
import {
  readRequiredFormString,
  readRequiredPassword,
  redirectResponse,
  redirectWithParams,
  requestWantsJson,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, HttpError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const email = formData.get("email");

  try {
    assertSameOrigin(runtime, request);
    const user = await authenticateUser(runtime, {
      email: readRequiredFormString(formData, "email", "auth.error.emailRequired"),
      password: readRequiredPassword(formData, "password"),
    });
    const target = authReturnUrl(nextPath, request.url);
    const response = requestWantsJson(request)
      ? json({ ok: true, redirectTo: target.href })
      : redirectResponse(target);
    await writeAuthAuditLog(runtime, {
      userId: user.id,
      email: user.email,
      eventType: "login_succeeded",
      ...(await getRequestFingerprints(runtime, request)),
    });

    response.headers.append(
      "Set-Cookie",
      await createSessionCookie(runtime, user.id, request),
    );

    return response;
  } catch (error) {
    const message = formatFeedbackError(error, runtime.uiLocale, translate(runtime.uiLocale, "auth.error.loginFailed"));
    if (requestWantsJson(request)) return json({ ok: false, error: message, detail: message },
      { status: error instanceof HttpError ? error.status : 400 });
    return redirectWithParams(request, "/login", {
      next: nextPath,
      email: typeof email === "string" ? email : null,
      error: message,
    });
  }
}
