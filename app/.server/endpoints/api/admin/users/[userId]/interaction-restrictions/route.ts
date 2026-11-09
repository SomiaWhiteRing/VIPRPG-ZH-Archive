import { requirePermission } from "@/app/.server/auth/authorize";
import { userManagementScopeSql } from "@/app/.server/db/permissions";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { INTERACTION_RESTRICTIONS } from "@/lib/interaction-restrictions";
import { HttpError, json } from "@/lib/http";

export async function PUT(runtime: AppRuntime, request: Request, userId: string) {
  const auth = await requirePermission(runtime, request, "user.status.update");
  if ("response" in auth) return auth.response;
  const senderId = parsePositiveId(userId), recipient = auth.user;
  const db = runtime.db;
  if (senderId === recipient.id || !await db.prepare("SELECT 1 FROM users WHERE id=? AND status<>'deleted'").bind(senderId).first())
    throw new HttpError(404, "用户不存在");
  const { kinds } = await readJsonObject(request, "屏蔽设置无效", { maximumBytes: 1024, requireJsonContentType: true });
  if (!Array.isArray(kinds) || kinds.length > INTERACTION_RESTRICTIONS.length ||
      !kinds.every(kind => INTERACTION_RESTRICTIONS.some(option => option.kind === kind)) || new Set(kinds).size !== kinds.length)
    throw new HttpError(400, "屏蔽设置无效");
  const next = JSON.stringify([...kinds].sort());
  const current = `SELECT json_group_array(kind) FROM (SELECT kind FROM user_interaction_restrictions
    WHERE recipient_user_id=? AND sender_user_id=? ORDER BY kind)`;
  const allowed = `EXISTS(SELECT 1 FROM users target WHERE ${userManagementScopeSql("user.status.update", "target.id")}
    AND target.id=? AND target.status<>'deleted')`;
  const [authorization] = await db.batch([
    db.prepare(`SELECT 1 WHERE ${allowed}`).bind(recipient.id, senderId),
    db.prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
      SELECT ?,?,'user_interaction_restrictions_updated',json_object('targetUserId',?, 'before', json((${current})), 'after',json(?))
      WHERE ${allowed} AND (${current})<>?`)
      .bind(recipient.id, recipient.email, senderId, recipient.id, senderId, next, recipient.id, senderId, recipient.id, senderId, next),
    db.prepare(`DELETE FROM user_interaction_restrictions WHERE recipient_user_id=? AND sender_user_id=? AND ${allowed}
      AND kind NOT IN (SELECT value FROM json_each(?))`).bind(recipient.id, senderId, recipient.id, senderId, next),
    db.prepare(`INSERT INTO user_interaction_restrictions(recipient_user_id,sender_user_id,kind)
      SELECT ?,?,value FROM json_each(?) WHERE ${allowed} ON CONFLICT DO NOTHING`)
      .bind(recipient.id, senderId, next, recipient.id, senderId),
  ]);
  if (!authorization.results.length) throw new HttpError(403, "Permission denied");
  return json({ ok: true, kinds });
}
