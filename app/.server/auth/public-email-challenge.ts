import { buildAuthCallbackUrl } from "./callback-url";
import { getRequestFingerprints } from "./request-context";
import { generateVerificationCode, hashVerificationCode } from "./tokens";
import { assertEmailChallengeQuota, createEmailChallenge, deletePendingEmailChallenge } from "../db/auth-challenges";
import { writeAuthAuditLog } from "../db/auth-audit";
import { findUserByEmail } from "../db/users";
import { sendPasswordResetCodeEmail, sendRegistrationCodeEmail } from "../email/auth-email";
import type { AppRuntime } from "../runtime";

type Input = {
  email: string;
  nextPath: string;
} & ({ purpose: "register"; passwordHash: string; displayName: string } | { purpose: "password_reset" });

export function queuePublicEmailChallenge(runtime: AppRuntime, input: Input): void {
  // Account existence, delivery failures and delivery quotas never change the response.
  runtime.execution.waitUntil(sendChallenge(runtime, input).catch((error) => {
    console.error("Public authentication email request failed", error);
  }));
}

async function sendChallenge(runtime: AppRuntime, input: Input): Promise<void> {
  const { email, purpose, nextPath } = input;
  const user = await findUserByEmail(runtime, email);
  if (purpose === "register" ? !!user : user?.status !== "active") return;
  await assertEmailChallengeQuota(runtime, { email, purpose });
  const code = generateVerificationCode();
  const codeHash = await hashVerificationCode(runtime, { email, purpose, code });
  await createEmailChallenge(runtime, {
    email, purpose, codeHash,
    ...(input.purpose === "register" ? {
      pendingPasswordHash: input.passwordHash,
      pendingDisplayName: input.displayName,
    } : {}),
  });
  try {
    const send = purpose === "register" ? sendRegistrationCodeEmail : sendPasswordResetCodeEmail;
    await send(runtime, {
      to: email, code,
      callbackUrl: buildAuthCallbackUrl(runtime, purpose === "register" ? "/register" : "/reset-password", {
        next: nextPath, email, sent: "1",
      }, code),
    });
  } catch (error) {
    await deletePendingEmailChallenge(runtime, { email, purpose, codeHash });
    throw error;
  }
  await writeAuthAuditLog(runtime, {
    userId: user?.id,
    email,
    eventType: purpose === "register" ? "register_code_sent" : "password_reset_code_sent",
    ...(await getRequestFingerprints(runtime, runtime.request)),
  });
}
