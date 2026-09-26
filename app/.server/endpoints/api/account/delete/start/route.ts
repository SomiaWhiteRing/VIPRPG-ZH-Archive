import { assertAccountDeletionRequest } from "@/app/.server/auth/account-deletion";
import { getAuthContext } from "@/app/.server/auth/current-user";
import { assertSameOrigin } from "@/app/.server/auth/origin";
import { assertAuthEmailRateLimit } from "@/app/.server/auth/rate-limit";
import { generateVerificationCode, hashVerificationCode } from "@/app/.server/auth/tokens";
import {
  assertEmailChallengeQuota,
  createEmailChallenge,
  deletePendingEmailChallenge,
} from "@/app/.server/db/auth-challenges";
import { sendAccountDeletionCodeEmail } from "@/app/.server/email/auth-email";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    assertSameOrigin(runtime, request);
    const auth = await getAuthContext(runtime);
    if (!auth) throw new HttpError(401, "请先登录");
    const form = await request.formData();
    assertAccountDeletionRequest(auth.user, String(form.get("acknowledgement") ?? ""));
    const challenge = {
      userId: auth.user.id,
      email: auth.user.email,
      purpose: "account_delete" as const,
    };
    await assertAuthEmailRateLimit(runtime, `account-delete:${auth.user.id}`);
    await assertEmailChallengeQuota(runtime, challenge);
    const code = generateVerificationCode();
    const codeHash = await hashVerificationCode(runtime, { ...challenge, code });
    await createEmailChallenge(runtime, { ...challenge, codeHash });
    try {
      await sendAccountDeletionCodeEmail(runtime, { to: auth.user.email, code });
    } catch (error) {
      await deletePendingEmailChallenge(runtime, { ...challenge, codeHash }).catch(() => undefined);
      throw error;
    }
    return json({ ok: true });
  } catch (error) {
    return jsonError("注销验证码发送失败", error);
  }
}
