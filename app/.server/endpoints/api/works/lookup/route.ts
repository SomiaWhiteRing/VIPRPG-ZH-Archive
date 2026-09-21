import { requirePermission } from "@/app/.server/auth/authorize";
import { getD1 } from "@/app/.server/db/d1";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

type WorkLookupRow = {
  id: number;
  original_title: string;
  chinese_title: string | null;
  alias_titles: string | null;
  description: string | null;
  original_release_date: string | null;
  engine_family: string;
  language: string;
  cover_blob_sha256: string | null;
  is_original: number;
  is_translation: number;
  can_edit: number;
};

export async function GET(runtime: AppRuntime, request: Request) {
  const auth = await requirePermission(
    runtime,
    request,
    "work.lookup_non_deleted",
  );

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);
    const title = url.searchParams.get("title")?.trim() ?? "";
    const excludedWorkIds = (url.searchParams.get("excludeWorkIds") ?? "")
      .split(",")
      .filter(Boolean)
      .map((id) => parsePositiveId(id, "excluded work id"));

    if (!title) {
      return json({ ok: true, works: [] });
    }

    const like = `%${escapeLike(title)}%`;
    const works = await getD1(runtime)
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
          w.original_release_date,
          w.engine_family,
          w.language,
          (
            SELECT ma.blob_sha256
            FROM work_media_assets wma
            JOIN media_assets ma ON ma.id = wma.media_asset_id
            WHERE wma.work_id = w.id AND wma.role='cover'
            ORDER BY wma.sort_order, wma.media_asset_id
            LIMIT 1
          ) AS cover_blob_sha256,
          w.is_original,
          w.is_translation,
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
        FROM public_works w
        LEFT JOIN work_titles wt ON wt.work_id = w.id
        WHERE w.id NOT IN (SELECT value FROM json_each(?))
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
        auth.user.permissionKeys.includes("work.metadata.update_any") ? 1 : 0,
        JSON.stringify(excludedWorkIds),
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
        originalReleaseDate: work.original_release_date,
        engineFamily: work.engine_family,
        language: work.language,
        coverBlobSha256: work.cover_blob_sha256,
        isOriginal: work.is_original === 1,
        isTranslation: work.is_translation === 1,
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
