import { assertSameOrigin } from "@/app/.server/auth/origin";
import { hashPassword } from "@/app/.server/auth/password";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { hashVerificationCode } from "@/app/.server/auth/tokens";
import { consumeLatestEmailChallenge } from "@/app/.server/db/auth-challenges";
import { normalizeEmail, setUserPasswordByEmail } from "@/app/.server/db/users";
import {
  readRequiredFormString,
  redirectWithParams,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"), "/login");
  const email = normalizeEmail(readRequiredFormString(formData, "email"));

  try {
    assertSameOrigin(runtime, request);
    await consumeLatestEmailChallenge(runtime, {
      email,
      purpose: "password_reset",
      codeHash: await hashVerificationCode(runtime, {
        email,
        purpose: "password_reset",
        code: readRequiredFormString(formData, "code"),
      }),
    });

    await setUserPasswordByEmail(runtime, {
      email,
      passwordHash: await hashPassword(
        readRequiredFormString(formData, "password"),
      ),
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
      error: error instanceof Error ? error.message : "密码重置失败",
    });
  }
}
