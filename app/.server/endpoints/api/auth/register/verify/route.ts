import { assertSameOrigin } from "@/app/.server/auth/origin";
import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
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
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";

export async function POST(runtime: AppRuntime, request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const email = normalizeEmail(readRequiredFormString(formData, "email"));

  try {
    assertSameOrigin(runtime, request);
    const challenge = await consumeLatestEmailChallenge(runtime, {
      email,
      purpose: "register",
      codeHash: await hashVerificationCode(runtime, {
        email,
        purpose: "register",
        code: readRequiredFormString(formData, "code"),
      }),
    });

    if (!challenge.pendingPasswordHash || !challenge.pendingDisplayName) {
      throw new Error("注册状态不完整，请重新获取验证码");
    }

    const user = await createOrActivateVerifiedUser(runtime, {
      email,
      passwordHash: challenge.pendingPasswordHash,
      displayName: challenge.pendingDisplayName,
    });
    await writeAuthAuditLog(runtime, {
      userId: user.id,
      email,
      eventType: "register_verified",
    });

    const response = redirectResponse(new URL(nextPath, request.url));
    response.headers.append(
      "Set-Cookie",
      await createSessionCookie(runtime, user.id, request),
    );

    return response;
  } catch (error) {
    return redirectWithParams(request, "/register", {
      next: nextPath,
      email,
      sent: "1",
      error: error instanceof Error ? error.message : "注册验证失败",
    });
  }
}
