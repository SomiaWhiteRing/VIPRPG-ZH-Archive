import type { AppRuntime } from "@/app/.server/runtime";
import { parsePositiveId } from "@/app/.server/http/request";
import { HttpError, json } from "@/lib/http";

export async function GET(runtime: AppRuntime, request: Request) {
  const values = new URL(request.url).searchParams.get("ids")?.split(",").filter(Boolean) ?? [];
  if (!values.length || values.length > 100) throw new HttpError(400, "作品编号无效");
  const ids = [...new Set(values.map(value => parsePositiveId(value)))];
  const rows = await runtime.db.prepare(`SELECT w.id AS workId,COALESCE(NULLIF(w.chinese_title,''),w.original_title) AS title,
    (SELECT ma.blob_sha256 FROM work_media_assets wm JOIN media_assets ma ON ma.id=wm.media_asset_id
      WHERE wm.work_id=w.id AND wm.role='cover' ORDER BY wm.sort_order LIMIT 1) AS coverBlobSha256
    FROM public_works w WHERE w.id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids)).all<{ workId: number; title: string; coverBlobSha256: string | null }>();
  return json({ ok: true, works: rows.results });
}
