import { sanitizeRedirectPath } from "@/lib/server/auth/redirect";
import { createSessionCookie } from "@/lib/server/auth/session";
import { hashVerificationCode } from "@/lib/server/auth/tokens";
import { consumeLatestEmailChallenge } from "@/lib/server/db/auth-challenges";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { createOrActivateVerifiedUser, normalizeEmail } from "@/lib/server/db/users";
import {
  readRequiredFormString,
  redirectResponse,
  redirectWithParams,
} from "@/lib/server/http/form";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const nextPath = sanitizeRedirectPath(formData.get("next"));
  const email = normalizeEmail(readRequiredFormString(formData, "email"));

  try {
    const challenge = await consumeLatestEmailChallenge({
      email,
      purpose: "register",
      codeHash: await hashVerificationCode({
        email,
        purpose: "register",
        code: readRequiredFormString(formData, "code"),
      }),
    });

    if (!challenge.pendingPasswordHash) {
      throw new Error("注册状态不完整，请重新获取验证码");
    }

    const user = await createOrActivateVerifiedUser({
      email,
      passwordHash: challenge.pendingPasswordHash,
    });
    await writeAuthAuditLog({
      userId: user.id,
      email,
      eventType: "register_verified",
    });

    const response = redirectResponse(new URL(nextPath, request.url));
    response.headers.append(
      "Set-Cookie",
      await createSessionCookie(user.id, request.url),
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
