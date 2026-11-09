import { userPermissionSql } from "@/app/.server/auth/permission-sql";
import type { RestrictedInteraction } from "@/lib/interaction-restrictions";
import { HttpError } from "@/lib/http";

// The recipient and sender expressions are SQL from callers. Bind request data separately.
export function interactionRestrictedSql(recipient: string, sender: string, kind: RestrictedInteraction): string {
  return `EXISTS(SELECT 1 FROM user_interaction_restrictions restriction
    WHERE restriction.recipient_user_id=${recipient} AND restriction.sender_user_id=${sender}
      AND restriction.kind='${kind}' AND ${userPermissionSql("restriction.recipient_user_id", "user.status.update")})`;
}

export async function assertInteractionAllowed(db: D1Database, recipientId: number, senderId: number, kind: RestrictedInteraction) {
  if (recipientId === senderId) return;
  if (await db.prepare(`SELECT 1 WHERE ${interactionRestrictedSql("?", "?", kind)}`).bind(recipientId, senderId).first())
    throw new HttpError(403, "Permission denied");
}
