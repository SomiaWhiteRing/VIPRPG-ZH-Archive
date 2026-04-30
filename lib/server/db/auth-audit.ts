import { getD1 } from "@/lib/server/db/d1";

export async function writeAuthAuditLog(input: {
  userId?: number | null;
  email?: string | null;
  eventType: string;
  ipHash?: string | null;
  userAgentHash?: string | null;
  detail?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  await getD1()
    .prepare(
      `INSERT INTO auth_audit_logs (
        user_id,
        email,
        event_type,
        ip_hash,
        user_agent_hash,
        detail_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.userId ?? null,
      input.email ?? null,
      input.eventType,
      input.ipHash ?? null,
      input.userAgentHash ?? null,
      input.detail ? JSON.stringify(input.detail) : null,
    )
    .run();
}
