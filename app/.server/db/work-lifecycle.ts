import { auditedEntityBatch, workAuditSnapshot } from "@/app/.server/db/entity-audit";
import type { AppRuntime } from "@/app/.server/runtime";
import { hasPermission } from "@/lib/authz/permissions";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";
import type { WorkStatus } from "@/lib/work-visibility";

export async function changeWorkLifecycle(runtime: AppRuntime, workId: number, actor: ArchiveUser,
  operation: "delete" | "restore", expectedStatus: WorkStatus) {
  if (!hasPermission(actor, "work.status.update_any")) throw new HttpError(403, "没有调整作品状态的权限");
  if ((operation === "restore") !== (expectedStatus === "deleted")) throw new HttpError(400, "作品状态与操作不符");
  const db = runtime.db;
  const result = await auditedEntityBatch(db, [
    db.prepare(`UPDATE works SET status=CASE WHEN ?='delete' THEN 'deleted'
      WHEN published_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM archive_versions av WHERE av.work_id=works.id AND av.status='published' AND av.purged_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM work_external_links l WHERE l.work_id=works.id AND l.link_type='download_page')
        THEN 'processing' ELSE 'published' END, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status=?
        AND NOT EXISTS(SELECT 1 FROM import_jobs j WHERE j.work_id=works.id AND j.status='committing')
      RETURNING id`)
      .bind(operation, workId, expectedStatus),
  ], { actor, eventType: "admin_work_lifecycle", targets: [{ type: "work", id: workId }],
    snapshot: workAuditSnapshot(workId), permission: "work.status.update_any", source: "admin", operation });
  // D1's change count includes trigger writes; only the returned work proves this transition matched.
  if (result[0].results.length !== 1)
    throw new HttpError(409, "作品不存在、正在提交或状态已变化，请刷新后重试");
}
