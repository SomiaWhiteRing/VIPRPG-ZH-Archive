import { getD1 } from "@/lib/server/db/d1";

export type PublicCreatorSummary = {
  id: number;
  slug: string;
  name: string;
  originalName: string | null;
  websiteUrl: string | null;
  bio: string | null;
  workCreditCount: number;
  releaseCreditCount: number;
  latestReleaseCreditAt: string | null;
};

export type PublicCreatorDetail = PublicCreatorSummary & {
  workCredits: CreatorWorkCredit[];
  releaseCredits: CreatorReleaseCredit[];
};

export type AdminCreatorEdit = PublicCreatorSummary & {
  createdAt: string;
  updatedAt: string;
  extra: Record<string, unknown>;
  adminWorkCredits: CreatorWorkCredit[];
  adminReleaseCredits: CreatorReleaseCredit[];
};

export type CreatorWorkCredit = {
  workId: number;
  workSlug: string;
  workTitle: string;
  workOriginalTitle: string;
  roleKey: string;
  roleLabel: string | null;
  notes: string | null;
  originalReleaseDate: string | null;
  status: string;
};

export type CreatorReleaseCredit = {
  releaseId: number;
  workId: number;
  workSlug: string;
  workTitle: string;
  releaseLabel: string;
  releaseDate: string | null;
  roleKey: string;
  roleLabel: string | null;
  notes: string | null;
  status: string;
};

type CreatorRow = {
  id: number;
  slug: string;
  name: string;
  original_name: string | null;
  website_url: string | null;
  extra_json: string;
  created_at?: string;
  updated_at?: string;
  work_credit_count: number;
  release_credit_count: number;
  latest_release_credit_at: string | null;
};

type CreatorWorkCreditRow = {
  work_id: number;
  work_slug: string;
  work_title: string;
  work_original_title: string;
  role_key: string;
  role_label: string | null;
  notes: string | null;
  original_release_date: string | null;
  status: string;
};

type CreatorReleaseCreditRow = {
  release_id: number;
  work_id: number;
  work_slug: string;
  work_title: string;
  release_label: string;
  release_date: string | null;
  role_key: string;
  role_label: string | null;
  notes: string | null;
  status: string;
};

export async function listPublicCreators(input: {
  query?: string;
  limit?: number;
} = {}): Promise<PublicCreatorSummary[]> {
  const where = [
    `(
      EXISTS (
        SELECT 1
        FROM work_staff ws
        JOIN works w ON w.id = ws.work_id
        WHERE ws.creator_id = c.id
          AND w.status = 'published'
      )
      OR EXISTS (
        SELECT 1
        FROM release_staff rs
        JOIN releases r ON r.id = rs.release_id
        JOIN works w ON w.id = r.work_id
        WHERE rs.creator_id = c.id
          AND r.status = 'published'
          AND w.status = 'published'
      )
    )`,
  ];
  const binds: Array<string | number> = [];
  const normalizedQuery = input.query?.trim();

  if (normalizedQuery) {
    const pattern = `%${normalizedQuery}%`;
    where.push("(c.name LIKE ? OR c.original_name LIKE ?)");
    binds.push(pattern, pattern);
  }

  const rows = await getD1()
    .prepare(
      `${creatorSummarySelectSql()}
      FROM creators c
      WHERE ${where.join(" AND ")}
      ORDER BY
        latest_release_credit_at DESC,
        c.name ASC
      LIMIT ?`,
    )
    .bind(...binds, clampLimit(input.limit ?? 120, 1, 300))
    .all<CreatorRow>();

  return (rows.results ?? []).map(mapPublicCreatorSummary);
}

export async function getPublicCreatorDetail(
  slug: string,
): Promise<PublicCreatorDetail | null> {
  const routeSlugs = uniqueClean([slug, decodeRouteSlug(slug)]);
  const row = await getD1()
    .prepare(
      `${creatorSummarySelectSql()}
      FROM creators c
      WHERE c.slug IN (${routeSlugs.map(() => "?").join(", ")})
      LIMIT 1`,
    )
    .bind(...routeSlugs)
    .first<CreatorRow>();

  if (!row) {
    return null;
  }

  const [workCredits, releaseCredits] = await Promise.all([
    listCreatorWorkCredits(row.id, false),
    listCreatorReleaseCredits(row.id, false),
  ]);

  return {
    ...mapPublicCreatorSummary(row),
    workCredits,
    releaseCredits,
  };
}

export async function listCreatorsForAdmin(limit = 300): Promise<PublicCreatorSummary[]> {
  const rows = await getD1()
    .prepare(
      `${creatorSummarySelectSql()}
      FROM creators c
      ORDER BY c.updated_at DESC, c.name ASC
      LIMIT ?`,
    )
    .bind(clampLimit(limit, 1, 500))
    .all<CreatorRow>();

  return (rows.results ?? []).map(mapPublicCreatorSummary);
}

export async function getCreatorForAdminEdit(
  creatorId: number,
): Promise<AdminCreatorEdit | null> {
  const row = await getD1()
    .prepare(
      `${creatorSummarySelectSql()},
        c.created_at,
        c.updated_at
      FROM creators c
      WHERE c.id = ?
      LIMIT 1`,
    )
    .bind(creatorId)
    .first<CreatorRow>();

  if (!row || !row.created_at || !row.updated_at) {
    return null;
  }

  const [adminWorkCredits, adminReleaseCredits] = await Promise.all([
    listCreatorWorkCredits(row.id, true),
    listCreatorReleaseCredits(row.id, true),
  ]);
  const extra = parseExtraJson(row.extra_json);

  return {
    ...mapPublicCreatorSummary(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    extra,
    adminWorkCredits,
    adminReleaseCredits,
  };
}

export async function updateCreatorForAdmin(input: {
  creatorId: number;
  name: string;
  originalName: string | null;
  websiteUrl: string | null;
  bio: string | null;
}): Promise<AdminCreatorEdit> {
  assertRequired(input.name, "作者名");

  const existing = await getCreatorForAdminEdit(input.creatorId);

  if (!existing) {
    throw new Error("作者不存在");
  }

  const extra = {
    ...existing.extra,
  };

  if (input.bio) {
    extra.bio = input.bio;
  } else {
    delete extra.bio;
  }

  await getD1()
    .prepare(
      `UPDATE creators
      SET name = ?,
        original_name = ?,
        website_url = ?,
        extra_json = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(
      input.name.trim(),
      input.originalName,
      input.websiteUrl,
      JSON.stringify(extra),
      input.creatorId,
    )
    .run();

  const updated = await getCreatorForAdminEdit(input.creatorId);

  if (!updated) {
    throw new Error("作者更新后不可读取");
  }

  return updated;
}

export function parseCreatorEditForm(
  formData: FormData,
): Parameters<typeof updateCreatorForAdmin>[0] {
  const creatorId = Number.parseInt(String(formData.get("creator_id") ?? ""), 10);

  if (!Number.isSafeInteger(creatorId) || creatorId <= 0) {
    throw new Error("Invalid creator id");
  }

  return {
    creatorId,
    name: String(formData.get("name") ?? "").trim(),
    originalName: cleanNullable(String(formData.get("original_name") ?? "")),
    websiteUrl: cleanNullable(String(formData.get("website_url") ?? "")),
    bio: cleanNullable(String(formData.get("bio") ?? "")),
  };
}

function creatorSummarySelectSql(): string {
  return `SELECT
    c.id,
    c.slug,
    c.name,
    c.original_name,
    c.website_url,
    c.extra_json,
    (
      SELECT COUNT(DISTINCT ws.work_id)
      FROM work_staff ws
      JOIN works w ON w.id = ws.work_id
      WHERE ws.creator_id = c.id
        AND w.status = 'published'
    ) AS work_credit_count,
    (
      SELECT COUNT(DISTINCT rs.release_id)
      FROM release_staff rs
      JOIN releases r ON r.id = rs.release_id
      JOIN works w ON w.id = r.work_id
      WHERE rs.creator_id = c.id
        AND r.status = 'published'
        AND w.status = 'published'
    ) AS release_credit_count,
    (
      SELECT MAX(COALESCE(r.release_date, r.published_at, r.created_at))
      FROM release_staff rs
      JOIN releases r ON r.id = rs.release_id
      JOIN works w ON w.id = r.work_id
      WHERE rs.creator_id = c.id
        AND r.status = 'published'
        AND w.status = 'published'
    ) AS latest_release_credit_at`;
}

async function listCreatorWorkCredits(
  creatorId: number,
  includeNonPublic: boolean,
): Promise<CreatorWorkCredit[]> {
  const statusSql = includeNonPublic ? "w.status <> 'deleted'" : "w.status = 'published'";
  const rows = await getD1()
    .prepare(
      `SELECT
        w.id AS work_id,
        w.slug AS work_slug,
        COALESCE(w.chinese_title, w.original_title) AS work_title,
        w.original_title AS work_original_title,
        ws.role_key,
        ws.role_label,
        ws.notes,
        w.original_release_date,
        w.status
      FROM work_staff ws
      JOIN works w ON w.id = ws.work_id
      WHERE ws.creator_id = ?
        AND ${statusSql}
      ORDER BY
        COALESCE(w.original_release_date, w.published_at, w.created_at) DESC,
        w.original_title ASC`,
    )
    .bind(creatorId)
    .all<CreatorWorkCreditRow>();

  return (rows.results ?? []).map(mapCreatorWorkCreditRow);
}

async function listCreatorReleaseCredits(
  creatorId: number,
  includeNonPublic: boolean,
): Promise<CreatorReleaseCredit[]> {
  const statusSql = includeNonPublic
    ? "r.status <> 'deleted' AND w.status <> 'deleted'"
    : "r.status = 'published' AND w.status = 'published'";
  const rows = await getD1()
    .prepare(
      `SELECT
        r.id AS release_id,
        w.id AS work_id,
        w.slug AS work_slug,
        COALESCE(w.chinese_title, w.original_title) AS work_title,
        r.release_label,
        r.release_date,
        rs.role_key,
        rs.role_label,
        rs.notes,
        r.status
      FROM release_staff rs
      JOIN releases r ON r.id = rs.release_id
      JOIN works w ON w.id = r.work_id
      WHERE rs.creator_id = ?
        AND ${statusSql}
      ORDER BY
        COALESCE(r.release_date, r.published_at, r.created_at) DESC,
        w.original_title ASC,
        r.release_label ASC`,
    )
    .bind(creatorId)
    .all<CreatorReleaseCreditRow>();

  return (rows.results ?? []).map(mapCreatorReleaseCreditRow);
}

function mapPublicCreatorSummary(row: CreatorRow): PublicCreatorSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    originalName: row.original_name,
    websiteUrl: row.website_url,
    bio: creatorBio(row.extra_json),
    workCreditCount: row.work_credit_count,
    releaseCreditCount: row.release_credit_count,
    latestReleaseCreditAt: row.latest_release_credit_at,
  };
}

function mapCreatorWorkCreditRow(row: CreatorWorkCreditRow): CreatorWorkCredit {
  return {
    workId: row.work_id,
    workSlug: row.work_slug,
    workTitle: row.work_title,
    workOriginalTitle: row.work_original_title,
    roleKey: row.role_key,
    roleLabel: row.role_label,
    notes: row.notes,
    originalReleaseDate: row.original_release_date,
    status: row.status,
  };
}

function mapCreatorReleaseCreditRow(row: CreatorReleaseCreditRow): CreatorReleaseCredit {
  return {
    releaseId: row.release_id,
    workId: row.work_id,
    workSlug: row.work_slug,
    workTitle: row.work_title,
    releaseLabel: row.release_label,
    releaseDate: row.release_date,
    roleKey: row.role_key,
    roleLabel: row.role_label,
    notes: row.notes,
    status: row.status,
  };
}

function creatorBio(extraJson: string): string | null {
  const bio = parseExtraJson(extraJson).bio;

  return typeof bio === "string" && bio.trim() ? bio.trim() : null;
}

function parseExtraJson(extraJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(extraJson) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Keep corrupted legacy data from breaking public pages.
  }

  return {};
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function cleanNullable(value: string | null | undefined): string | null {
  const cleaned = value?.trim() ?? "";

  return cleaned || null;
}

function uniqueClean(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function decodeRouteSlug(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function assertRequired(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} 不能为空`);
  }
}
