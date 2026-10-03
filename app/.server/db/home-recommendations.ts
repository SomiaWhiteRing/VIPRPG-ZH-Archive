import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HOME_RECOMMENDATION_LIMIT, type HomeRecommendation } from "@/lib/home-recommendations";
import { HttpError } from "@/lib/http";

export async function readHomeRecommendations(runtime: AppRuntime): Promise<HomeRecommendation[]> {
  const rows = await getD1(runtime).prepare(`SELECT w.id,w.original_title,w.chinese_title,
    EXISTS(SELECT 1 FROM public_works pw WHERE pw.id=w.id) AS is_public
    FROM home_recommendations r JOIN works w ON w.id=r.work_id
    ORDER BY r.sort_order,r.work_id`).all<{
      id: number; original_title: string; chinese_title: string | null; is_public: number;
    }>();
  return rows.results.map((row) => ({
    id: row.id, originalTitle: row.original_title, chineseTitle: row.chinese_title,
    isPublic: row.is_public === 1,
  }));
}

export async function saveHomeRecommendations(runtime: AppRuntime, actor: ArchiveUser, workIds: unknown) {
  if (actor.status !== "active" || !actor.isBootstrapAdmin)
    throw new HttpError(403, "只有超级管理员可以配置站长推荐。");
  if (!Array.isArray(workIds) || workIds.length > HOME_RECOMMENDATION_LIMIT ||
    workIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(workIds).size !== workIds.length)
    throw new HttpError(400, `请选择最多 ${HOME_RECOMMENDATION_LIMIT} 个不重复的游戏。`);

  const database = getD1(runtime);
  const idsJson = JSON.stringify(workIds);
  const publicWorks = await database.prepare(`SELECT id FROM public_works
    WHERE id IN (SELECT value FROM json_each(?))`).bind(idsJson).all<{ id: number }>();
  if (publicWorks.results.length !== workIds.length)
    throw new HttpError(400, "推荐中有未公开或已删除的游戏，请移除后保存。");

  // The audit and full ordered replacement commit together; failed saves retain the old list.
  const beforeIds = `SELECT json_group_array(work_id) FROM
    (SELECT work_id FROM home_recommendations ORDER BY sort_order,work_id)`;
  await database.batch([
    database.prepare(`INSERT INTO auth_audit_logs(user_id,email,event_type,detail_json)
      SELECT ?,?,'system.home_recommendations.update',json_object(
        'auditVersion',1,'source','admin','operation','replace',
        'targets',json((SELECT json_group_array(json_object('type','work','id',w.id,
          'name',COALESCE(w.chinese_title,w.original_title))) FROM works w
          WHERE w.id IN (SELECT value FROM json_each(?)) OR w.id IN (SELECT work_id FROM home_recommendations))),
        'authorization',json_object('basis','bootstrap_admin','isBootstrapAdmin',json('true')),
        'before',json_object('workIds',json((${beforeIds}))),
        'after',json_object('workIds',json(?)))
      WHERE (${beforeIds}) <> ?`).bind(actor.id, actor.email, idsJson, idsJson, idsJson),
    database.prepare("DELETE FROM home_recommendations"),
    database.prepare(`INSERT INTO home_recommendations(work_id,sort_order)
      SELECT value,CAST(key AS INTEGER) FROM json_each(?)`).bind(idsJson),
  ]);
}
