import { requirePermission } from "@/app/.server/auth/authorize";
import { getD1 } from "@/app/.server/db/d1";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  const auth = await requirePermission(runtime, request, "work.update_own");
  if ("response" in auth) return auth.response;
  try {
    const id = parsePositiveId((await context.params).workId, "work id");
    const form = await request.formData();
    if (form.get("confirm") !== "delete")
      throw new HttpError(400, "请确认删除作品");
    const db = getD1(runtime);
    // Deletion only needs ownership, including incomplete uploads without editable metadata.
    const [owned, deleted] = await db.batch([
      db
        .prepare(
          `SELECT w.id FROM works w
           JOIN work_uploaders wu ON wu.work_id=w.id
           WHERE w.id=? AND wu.user_id=? AND w.status<>'deleted'`,
        )
        .bind(id, auth.user.id),
      db
        .prepare(
          `UPDATE works SET status='deleted',updated_at=CURRENT_TIMESTAMP
           WHERE id=? AND status<>'deleted'
             AND EXISTS (SELECT 1 FROM work_uploaders WHERE work_id=works.id AND user_id=?)
             AND NOT EXISTS (SELECT 1 FROM import_jobs WHERE work_id=works.id AND status='committing')`,
        )
        .bind(id, auth.user.id),
      db
        .prepare(
          `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
           SELECT ?,?,'work_deleted',? WHERE changes()=1`,
        )
        .bind(auth.user.id, auth.user.email, JSON.stringify({ workId: id })),
    ]);
    if (!owned.results?.length)
      throw new HttpError(404, "作品不存在或不可维护");
    if (Number(deleted.meta.changes ?? 0) !== 1)
      throw new HttpError(409, "作品正在提交或状态已变化，请等待提交结束或刷新后重试");
    return json({ ok: true, redirectTo: "/me/uploads" });
  } catch (error) {
    return jsonError("删除作品失败", error);
  }
}
