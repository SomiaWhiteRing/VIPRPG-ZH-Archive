import { requirePermission } from "@/lib/server/auth/authorize";
import { getD1 } from "@/lib/server/db/d1";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type WorkLookupRow = {
  id: number;
  original_title: string;
  chinese_title: string | null;
  alias_titles: string | null;
  description: string | null;
  engine_family: string;
  language: string;
  is_original: number;
  can_edit: number;
};

export async function GET(request: Request) {
  const auth = await requirePermission(request, "work.lookup_non_deleted");

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);
    const title = url.searchParams.get("title")?.trim() ?? "";

    if (!title) {
      return json({ ok: true, works: [] });
    }

    const like = `%${escapeLike(title)}%`;
    const works = await getD1()
      .prepare(
        `SELECT DISTINCT
          w.id,
          w.original_title,
          w.chinese_title,
          (
            SELECT group_concat(wt2.title, char(10))
            FROM work_titles wt2
            WHERE wt2.work_id = w.id
              AND wt2.title_type = 'alias'
          ) AS alias_titles,
          w.description,
          w.engine_family,
          w.language,
          w.is_original,
          CASE
            WHEN (
              ? = 1 AND EXISTS (
                SELECT 1
                FROM work_uploaders wu
                WHERE wu.work_id = w.id AND wu.user_id = ?
              )
            ) OR ? = 1 THEN 1
            ELSE 0
          END AS can_edit
        FROM works w
        LEFT JOIN work_titles wt ON wt.work_id = w.id
        WHERE w.status <> 'deleted'
          AND (
            w.status = 'published'
            OR ? = 1
            OR (? = 1 AND EXISTS (
              SELECT 1 FROM work_uploaders private_wu
              WHERE private_wu.work_id = w.id AND private_wu.user_id = ?
            ))
          )
          AND (
            w.original_title LIKE ? ESCAPE '\\'
            OR w.chinese_title LIKE ? ESCAPE '\\'
            OR wt.title LIKE ? ESCAPE '\\'
          )
        ORDER BY
          CASE
            WHEN w.original_title = ? THEN 0
            WHEN w.chinese_title = ? THEN 1
            WHEN wt.title = ? THEN 2
            ELSE 3
          END,
          w.updated_at DESC
        LIMIT 5`,
      )
      .bind(
        auth.user.permissionKeys.includes("work.update_own") ? 1 : 0,
        auth.user.id,
        auth.user.permissionKeys.includes("work.update") ? 1 : 0,
        auth.user.permissionKeys.includes("work.read_private") ? 1 : 0,
        auth.user.permissionKeys.includes("work.update_own") ? 1 : 0,
        auth.user.id,
        like,
        like,
        like,
        title,
        title,
        title,
      )
      .all<WorkLookupRow>();

    const workRows = works.results ?? [];
    return json({
      ok: true,
      works: workRows.map((work) => ({
        id: work.id,
        originalTitle: work.original_title,
        chineseTitle: work.chinese_title,
        aliases: splitAliases(work.alias_titles),
        description: work.description,
        engineFamily: work.engine_family,
        language: work.language,
        isOriginal: work.is_original === 1,
        canEdit: work.can_edit === 1,
      })),
    });
  } catch (error) {
    return jsonError("Work lookup failed", error);
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function splitAliases(value: string | null): string[] {
  return value ? value.split("\n").filter(Boolean) : [];
}
