import { assertSameOrigin } from "@/app/.server/auth/origin";
import { hashPassword } from "@/app/.server/auth/password";
import { queuePublicEmailChallenge } from "@/app/.server/auth/public-email-challenge";
import { assertAuthEmailRateLimit, assertAuthSourceRateLimit } from "@/app/.server/auth/rate-limit";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { normalizeDisplayName, normalizeEmail } from "@/app/.server/db/users";
import { readRequiredFormString, readRequiredPassword, redirectWithParams } from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  try {
    assertSameOrigin(runtime, request);
    const email = normalizeEmail(readRequiredFormString(formData, "email"));
    const displayName = normalizeDisplayName(String(formData.get("displayName") ?? ""));
    if (formData.get("password") !== formData.get("confirmPassword")) {
      throw new Error("两次输入的密码不一致");
    }
    await assertAuthSourceRateLimit(runtime, "register");
    await assertAuthEmailRateLimit(runtime, `register:${email}`);
    const passwordHash = await hashPassword(readRequiredPassword(formData, "password"));
    queuePublicEmailChallenge(runtime, { purpose: "register", email, nextPath, passwordHash, displayName });
    return redirectWithParams(request, "/register", { next: nextPath, email, sent: "1" });
  } catch (error) {
    return redirectWithParams(request, "/register", {
      next: nextPath,
      email: typeof formData.get("email") === "string" ? String(formData.get("email")) : null,
      error: error instanceof Error ? error.message : "注册验证码发送失败",
      displayName: typeof formData.get("displayName") === "string" ? String(formData.get("displayName")) : null,
    });
  }
}
