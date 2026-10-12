import { timingSafeEqualString } from "@/lib/sha256";
import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError } from "@/lib/http";
import { hashRequestFingerprint } from "@/app/.server/auth/tokens";

export type ChallengePurpose = "register" | "password_reset" | "email_change" | "account_delete";

export type EmailVerificationChallenge = {
  id: number;
  userId: number | null;
  email: string;
  purpose: ChallengePurpose;
  codeHash: string;
  pendingPasswordHash: string | null;
  pendingDisplayName: string | null;
  expiresAt: string;
  consumedAt: string | null;
  attemptCount: number;
};

type ChallengeRow = {
  id: number;
  user_id: number | null;
  email: string;
  purpose: ChallengePurpose;
  code_hash: string;
  pending_password_hash: string | null;
  pending_display_name: string | null;
  expires_at: string;
  consumed_at: string | null;
  attempt_count: number;
};

type CountRow = {
  count: number;
};

const registrationSourceRecipientLimit = 5;
const recentRegistrationRecipientsSql = `
  SELECT email FROM email_verification_challenges
  WHERE ip_hash=? AND purpose='register' AND created_at>=datetime('now','-1 day')
  UNION
  SELECT email FROM auth_audit_logs
  WHERE ip_hash=? AND event_type='register_code_sent' AND created_at>=datetime('now','-1 day')`;

const unverifiedRegistrationRecipientsSql = `
  SELECT recent.email FROM (${recentRegistrationRecipientsSql}) recent
  WHERE NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.email=recent.email AND u.email_verified_at IS NOT NULL
  )`;

function registrationSourceQuotaError(): HttpError {
  return new HttpError(429, "当前网络申请注册验证码过于频繁，请稍后重试或联系管理员");
}

export async function assertRegistrationSourceQuota(
  runtime: AppRuntime,
  email: string,
): Promise<string | null> {
  // Forwarded headers are caller-controlled. Cloudflare supplies this header at the edge.
  const sourceHash = await hashRequestFingerprint(runtime, runtime.request.headers.get("cf-connecting-ip"));
  if (!sourceHash) return null;
  const row = await getD1(runtime).prepare(`
    SELECT COUNT(*) AS count,
      COALESCE(MAX(CASE WHEN recent.email=? THEN 1 ELSE 0 END),0) AS seen
    FROM (${unverifiedRegistrationRecipientsSql}) recent`)
    .bind(email, sourceHash, sourceHash).first<{ count: number; seen: number }>();
  if ((row?.count ?? 0) >= registrationSourceRecipientLimit && !row?.seen) {
    console.warn("Registration source recipient limit reached");
    throw registrationSourceQuotaError();
  }
  return sourceHash;
}

export async function assertEmailChallengeQuota(
  runtime: AppRuntime,
  input: {
    userId?: number | null;
    email: string;
    purpose: ChallengePurpose;
  },
): Promise<void> {
  const row = await getD1(runtime)
    .prepare(
      `SELECT COUNT(*) AS count
      FROM email_verification_challenges
      WHERE email = ?
        AND purpose = ?
        AND user_id IS ?
        AND created_at >= datetime('now', '-1 hour')`,
    )
    .bind(input.email, input.purpose, input.userId ?? null)
    .first<CountRow>();

  if ((row?.count ?? 0) >= 5) {
    throw new HttpError(429, "验证码发送过于频繁，请稍后再试");
  }
}

export async function createEmailChallenge(
  runtime: AppRuntime,
  input: {
    userId?: number | null;
    email: string;
    purpose: ChallengePurpose;
    codeHash: string;
    pendingPasswordHash?: string | null;
    pendingDisplayName?: string | null;
    sourceHash?: string | null;
  },
): Promise<void> {
  const isRegistration = input.purpose === "register";
  const result = await getD1(runtime)
    .prepare(
      `INSERT INTO email_verification_challenges (
        user_id,
        email,
        purpose,
        code_hash,
        pending_password_hash,
        pending_display_name,
        expires_at,
        ip_hash
      ) SELECT ?, ?, ?, ?, ?, ?, datetime('now', '+10 minutes'), ?
      WHERE ? IS NULL OR (
        SELECT COUNT(*) < ${registrationSourceRecipientLimit}
          OR COALESCE(MAX(CASE WHEN recent.email=? THEN 1 ELSE 0 END),0)=1
        FROM (${unverifiedRegistrationRecipientsSql}) recent
      )`,
    )
    .bind(
      input.userId ?? null,
      input.email,
      input.purpose,
      input.codeHash,
      input.pendingPasswordHash ?? null,
      input.pendingDisplayName ?? null,
      isRegistration ? input.sourceHash ?? null : null,
      isRegistration ? input.sourceHash ?? null : null,
      input.email,
      isRegistration ? input.sourceHash ?? null : null,
      isRegistration ? input.sourceHash ?? null : null,
    )
    .run();
  if (isRegistration && Number(result.meta.changes ?? 0) !== 1) {
    console.warn("Registration source recipient limit reached after concurrent request");
    throw registrationSourceQuotaError();
  }
}

export async function deletePendingEmailChallenge(
  runtime: AppRuntime,
  input: {
    userId?: number | null;
    email: string;
    purpose: ChallengePurpose;
    codeHash: string;
  },
): Promise<void> {
  await getD1(runtime)
    .prepare(
      `DELETE FROM email_verification_challenges
      WHERE email = ?
        AND purpose = ?
        AND user_id IS ?
        AND code_hash = ?
        AND consumed_at IS NULL`,
    )
    .bind(input.email, input.purpose, input.userId ?? null, input.codeHash)
    .run();
}

export async function consumeLatestEmailChallenge(
  runtime: AppRuntime,
  input: {
    userId?: number | null;
    email: string;
    purpose: ChallengePurpose;
    codeHash: string;
  },
): Promise<EmailVerificationChallenge> {
  const row = await getD1(runtime)
    .prepare(
      `SELECT
        id,
        user_id,
        email,
        purpose,
        code_hash,
        pending_password_hash,
        pending_display_name,
        expires_at,
        consumed_at,
        attempt_count
      FROM email_verification_challenges
      WHERE email = ?
        AND purpose = ?
        AND user_id IS ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    )
    .bind(input.email, input.purpose, input.userId ?? null)
    .first<ChallengeRow>();

  if (!row || row.expires_at <= new Date().toISOString().slice(0, 19).replace("T", " ")) {
    throw new HttpError(400, "验证码不正确或已失效，请重新获取");
  }

  if (row.consumed_at) {
    throw new HttpError(400, "验证码不正确或已失效，请重新获取");
  }

  if (row.attempt_count >= 5) {
    throw new HttpError(400, "验证码不正确或已失效，请重新获取");
  }

  if (!timingSafeEqualString(row.code_hash, input.codeHash)) {
    await incrementChallengeAttempts(runtime, row.id);
    throw new HttpError(400, "验证码不正确或已失效，请重新获取");
  }

  const consumed = await getD1(runtime)
    .prepare(
      `UPDATE email_verification_challenges
      SET consumed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND consumed_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP AND attempt_count < 5
        AND id = (SELECT id FROM email_verification_challenges
          WHERE email = ? AND purpose = ? AND user_id IS ?
          ORDER BY created_at DESC, id DESC LIMIT 1)`,
    )
    .bind(row.id, input.email, input.purpose, input.userId ?? null)
    .run();

  if (Number(consumed.meta.changes ?? 0) !== 1) {
    throw new HttpError(400, "验证码不正确或已失效，请重新获取");
  }

  return mapChallengeRow({
    ...row,
    consumed_at: new Date().toISOString(),
  });
}

async function incrementChallengeAttempts(
  runtime: AppRuntime,
  id: number,
): Promise<void> {
  await getD1(runtime)
    .prepare(
      `UPDATE email_verification_challenges
      SET attempt_count = attempt_count + 1
      WHERE id = ?`,
    )
    .bind(id)
    .run();
}

function mapChallengeRow(row: ChallengeRow): EmailVerificationChallenge {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    purpose: row.purpose,
    codeHash: row.code_hash,
    pendingPasswordHash: row.pending_password_hash,
    pendingDisplayName: row.pending_display_name,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    attemptCount: row.attempt_count,
  };
}
