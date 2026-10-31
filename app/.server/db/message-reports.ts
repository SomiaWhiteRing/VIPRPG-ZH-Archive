import type { AppRuntime } from "@/app/.server/runtime";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { hasPermission } from "@/lib/authz/permissions";
import { FORUM_REPORT_REASONS, FORUM_WRITES_PER_MINUTE } from "@/lib/forum";
import { HttpError } from "@/lib/http";

export async function createDirectMessageReport(runtime: AppRuntime, user: ArchiveUser, peerId: number, input: Record<string, unknown>) {
  if (!FORUM_REPORT_REASONS.includes(input.reason as typeof FORUM_REPORT_REASONS[number])) throw new HttpError(400, "请选择举报原因。");
  const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";
  if (explanation.length > 2000 || (input.reason === "其他" && !explanation)) throw new HttpError(400, "请填写 1–2000 个字符的说明。");
  const peer = await runtime.db.prepare(`SELECT u.id FROM users u WHERE u.id=? AND u.id<>?
    AND ((u.status='active' AND u.receive_private_messages=1) OR EXISTS(SELECT 1 FROM direct_conversations c
      WHERE c.lower_user_id=MIN(?,u.id) AND c.upper_user_id=MAX(?,u.id)))`)
    .bind(peerId, user.id, user.id, user.id).first<{ id: number }>();
  if (!peer) throw new HttpError(404, "会话不存在");
  await runtime.db.batch([
    runtime.db.prepare(`INSERT INTO direct_conversations(lower_user_id,upper_user_id) VALUES(MIN(?,?),MAX(?,?))
      ON CONFLICT(lower_user_id,upper_user_id) DO NOTHING`).bind(user.id, peerId, user.id, peerId),
    runtime.db.prepare(`INSERT INTO direct_conversation_states(conversation_id,user_id)
      SELECT id,lower_user_id FROM direct_conversations WHERE lower_user_id=MIN(?,?) AND upper_user_id=MAX(?,?)
      UNION ALL SELECT id,upper_user_id FROM direct_conversations WHERE lower_user_id=MIN(?,?) AND upper_user_id=MAX(?,?)
      ON CONFLICT(conversation_id,user_id) DO NOTHING`).bind(user.id, peerId, user.id, peerId, user.id, peerId, user.id, peerId),
    runtime.db.prepare(`INSERT OR IGNORE INTO direct_message_reports(user_id,peer_user_id,conversation_id,reason,explanation)
      SELECT ?,?,c.id,?,? FROM direct_conversations c WHERE c.lower_user_id=MIN(?,?) AND c.upper_user_id=MAX(?,?)
      AND (SELECT COUNT(*) FROM direct_message_reports WHERE user_id=? AND created_at>=datetime('now','-1 minute'))<?`)
      .bind(user.id, peerId, input.reason as string, explanation, user.id, peerId, user.id, peerId, user.id, FORUM_WRITES_PER_MINUTE),
  ]);
  const report = await runtime.db.prepare("SELECT id FROM direct_message_reports WHERE user_id=? AND peer_user_id=? AND status='pending'")
    .bind(user.id, peerId).first<{ id: number }>();
  if (!report) throw new HttpError(429, "提交未完成，请稍后重试。");
  return report;
}

export async function readDirectMessageReport(runtime: AppRuntime, user: ArchiveUser, id: number) {
  if (!hasPermission(user, "forum.content.moderate_any")) throw new HttpError(403, "没有举报处理权限。");
  const report = await runtime.db.prepare(`SELECT r.id,r.conversation_id AS conversationId,r.user_id AS reporterId,r.peer_user_id AS peerId,
    reporter.display_name AS reporterName,peer.display_name AS peerName,r.reason,r.explanation,r.status,r.note,r.created_at AS createdAt
    FROM direct_message_reports r JOIN users reporter ON reporter.id=r.user_id JOIN users peer ON peer.id=r.peer_user_id WHERE r.id=?`)
    .bind(id).first<{ id: number; conversationId: number; reporterId: number; peerId: number; reporterName: string; peerName: string;
      reason: string; explanation: string; status: "pending" | "resolved" | "dismissed"; note: string; createdAt: string }>();
  if (!report) throw new HttpError(404, "举报不存在");
  return report;
}

export async function resolveDirectMessageReport(runtime: AppRuntime, user: ArchiveUser, id: number, status: "resolved" | "dismissed", note: string) {
  await readDirectMessageReport(runtime, user, id);
  await runtime.db.batch([
    runtime.db.prepare("UPDATE direct_message_reports SET status=?,note=?,resolved_by=?,resolved_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(status, note, user.id, id),
    runtime.db.prepare("INSERT INTO auth_audit_logs(user_id,event_type,detail_json) VALUES(?,'message_report_resolve',?)")
      .bind(user.id, JSON.stringify({ reportId: id, status, note })),
  ]);
}
