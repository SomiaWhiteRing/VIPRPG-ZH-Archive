import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import type { MaterialSearchResult } from "@/lib/dto/db/material-search";

const PAGE_SIZE = 30;

type MatchRow = {
  archive_version_id: number;
  id: number;
  original_title: string;
  chinese_title: string | null;
  cover_blob_sha256: string | null;
};

export async function findWorksByMaterialHash(
  runtime: AppRuntime,
  sha256: string,
  before = Number.MAX_SAFE_INTEGER,
): Promise<MaterialSearchResult> {
  // Pin the existing hash/cursor index and join order, even when a material is
  // common. Cover lookups are bounded by this page, not all works.
  const { results } = await getD1(runtime).prepare(`
    SELECT r.archive_version_id, w.id, w.original_title, w.chinese_title,
      (SELECT ma.blob_sha256
       FROM work_media_assets wm JOIN media_assets ma ON ma.id = wm.media_asset_id
       WHERE wm.work_id = w.id AND wm.role = 'cover' LIMIT 1) AS cover_blob_sha256
    FROM archive_version_blob_refs r INDEXED BY idx_archive_version_blob_refs_blob
    CROSS JOIN archive_versions av
    CROSS JOIN public_works w
    WHERE r.blob_sha256 = ? AND r.archive_version_id < ?
      AND av.id = r.archive_version_id
      AND av.status = 'published' AND av.is_current = 1 AND av.purged_at IS NULL
      AND w.id = av.work_id
    ORDER BY r.archive_version_id DESC
    LIMIT ?
  `).bind(sha256, before, PAGE_SIZE + 1).all<MatchRow>();
  const page = results.slice(0, PAGE_SIZE);
  // One published current archive per work is enforced by the schema, so no
  // DISTINCT, total COUNT, manifest reads or per-work queries are necessary.
  return {
    works: page.map((row) => ({
      id: row.id,
      originalTitle: row.original_title,
      chineseTitle: row.chinese_title,
      coverBlobSha256: row.cover_blob_sha256,
    })),
    nextCursor: results.length > PAGE_SIZE ? page[page.length - 1].archive_version_id : null,
  };
}
