import { translate } from "@/lib/i18n/core";
import { formatFeedbackError } from "@/lib/i18n/feedback";
import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { hashVerificationCode } from "@/app/.server/auth/tokens";
import { consumeLatestEmailChallenge } from "@/app/.server/db/auth-challenges";
import { changeOwnEmail, normalizeEmail } from "@/app/.server/db/users";
import { redirectWithParams } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  let newEmail = "";
  try {
    assertSameOrigin(runtime, request);
    const auth = await getAuthContext(runtime);
    if (!auth)
      return redirectWithParams(request, "/login", {
        next: "/me/profile/email",
      });
    const form = await request.formData();
    newEmail = normalizeEmail(String(form.get("newEmail") ?? ""));
    const code = String(form.get("code") ?? "").trim();
    await consumeLatestEmailChallenge(runtime, {
      userId: auth.user.id,
      email: newEmail,
      purpose: "email_change",
      codeHash: await hashVerificationCode(runtime, {
        userId: auth.user.id,
        email: newEmail,
        purpose: "email_change",
        code,
      }),
    });
    await changeOwnEmail(runtime, {
      user: auth.user,
      currentSessionId: auth.session.id,
      newEmail,
    });
    return redirectWithParams(request, "/me/profile/email", {
      emailUpdated: "1",
    });
  } catch (error) {
    return redirectWithParams(request, "/me/profile/email", {
      newEmail,
      emailSent: "1",
      error: formatFeedbackError(error, runtime.uiLocale, translate(runtime.uiLocale, "profile.emailFailed")),
    });
  }
}
