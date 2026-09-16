import { buildAuthCallbackUrl } from "@/app/.server/auth/callback-url";
import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { assertAuthEmailRateLimit } from "@/app/.server/auth/rate-limit";
import {
  generateVerificationCode,
  hashVerificationCode,
} from "@/app/.server/auth/tokens";
import {
  assertEmailChallengeQuota,
  createEmailChallenge,
  deletePendingEmailChallenge,
} from "@/app/.server/db/auth-challenges";
import {
  findUserByEmail,
  normalizeEmail,
  verifyOwnPassword,
} from "@/app/.server/db/users";
import { sendEmailChangeCodeEmail } from "@/app/.server/email/auth-email";
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
    await verifyOwnPassword(
      runtime,
      auth.user.id,
      String(form.get("currentPassword") ?? ""),
    );
    const existing = await findUserByEmail(runtime, newEmail);
    if (existing)
      throw new Error(
        existing.id === auth.user.id ? "这已经是当前邮箱" : "该邮箱已被使用",
      );
    await assertAuthEmailRateLimit(
      runtime,
      `email-change:${auth.user.id}:${newEmail}`,
    );
    await assertEmailChallengeQuota(runtime, {
      userId: auth.user.id,
      email: newEmail,
      purpose: "email_change",
    });
    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(runtime, {
      userId: auth.user.id,
      email: newEmail,
      purpose: "email_change",
      code,
    });
    await createEmailChallenge(runtime, {
      userId: auth.user.id,
      email: newEmail,
      purpose: "email_change",
      codeHash,
    });
    try {
      await sendEmailChangeCodeEmail(runtime, {
        to: newEmail,
        code,
        callbackUrl: buildAuthCallbackUrl(runtime, "/me/profile/email", {
          newEmail,
          emailSent: "1",
        }),
      });
    } catch (error) {
      await deletePendingEmailChallenge(runtime, {
        userId: auth.user.id,
        email: newEmail,
        purpose: "email_change",
        codeHash,
      }).catch(() => undefined);
      throw error;
    }
    return redirectWithParams(request, "/me/profile/email", {
      newEmail,
      emailSent: "1",
    });
  } catch (error) {
    return redirectWithParams(request, "/me/profile/email", {
      newEmail,
      error: error instanceof Error ? error.message : "验证码发送失败",
    });
  }
}
