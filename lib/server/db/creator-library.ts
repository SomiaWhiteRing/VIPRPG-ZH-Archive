import { getD1 } from "@/lib/server/db/d1";
import type { CreatorSuggestion } from "@/lib/creator-names";
import { creatorNameKey } from "@/lib/creator-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { HttpError } from "@/lib/server/http/json";
import { isHttpUrl, normalizeHttpUrl } from "@/lib/server/http/safe-url";

export type CreatorWorkCredit = {
  workId: number;
  workTitle: string;
  workOriginalTitle: string;
  displayName: string;
  roleKey: string;
  roleLabel: string | null;
  notes: string | null;
  originalReleaseDate: string | null;
  previewBlobSha256: string | null;
  status: string;
};
export type PublicCreatorSummary = {
  id: number;
  name: string;
  disambiguation: string;
  avatarBlobSha256: string | null;
  websiteUrl: string | null;
  bio: string | null;
  workCreditCount: number;
  latestWorkCreditAt: string | null;
};
export type PublicCreatorDetail = PublicCreatorSummary & {
  aliases: string[];
  workCredits: CreatorWorkCredit[];
};
export type AdminCreatorEdit = PublicCreatorSummary & {
  aliases: string[];
  createdAt: string;
  updatedAt: string;
  extra: Record<string, unknown>;
  adminWorkCredits: CreatorWorkCredit[];
};
type CreatorRow = {
  id: number;
  name: string;
  disambiguation: string;
  avatar_blob_sha256: string | null;
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
  display_name: string;
  role_key: string;
  role_label: string | null;
  notes: string | null;
  original_release_date: string | null;
  preview_blob_sha256: string | null;
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
    where.push("(c.name LIKE ? OR EXISTS(SELECT 1 FROM creator_aliases ca WHERE ca.creator_id=c.id AND ca.name LIKE ?))");
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
  const database = getD1();
  const [creatorResult, aliasesResult] = await database.batch([
    database.prepare(`${summarySql()} FROM creators c WHERE c.id=? AND EXISTS (
      SELECT 1 FROM work_staff ws JOIN works w ON w.id=ws.work_id
      WHERE ws.creator_id=c.id AND w.status='published'
    ) LIMIT 1`).bind(id),
    database.prepare(`SELECT name FROM creator_aliases WHERE creator_id=? ORDER BY name`).bind(id),
  ]);
  const row = (creatorResult.results?.[0] ?? null) as CreatorRow | null;
  if (!row) return null;
  return {
    ...mapSummary(row),
    aliases: (aliasesResult.results ?? []).map((alias) => String((alias as { name: string }).name)),
    workCredits: await listCredits(row.id, false),
  };
}
export async function listCreatorSuggestions(): Promise<CreatorSuggestion[]> {
  const database = getD1();
  const [creatorsResult, aliasesResult] = await database.batch([
    database.prepare(
      `SELECT c.id,c.name,c.disambiguation,
        (SELECT COUNT(DISTINCT ws.work_id) FROM work_staff ws WHERE ws.creator_id=c.id) AS work_count
       FROM creators c
       ORDER BY work_count DESC,c.name ASC
       LIMIT 2000`,
    ),
    database.prepare(
      `SELECT creator_id,name FROM creator_aliases ORDER BY creator_id,name`,
    ),
  ]);
  const rows = (creatorsResult.results ?? []) as Array<{
      id: number;
      name: string;
      disambiguation: string;
      work_count: number;
    }>;
  const suggestions = new Map<number, CreatorSuggestion>();
  for (const row of rows) {
    suggestions.set(row.id, {
      id: row.id,
      name: row.name,
      disambiguation: row.disambiguation,
      aliases: [],
      workCount: row.work_count,
    });
  }
  for (const row of (aliasesResult.results ?? []) as Array<{
    creator_id: number;
    name: string;
  }>) {
    suggestions.get(row.creator_id)?.aliases.push({ name: row.name });
  }
  return [...suggestions.values()];
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
    clauses.push("(c.name LIKE ? OR EXISTS(SELECT 1 FROM creator_aliases ca WHERE ca.creator_id=c.id AND ca.name LIKE ?))");
    binds.push(value, value);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = input.sort === "name"
    ? "c.name ASC,c.id DESC"
    : input.sort === "works"
      ? "work_credit_count DESC,c.id DESC"
      : "c.updated_at DESC,c.id DESC";
  const database = getD1();
  const [rowsResult, countResult] = await database.batch([
    database.prepare(`${summarySql()} FROM creators c ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...binds, pageSize, (page - 1) * pageSize),
    database.prepare(`SELECT COUNT(*) AS count FROM creators c ${where}`)
      .bind(...binds),
  ]);
  return {
    items: ((rowsResult.results ?? []) as CreatorRow[]).map(mapSummary),
    total: Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    page,
    pageSize,
  };
}
export async function getCreatorForAdminEdit(
  id: number,
): Promise<AdminCreatorEdit | null> {
  const database = getD1();
  const [creatorResult, aliasesResult] = await database.batch([
    database
      .prepare(
        `${summarySql()},c.created_at,c.updated_at FROM creators c WHERE c.id=? LIMIT 1`,
      )
      .bind(id),
    database
      .prepare(`SELECT name FROM creator_aliases WHERE creator_id=? ORDER BY name`)
      .bind(id),
  ]);
  const row = (creatorResult.results?.[0] ?? null) as CreatorRow | null;
  if (!row || !row.created_at || !row.updated_at) return null;
  return {
    ...mapSummary(row),
    aliases: (aliasesResult.results ?? []).map((alias) => String((alias as { name: string }).name)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    extra: parseExtra(row.extra_json),
    adminWorkCredits: await listCredits(id, true),
  };
}
export async function updateCreatorForAdmin(input: {
  creatorId: number;
  name: string;
  disambiguation: string;
  websiteUrl: string | null;
  bio: string | null;
  aliases: string[];
}): Promise<AdminCreatorEdit> {
  const name = normalizeEntityName(input.name);
  if (!name) throw new Error("作者名不能为空");
  const identityKeys = new Set([creatorNameKey(name)]);
  const aliases = uniqueNames(input.aliases).filter(
    (alias) => !identityKeys.has(creatorNameKey(alias)),
  );
  const existing = await getCreatorForAdminEdit(input.creatorId);
  if (!existing) throw new Error("作者不存在");
  const extra = { ...existing.extra };
  if (input.bio?.trim()) extra.bio = input.bio.trim();
  else delete extra.bio;
  const websiteUrl = normalizeHttpUrl(input.websiteUrl, "作者网站");
  const database = getD1();
  try {
    await database.batch([
      database.prepare(`DELETE FROM creator_aliases WHERE creator_id=?`).bind(input.creatorId),
      database
        .prepare(
          `UPDATE creators
           SET name=?,name_key=?,disambiguation=?,website_url=?,extra_json=?,updated_at=CURRENT_TIMESTAMP
           WHERE id=?`,
        )
        .bind(
          name,
          creatorNameKey(name),
          input.disambiguation.trim(),
          websiteUrl,
          JSON.stringify(extra),
          input.creatorId,
        ),
      ...aliases.map((alias) =>
        database
          .prepare(
            `INSERT INTO creator_aliases(creator_id,name,name_key,source)
             VALUES(?,?,?,'admin')`,
          )
          .bind(input.creatorId, alias, creatorNameKey(alias)),
      ),
    ]);
  } catch (error) {
    if (isCreatorIdentityConstraintError(error)) {
      throw new HttpError(
        409,
        "已有同名且区分说明相同的人物，请选择不同说明或在后台合并重复人物。",
        "creator_name_conflict",
      );
    }
    throw error;
  }
  const updated = await getCreatorForAdminEdit(input.creatorId);
  if (!updated) throw new Error("作者更新后不可读取");
  return updated;
}

export async function updateCreatorAvatar(
  creatorId: number,
  avatarBlobSha256: string | null,
): Promise<void> {
  const result = await getD1()
    .prepare(
      `UPDATE creators
       SET avatar_blob_sha256=?,updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
    )
    .bind(avatarBlobSha256, creatorId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) throw new HttpError(404, "作者不存在");
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
    disambiguation: String(form.get("disambiguation") ?? "").trim(),
    websiteUrl: clean(form.get("website_url")),
    bio: clean(form.get("bio")),
    aliases: lines(form.get("aliases")),
  };
}
async function listCredits(
  id: number,
  includeNonPublic: boolean,
): Promise<CreatorWorkCredit[]> {
  const status = includeNonPublic
    ? "1=1"
    : "w.status='published'";
  const rows = await getD1()
    .prepare(
      `SELECT w.id AS work_id,
          COALESCE(w.chinese_title, w.original_title) AS work_title,
          w.original_title AS work_original_title,
          ws.display_name,
          ws.role_key,
          ws.role_label,
          ws.notes,
          w.original_release_date,
          (
            SELECT ma.blob_sha256
            FROM work_media_assets wma
            JOIN media_assets ma ON ma.id=wma.media_asset_id
            WHERE wma.work_id=w.id AND ma.kind='preview'
            ORDER BY wma.is_primary DESC,wma.sort_order
            LIMIT 1
          ) AS preview_blob_sha256,
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
    displayName: row.display_name,
    roleKey: row.role_key,
    roleLabel: row.role_label,
    notes: row.notes,
    originalReleaseDate: row.original_release_date,
    previewBlobSha256: row.preview_blob_sha256,
    status: row.status,
  }));
}
function summarySql(): string {
  return `
    SELECT
      c.id,
      c.name,
      c.disambiguation,
      c.avatar_blob_sha256,
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
    disambiguation: row.disambiguation,
    avatarBlobSha256: row.avatar_blob_sha256,
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

function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n/u)
    .map(normalizeEntityName)
    .filter(Boolean);
}

function uniqueNames(values: string[]): string[] {
  const names = new Map<string, string>();
  for (const value of values) {
    const name = normalizeEntityName(value);
    const key = creatorNameKey(name);
    if (key && !names.has(key)) names.set(key, name);
  }
  return [...names.values()];
}

function isCreatorIdentityConstraintError(error: unknown): boolean {
  return /unique constraint failed: creators\.name_key/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
