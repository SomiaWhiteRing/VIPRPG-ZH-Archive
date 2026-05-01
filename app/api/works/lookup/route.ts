import { requireUploader } from "@/lib/server/auth/guards";
import { getD1 } from "@/lib/server/db/d1";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type WorkLookupRow = {
  id: number;
  slug: string;
  original_title: string;
  chinese_title: string | null;
  alias_titles: string | null;
  sort_title: string | null;
  description: string | null;
  engine_family: string;
  engine_detail: string | null;
  uses_maniacs_patch: number;
  icon_blob_sha256: string | null;
  thumbnail_blob_sha256: string | null;
};

type ReleaseLookupRow = {
  id: number;
  work_id: number;
  release_key: string;
  release_label: string;
  base_variant: "original" | "remake" | "other";
  variant_label: string;
  release_type: string;
  release_date: string | null;
  release_date_precision: string;
  source_name: string | null;
  source_url: string | null;
  executable_path: string | null;
  rights_notes: string | null;
};

type ReleaseLookupOutput = {
  id: number;
  key: string;
  label: string;
  baseVariant: "original" | "remake" | "other";
  variantLabel: string;
  type: string;
  releaseDate: string | null;
  releaseDatePrecision: string;
  sourceName: string | null;
  sourceUrl: string | null;
  executablePath: string | null;
  rightsNotes: string | null;
};

export async function GET(request: Request) {
  const auth = await requireUploader(request);

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
          w.slug,
          w.original_title,
          w.chinese_title,
          (
            SELECT group_concat(wt2.title, char(10))
            FROM work_titles wt2
            WHERE wt2.work_id = w.id
              AND wt2.title_type = 'alias'
          ) AS alias_titles,
          w.sort_title,
          w.description,
          w.engine_family,
          w.engine_detail,
          w.uses_maniacs_patch,
          w.icon_blob_sha256,
          w.thumbnail_blob_sha256
        FROM works w
        LEFT JOIN work_titles wt ON wt.work_id = w.id
        WHERE w.status <> 'deleted'
          AND (
            w.original_title LIKE ? ESCAPE '\\'
            OR w.chinese_title LIKE ? ESCAPE '\\'
            OR wt.title LIKE ? ESCAPE '\\'
            OR w.slug = ?
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
      .bind(like, like, like, slugFromTitle(title), title, title, title)
      .all<WorkLookupRow>();

    const workRows = works.results ?? [];
    const workIds = workRows.map((work) => work.id);
    const releasesByWork = await loadReleasesByWork(workIds);

    return json({
      ok: true,
      works: workRows.map((work) => ({
        id: work.id,
        slug: work.slug,
        originalTitle: work.original_title,
        chineseTitle: work.chinese_title,
        aliases: splitAliases(work.alias_titles),
        sortTitle: work.sort_title,
        description: work.description,
        engineFamily: work.engine_family,
        engineDetail: work.engine_detail,
        usesManiacsPatch: work.uses_maniacs_patch === 1,
        iconBlobSha256: work.icon_blob_sha256,
        thumbnailBlobSha256: work.thumbnail_blob_sha256,
        releases: releasesByWork.get(work.id) ?? [],
      })),
    });
  } catch (error) {
    return jsonError("Work lookup failed", error);
  }
}

async function loadReleasesByWork(workIds: number[]) {
  const result = new Map<number, ReleaseLookupOutput[]>();

  if (workIds.length === 0) {
    return result;
  }

  const placeholders = workIds.map(() => "?").join(", ");
  const rows = await getD1()
    .prepare(
      `SELECT
        id,
        work_id,
        release_key,
        release_label,
        base_variant,
        variant_label,
        release_type,
        release_date,
        release_date_precision,
        source_name,
        source_url,
        executable_path,
        rights_notes
      FROM releases
      WHERE status <> 'deleted'
        AND work_id IN (${placeholders})
      ORDER BY published_at DESC, created_at DESC`,
    )
    .bind(...workIds)
    .all<ReleaseLookupRow>();

  for (const row of rows.results ?? []) {
    const releases = result.get(row.work_id) ?? [];
    releases.push({
      id: row.id,
      key: row.release_key,
      label: row.release_label,
      baseVariant: row.base_variant,
      variantLabel: row.variant_label,
      type: row.release_type,
      releaseDate: row.release_date,
      releaseDatePrecision: row.release_date_precision,
      sourceName: row.source_name,
      sourceUrl: row.source_url,
      executablePath: row.executable_path,
      rightsNotes: row.rights_notes,
    });
    result.set(row.work_id, releases);
  }

  return result;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function splitAliases(value: string | null): string[] {
  return value ? value.split("\n").filter(Boolean) : [];
}

function slugFromTitle(title: string): string {
  return (
    title
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "untitled-work"
  );
}
