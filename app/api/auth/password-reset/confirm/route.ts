import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { hashPassword } from "@/lib/server/auth/password";
import { hashVerificationCode } from "@/lib/server/auth/tokens";
import { consumeLatestEmailChallenge } from "@/lib/server/db/auth-challenges";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { normalizeEmail, setUserPasswordByEmail } from "@/lib/server/db/users";
import { readRequiredFormString, redirectWithParams } from "@/lib/server/http/form";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"), "/login");
  const email = normalizeEmail(readRequiredFormString(formData, "email"));

  try {
    await consumeLatestEmailChallenge({
      email,
      purpose: "password_reset",
      codeHash: await hashVerificationCode({
        email,
        purpose: "password_reset",
        code: readRequiredFormString(formData, "code"),
      }),
    });

    await setUserPasswordByEmail({
      email,
      passwordHash: await hashPassword(readRequiredFormString(formData, "password")),
    });
    await writeAuthAuditLog({
      email,
      eventType: "password_reset_completed",
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
