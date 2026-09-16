import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";

export async function writeAuthAuditLog(
  runtime: AppRuntime,
  input: {
    userId?: number | null;
    email?: string | null;
    eventType: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    detail?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await getD1(runtime)
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
