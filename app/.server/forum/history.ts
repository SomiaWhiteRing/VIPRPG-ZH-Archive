import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { ForumHistory, ForumTarget } from "@/lib/forum";
import { FORUM_PAGE_SIZE, forumPage } from "@/lib/forum";
import { auditRecord } from "@/lib/entity-audit";
import { checkPermission } from "./mutations";
import { rawContent } from "./queries";
import type { ForumRuntime } from "./runtime";

export async function forumHistory(ctx: ForumRuntime, actor: ArchiveUser, target: ForumTarget, requested = 1): Promise<ForumHistory> {
  checkPermission(actor, "forum.content.moderate_any");
  const content = await rawContent(ctx, target);
  if (content.kind === "post" && content.post_number === 1) target = { kind: "topic", id: content.topic_id };
  const type = `forum_${target.kind}`;
  // Each forum edit/delete records one normalized target. Match the indexed
  // scalar expressions instead of expanding every audit log's target array.
  const where = `a.event_type IN ('forum_edit','forum_delete') AND json_valid(a.detail_json)
    AND json_extract(a.detail_json,'$.targets[0].type')=?
    AND CAST(json_extract(a.detail_json,'$.targets[0].id') AS TEXT)=?`;
  const binds = [type, String(target.id)];
  const total = (await ctx.db.prepare(`SELECT COUNT(*) AS n FROM auth_audit_logs a WHERE ${where}`)
    .bind(...binds).first<{ n: number }>())!.n;
  const page = Math.min(forumPage(requested), Math.max(1, Math.ceil(total / FORUM_PAGE_SIZE)));
  const rows = await ctx.db.prepare(`SELECT a.id,a.user_id,a.event_type,a.detail_json,a.created_at,u.display_name
    FROM auth_audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, FORUM_PAGE_SIZE, (page - 1) * FORUM_PAGE_SIZE)
    .all<{ id: number; user_id: number | null; event_type: string; detail_json: string; created_at: string; display_name: string | null }>();
  return { target, topicId: content.topic_id, state: content.status, total, page, pageSize: FORUM_PAGE_SIZE,
    items: rows.results.map((row) => {
      const detail = auditRecord(JSON.parse(row.detail_json));
      const identity = auditRecord(detail?.actor);
      return { id: row.id, operation: row.event_type === "forum_delete" ? "delete" : "edit",
        actor: { id: typeof identity?.userId === "number" ? identity.userId : row.user_id, name: String(identity?.displayName ?? row.display_name ?? "系统") }, createdAt: row.created_at,
        before: auditRecord(detail?.before), after: auditRecord(detail?.after) };
    }) };
}
