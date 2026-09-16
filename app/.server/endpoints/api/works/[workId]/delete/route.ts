import { requirePermission } from "@/app/.server/auth/authorize";
import { getD1 } from "@/app/.server/db/d1";
import { getOwnedWorkForEdit } from "@/app/.server/db/game-library";
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
    if (!(await getOwnedWorkForEdit(runtime, id, auth.user)))
      throw new HttpError(404, "作品不存在或不可维护");
    const db = getD1(runtime);
    await db.batch([
      db
        .prepare(
          `UPDATE works SET status='deleted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'deleted'`,
        )
        .bind(id),
      db
        .prepare(
          `INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json) VALUES(?,?,'work_deleted',?)`,
        )
        .bind(auth.user.id, auth.user.email, JSON.stringify({ workId: id })),
    ]);
    return json({ ok: true, redirectTo: "/me/uploads" });
  } catch (error) {
    return jsonError("删除作品失败", error);
  }
}
