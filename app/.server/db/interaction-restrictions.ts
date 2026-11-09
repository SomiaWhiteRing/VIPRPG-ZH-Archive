import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";
import { INTERACTION_RESTRICTIONS, type RestrictedInteraction } from "@/lib/interaction-restrictions";

// The recipient and sender expressions are SQL from callers. Bind request data separately.
export function interactionRestrictedSql(recipient: string, sender: string, kind: RestrictedInteraction): string {
  return `EXISTS(SELECT 1 FROM user_interaction_restrictions restriction
    WHERE restriction.recipient_user_id=${recipient} AND restriction.sender_user_id=${sender}
      AND restriction.kind='${kind}')`;
}

export async function readInteractionRestrictions(db: D1Database, recipientId: number, senderId: number): Promise<RestrictedInteraction[] | null> {
  const { results } = await db.prepare(`SELECT restriction.kind FROM users sender
    LEFT JOIN user_interaction_restrictions restriction ON restriction.recipient_user_id=? AND restriction.sender_user_id=sender.id
    WHERE sender.id=? AND sender.status<>'deleted'`)
    .bind(recipientId, senderId).all<{ kind: RestrictedInteraction | null }>();
  return results.length ? results.flatMap(row => row.kind === null ? [] : [row.kind]) : null;
}

export function parseInteractionRestrictions(kinds: unknown): RestrictedInteraction[] {
  if (!Array.isArray(kinds) || kinds.length > INTERACTION_RESTRICTIONS.length ||
      !kinds.every((kind): kind is RestrictedInteraction => INTERACTION_RESTRICTIONS.some(option => option.kind === kind)) ||
      new Set(kinds).size !== kinds.length)
    throw new HttpError(400, "屏蔽设置无效");
  return kinds;
}

export function interactionRestrictionStatements(db: D1Database, recipient: ArchiveUser, senderId: number, kinds: RestrictedInteraction[]) {
  const next = JSON.stringify([...kinds].sort());
  const current = `SELECT json_group_array(kind) FROM (SELECT kind FROM user_interaction_restrictions
    WHERE recipient_user_id=? AND sender_user_id=? ORDER BY kind)`;
  return [
    db.prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
      SELECT ?,?,'user_interaction_restrictions_updated',json_object('targetUserId',?, 'before',json((${current})), 'after',json(?))
      WHERE (${current})<>?`)
      .bind(recipient.id, recipient.email, senderId, recipient.id, senderId, next, recipient.id, senderId, next),
    db.prepare(`DELETE FROM user_interaction_restrictions WHERE recipient_user_id=? AND sender_user_id=?
      AND kind NOT IN (SELECT value FROM json_each(?))`).bind(recipient.id, senderId, next),
    db.prepare(`INSERT INTO user_interaction_restrictions(recipient_user_id,sender_user_id,kind)
      SELECT ?,?,value FROM json_each(?) WHERE true ON CONFLICT DO NOTHING`).bind(recipient.id, senderId, next),
  ];
}

export async function assertInteractionAllowed(db: D1Database, recipientId: number, senderId: number, kind: RestrictedInteraction) {
  if (recipientId === senderId) return;
  if (await db.prepare(`SELECT 1 WHERE ${interactionRestrictedSql("?", "?", kind)}`).bind(recipientId, senderId).first())
    throw new HttpError(403, "Permission denied");
}
