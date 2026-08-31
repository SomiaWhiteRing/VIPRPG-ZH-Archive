import { getD1 } from "@/lib/server/db/d1";
import { normalizeCreatorName } from "@/lib/entity-name";
import { isHttpUrl, normalizeHttpUrl } from "@/lib/server/http/safe-url";

export type CreatorWorkCredit = {
  workId: number;
  workTitle: string;
  workOriginalTitle: string;
  roleKey: string;
  roleLabel: string | null;
  notes: string | null;
  originalReleaseDate: string | null;
  status: string;
};
export type PublicCreatorSummary = {
  id: number;
  name: string;
  originalName: string | null;
  websiteUrl: string | null;
  bio: string | null;
  workCreditCount: number;
  latestWorkCreditAt: string | null;
};
export type PublicCreatorDetail = PublicCreatorSummary & {
  workCredits: CreatorWorkCredit[];
};
export type AdminCreatorEdit = PublicCreatorSummary & {
  createdAt: string;
  updatedAt: string;
  extra: Record<string, unknown>;
  adminWorkCredits: CreatorWorkCredit[];
};
type CreatorRow = {
  id: number;
  name: string;
  original_name: string | null;
  website_url: string | null;
  extra_json: string;
  created_at?: string;
  updated_at?: string;
  work_credit_count: number;
  latest_work_credit_at: string | null;
};
type CreditRow = {
  work_id: number;
  work_title: string;
  work_original_title: string;
  role_key: string;
  role_label: string | null;
  notes: string | null;
  original_release_date: string | null;
  status: string;
};

export async function listPublicCreators(
  input: { query?: string; limit?: number } = {},
): Promise<PublicCreatorSummary[]> {
  const binds: Array<string | number> = [];
  const where = [
    `EXISTS (SELECT 1 FROM work_staff ws JOIN works w ON w.id=ws.work_id WHERE ws.creator_id=c.id AND w.status='published')`,
  ];
  if (input.query?.trim()) {
    const q = `%${input.query.trim()}%`;
    where.push("(c.name LIKE ? OR c.original_name LIKE ?)");
    binds.push(q, q);
  }
  const rows = await getD1()
    .prepare(
      `${summarySql()} FROM creators c WHERE ${where.join(" AND ")} ORDER BY latest_work_credit_at DESC,c.name ASC LIMIT ?`,
    )
    .bind(...binds, limitValue(input.limit ?? 120, 300))
    .all<CreatorRow>();
  return (rows.results ?? []).map(mapSummary);
}
export async function getPublicCreatorDetail(
  id: number,
): Promise<PublicCreatorDetail | null> {
  const row = await getD1()
    .prepare(`${summarySql()} FROM creators c WHERE c.id=? LIMIT 1`)
    .bind(id)
    .first<CreatorRow>();
  if (!row) return null;
  return { ...mapSummary(row), workCredits: await listCredits(row.id, false) };
}
export async function listCreatorsForAdmin(
  limit = 300,
): Promise<PublicCreatorSummary[]> {
  const rows = await getD1()
    .prepare(
      `${summarySql()} FROM creators c ORDER BY c.updated_at DESC,c.name ASC LIMIT ?`,
    )
    .bind(limitValue(limit, 500))
    .all<CreatorRow>();
  return (rows.results ?? []).map(mapSummary);
}
export async function searchCreatorsForAdmin(input: {
  query?: string;
  sort?: "default" | "name" | "works";
  page?: number;
  pageSize?: number;
}): Promise<{ items: PublicCreatorSummary[]; total: number; page: number; pageSize: number }> {
  const pageSize = limitValue(input.pageSize ?? 50, 100);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const binds: Array<string | number> = [];
  const clauses: string[] = [];
  if (input.query?.trim()) {
    const value = `%${input.query.trim()}%`;
    clauses.push("(c.name LIKE ? OR c.original_name LIKE ?)");
    binds.push(value, value);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = input.sort === "name"
    ? "c.name ASC,c.id DESC"
    : input.sort === "works"
      ? "work_credit_count DESC,c.id DESC"
      : "c.updated_at DESC,c.id DESC";
  const database = getD1();
  const [rows, count] = await Promise.all([
    database.prepare(`${summarySql()} FROM creators c ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...binds, pageSize, (page - 1) * pageSize).all<CreatorRow>(),
    database.prepare(`SELECT COUNT(*) AS count FROM creators c ${where}`)
      .bind(...binds).first<{ count: number }>(),
  ]);
  return { items: (rows.results ?? []).map(mapSummary), total: count?.count ?? 0, page, pageSize };
}
export async function getCreatorForAdminEdit(
  id: number,
): Promise<AdminCreatorEdit | null> {
  const row = await getD1()
    .prepare(
      `${summarySql()},c.created_at,c.updated_at FROM creators c WHERE c.id=? LIMIT 1`,
    )
    .bind(id)
    .first<CreatorRow>();
  if (!row || !row.created_at || !row.updated_at) return null;
  return {
    ...mapSummary(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    extra: parseExtra(row.extra_json),
    adminWorkCredits: await listCredits(id, true),
  };
}
export async function updateCreatorForAdmin(input: {
  creatorId: number;
  name: string;
  originalName: string | null;
  websiteUrl: string | null;
  bio: string | null;
}): Promise<AdminCreatorEdit> {
  const name = normalizeCreatorName(input.name);
  if (!name) throw new Error("作者名不能为空");
  const existing = await getCreatorForAdminEdit(input.creatorId);
  if (!existing) throw new Error("作者不存在");
  const extra = { ...existing.extra };
  if (input.bio?.trim()) extra.bio = input.bio.trim();
  else delete extra.bio;
  const websiteUrl = normalizeHttpUrl(input.websiteUrl, "作者网站");
  await getD1()
    .prepare(
      `UPDATE creators SET name=?,original_name=?,website_url=?,extra_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(
      name,
      input.originalName,
      websiteUrl,
      JSON.stringify(extra),
      input.creatorId,
    )
    .run();
  const updated = await getCreatorForAdminEdit(input.creatorId);
  if (!updated) throw new Error("作者更新后不可读取");
  return updated;
}
export function parseCreatorEditForm(
  form: FormData,
): Parameters<typeof updateCreatorForAdmin>[0] {
  const id = Number.parseInt(String(form.get("creator_id") ?? ""), 10);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error("Invalid creator id");
  return {
    creatorId: id,
    name: String(form.get("name") ?? ""),
    originalName: clean(form.get("original_name")),
    websiteUrl: clean(form.get("website_url")),
    bio: clean(form.get("bio")),
  };
}
async function listCredits(
  id: number,
  includeNonPublic: boolean,
): Promise<CreatorWorkCredit[]> {
  const status = includeNonPublic
    ? "w.status <> 'deleted'"
    : "w.status='published'";
  const rows = await getD1()
    .prepare(
      `SELECT w.id AS work_id,
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
         AND ${status}
       ORDER BY COALESCE(w.original_release_date, w.published_at, w.created_at) DESC,
         w.original_title ASC`,
    )
    .bind(id)
    .all<CreditRow>();
  return (rows.results ?? []).map((row) => ({
    workId: row.work_id,
    workTitle: row.work_title,
    workOriginalTitle: row.work_original_title,
    roleKey: row.role_key,
    roleLabel: row.role_label,
    notes: row.notes,
    originalReleaseDate: row.original_release_date,
    status: row.status,
  }));
}
function summarySql(): string {
  return `
    SELECT
      c.id,
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
        SELECT MAX(COALESCE(w.original_release_date, w.published_at, w.created_at))
        FROM work_staff ws
        JOIN works w ON w.id = ws.work_id
        WHERE ws.creator_id = c.id
          AND w.status = 'published'
      ) AS latest_work_credit_at`;
}
function mapSummary(row: CreatorRow): PublicCreatorSummary {
  return {
    id: row.id,
    name: row.name,
    originalName: row.original_name,
    websiteUrl: isHttpUrl(row.website_url) ? row.website_url : null,
    bio: bio(row.extra_json),
    workCreditCount: row.work_credit_count,
    latestWorkCreditAt: row.latest_work_credit_at,
  };
}
function bio(value: string): string | null {
  const parsed = parseExtra(value).bio;
  return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
}
function parseExtra(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {}
  return {};
}
function clean(value: FormDataEntryValue | null): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}
function limitValue(value: number, max: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(max, Math.floor(value)))
    : 1;
}
