import { getD1 } from "@/lib/server/db/d1";
import { timingSafeEqualString } from "@/lib/server/crypto/sha256";

export type ChallengePurpose = "register" | "password_reset" | "email_change";

export type EmailVerificationChallenge = {
  id: number;
  userId: number | null;
  email: string;
  purpose: ChallengePurpose;
  codeHash: string;
  pendingPasswordHash: string | null;
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
  expires_at: string;
  consumed_at: string | null;
  attempt_count: number;
};

type CountRow = {
  count: number;
};

export async function assertEmailChallengeQuota(input: {
  userId?: number | null;
  email: string;
  purpose: ChallengePurpose;
}): Promise<void> {
  const row = await getD1()
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
    throw new Error("验证码发送过于频繁，请稍后再试");
  }
}

export async function createEmailChallenge(input: {
  userId?: number | null;
  email: string;
  purpose: ChallengePurpose;
  codeHash: string;
  pendingPasswordHash?: string | null;
}): Promise<void> {
  await getD1()
    .prepare(
      `INSERT INTO email_verification_challenges (
        user_id,
        email,
        purpose,
        code_hash,
        pending_password_hash,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`,
    )
    .bind(
      input.userId ?? null,
      input.email,
      input.purpose,
      input.codeHash,
      input.pendingPasswordHash ?? null,
    )
    .run();
}

export async function deletePendingEmailChallenge(input: {
  userId?: number | null;
  email: string;
  purpose: ChallengePurpose;
  codeHash: string;
}): Promise<void> {
  await getD1()
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

export async function consumeLatestEmailChallenge(input: {
  userId?: number | null;
  email: string;
  purpose: ChallengePurpose;
  codeHash: string;
}): Promise<EmailVerificationChallenge> {
  const row = await getD1()
    .prepare(
      `SELECT
        id,
        user_id,
        email,
        purpose,
        code_hash,
        pending_password_hash,
        expires_at,
        consumed_at,
        attempt_count
      FROM email_verification_challenges
      WHERE email = ?
        AND purpose = ?
        AND user_id IS ?
        AND consumed_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
      LIMIT 1`,
    )
    .bind(input.email, input.purpose, input.userId ?? null)
    .first<ChallengeRow>();

  if (!row) {
    throw new Error("验证码不存在或已失效");
  }

  if (row.attempt_count >= 5) {
    throw new Error("验证码尝试次数过多，请重新获取");
  }

  if (!timingSafeEqualString(row.code_hash, input.codeHash)) {
    await incrementChallengeAttempts(row.id);
    throw new Error("验证码不正确");
  }

  const consumed = await getD1()
    .prepare(
      `UPDATE email_verification_challenges
      SET consumed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND consumed_at IS NULL`,
    )
    .bind(row.id)
    .run();

  if (Number(consumed.meta.changes ?? 0) !== 1) {
    throw new Error("验证码已被使用");
  }

  return mapChallengeRow({
    ...row,
    consumed_at: new Date().toISOString(),
  });
}

async function incrementChallengeAttempts(id: number): Promise<void> {
  await getD1()
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
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    attemptCount: row.attempt_count,
  };
}
