import { translate } from "@/lib/i18n/core";
import { formatFeedbackError, UiFeedbackError } from "@/lib/i18n/feedback";
import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { changeOwnPassword } from "@/app/.server/db/users";
import { redirectWithParams } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    assertSameOrigin(runtime, request);
    const auth = await getAuthContext(runtime);
    if (!auth)
      return redirectWithParams(request, "/login", {
        next: "/me/profile/password",
      });
    const form = await request.formData();
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmPassword") ?? ""))
      throw new UiFeedbackError("profile.passwordMismatch");
    await changeOwnPassword(runtime, {
      user: auth.user,
      currentSessionId: auth.session.id,
      currentPassword: String(form.get("currentPassword") ?? ""),
      newPassword,
    });
    return redirectWithParams(request, "/me/profile/password", {
      passwordUpdated: "1",
    });
  } catch (error) {
    return redirectWithParams(request, "/me/profile/password", {
      error: formatFeedbackError(error, runtime.uiLocale, translate(runtime.uiLocale, "profile.passwordFailed")),
    });
  }
}
