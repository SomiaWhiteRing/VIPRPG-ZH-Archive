import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { normalizeEntityName } from "@/lib/entity-name";
import { HttpError } from "@/lib/http";
import { tagNameKey, type CombinedTagSummary, type UserTagSummary, type WorkFavorite, type WorkTagSummary } from "@/lib/user-tags";

export async function listCombinedTags(
  runtime: AppRuntime,
  input: { query?: string; name?: string; limit?: number; source?: "user" } = {},
): Promise<CombinedTagSummary[]> {
  const where: string[] = [];
  const binds: Array<string | number> = [];
  if (input.source === "user") where.push("s.user_count > 0");
  if (input.query?.trim()) {
    where.push("instr(lower(s.name),lower(?)) > 0");
    binds.push(normalizeEntityName(input.query));
  }
  if (input.name) {
    where.push("s.name=? COLLATE NOCASE");
    binds.push(normalizeEntityName(input.name));
  }
  const rows = await getD1(runtime).prepare(
    `SELECT CASE WHEN s.public_count > 0 THEN COALESCE(t.name,s.name) ELSE s.name END AS name,
            s.public_count + s.user_count AS usageCount
     FROM tag_usage_stats s LEFT JOIN tags t ON t.name=s.name
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY (s.public_count + s.user_count) DESC,s.name ASC LIMIT ?`,
  ).bind(...binds, Math.max(1, Math.min(input.limit ?? 120, 300)))
    .all<CombinedTagSummary>();
  return rows.results;
}

export async function listUserTags(
  runtime: AppRuntime,
  input: { userId: number; query?: string; name?: string; limit?: number; includeUnavailable?: boolean },
): Promise<UserTagSummary[]> {
  const where = ["t.user_id=?"];
  if (!input.includeUnavailable) where.push("EXISTS(SELECT 1 FROM public_works WHERE id=t.work_id)");
  const binds: Array<string | number> = [input.userId];
  if (input.query?.trim()) {
    where.push("t.name LIKE ?");
    binds.push(`%${normalizeEntityName(input.query)}%`);
  }
  if (input.name) {
    where.push("t.name=?");
    binds.push(normalizeEntityName(input.name));
  }
  // The primary key makes each work unique within this user's name group.
  const rows = await getD1(runtime).prepare(
    `SELECT MIN(t.name COLLATE BINARY) AS name,COUNT(*) AS workCount
     FROM user_work_tags t
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     GROUP BY t.name ORDER BY workCount DESC,t.name ASC LIMIT ?`,
  ).bind(...binds, Math.max(1, Math.min(input.limit ?? 120, 300))).all<UserTagSummary>();
  return rows.results;
}

export async function listWorkUserTags(runtime: AppRuntime, workId: number): Promise<string[]> {
  const rows = await getD1(runtime).prepare(
    `SELECT MIN(name COLLATE BINARY) AS name FROM counted_user_tags
     WHERE work_id=? GROUP BY name ORDER BY COUNT(*) DESC,name ASC LIMIT 100`,
  ).bind(workId).all<{ name: string }>();
  return rows.results.map((row) => row.name);
}

export async function listWorkTagSummaries(runtime: AppRuntime, workId: number): Promise<WorkTagSummary[]> {
  const rows = await getD1(runtime).prepare(
    `WITH user_counts AS (
       SELECT MIN(name COLLATE BINARY) AS name,COUNT(*) AS usageCount
       FROM counted_user_tags WHERE work_id=? GROUP BY name
     ), user_tags AS (
       SELECT name,usageCount FROM user_counts c
       WHERE NOT EXISTS(SELECT 1 FROM work_tags WHERE work_id=? AND tag_name=c.name COLLATE NOCASE)
       ORDER BY usageCount DESC,name COLLATE NOCASE LIMIT 20
     )
     SELECT t.tag_name AS name,1+COALESCE(c.usageCount,0) AS usageCount,'public' AS source,t.sort_order AS sortOrder
     FROM work_tags t LEFT JOIN user_counts c ON c.name=t.tag_name COLLATE NOCASE WHERE t.work_id=?
     UNION ALL
     SELECT name,usageCount,'user',NULL FROM user_tags
     ORDER BY source,sortOrder,usageCount DESC,name COLLATE NOCASE`,
  ).bind(workId, workId, workId).all<WorkTagSummary>();
  return rows.results.map(({ name, usageCount, source }) => ({ name, usageCount, source }));
}

export async function getWorkFavorite(runtime: AppRuntime, workId: number, userId: number): Promise<WorkFavorite> {
  const database = getD1(runtime);
  const row = await database.prepare(
    `SELECT e.favorited_at IS NOT NULL AS favorited,COALESCE(e.favorite_note,'') AS note
     FROM public_works w LEFT JOIN user_work_entries e ON e.work_id=w.id AND e.user_id=?
     WHERE w.id=?`,
  ).bind(userId, workId).first<{ favorited: number; note: string }>();
  if (!row) throw new HttpError(404, "作品不存在");
  const [ownTags, publicTags, userTags, frequentTags] = await Promise.all([
    database.prepare("SELECT name FROM user_work_tags WHERE work_id=? AND user_id=? ORDER BY sort_order,name")
      .bind(workId, userId).all<{ name: string }>(),
    database.prepare("SELECT tag_name AS name FROM work_tags WHERE work_id=? ORDER BY sort_order,tag_name")
      .bind(workId).all<{ name: string }>(),
    listWorkUserTags(runtime, workId),
    listUserTags(runtime, { userId, limit: 60, includeUnavailable: true }),
  ]);
  const workTags = new Map<string, string>();
  for (const name of [...publicTags.results.map((tag) => tag.name), ...userTags]) {
    if (!workTags.has(tagNameKey(name))) workTags.set(tagNameKey(name), name);
  }
  return {
    favorited: row.favorited === 1,
    note: row.note,
    tags: ownTags.results.map((tag) => tag.name),
    workTags: [...workTags.values()],
    frequentTags,
  };
}

export async function listFavoriteWorkIds(runtime: AppRuntime, userId: number, workIds: number[]): Promise<number[]> {
  if (!workIds.length) return [];
  const rows = await getD1(runtime).prepare(
    `SELECT work_id FROM user_work_entries WHERE user_id=? AND favorited_at IS NOT NULL
     AND work_id IN (SELECT value FROM json_each(?))`,
  ).bind(userId, JSON.stringify(workIds)).all<{ work_id: number }>();
  return rows.results.map((row) => row.work_id);
}

export async function listUnavailableFavorites(runtime: AppRuntime, userId: number, requestedPage: number) {
  const database = getD1(runtime);
  const where = `user_id=? AND favorited_at IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public_works WHERE id=user_work_entries.work_id)`;
  const count = await database.prepare(`SELECT COUNT(*) AS total FROM user_work_entries WHERE ${where}`)
    .bind(userId).first<{ total: number }>();
  const total = count?.total ?? 0;
  const pageSize = 20;
  const page = Math.min(Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    Math.max(1, Math.ceil(total / pageSize)));
  // IDs alone let the owner remove references without revealing hidden work metadata.
  const rows = await database.prepare(`SELECT work_id AS workId FROM user_work_entries WHERE ${where}
    ORDER BY favorited_at DESC,work_id DESC LIMIT ? OFFSET ?`)
    .bind(userId, pageSize, (page - 1) * pageSize).all<{ workId: number }>();
  return { items: rows.results, total, page, pageSize };
}
