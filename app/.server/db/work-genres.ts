import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError } from "@/lib/http";

export type WorkGenre = { id: number; name: string; group_id: number; public_count: number };

export async function suggestWorkGenres(runtime: AppRuntime, query: string) {
  const prefix = query.replace(/[\\%_]/g, (value) => `\\${value}`) + "%";
  const order = query ? "name COLLATE NOCASE" : "public_count DESC, name COLLATE NOCASE, name";
  const result = await getD1(runtime).prepare(
    `SELECT name FROM work_genres WHERE public_count > 0
     AND name LIKE ? ESCAPE '\\' ORDER BY ${order} LIMIT 12`,
  ).bind(prefix).all<{ name: string }>();
  return result.results.map((row) => row.name);
}

export async function listWorkGenres(runtime: AppRuntime, query: string, page: number) {
  const database = getD1(runtime);
  const pattern = query.replace(/[\\%_]/g, (value) => `\\${value}`) + "%";
  const [count, rows] = await database.batch([
    database.prepare("SELECT COUNT(*) AS count FROM work_genres WHERE name LIKE ? ESCAPE '\\'").bind(pattern),
    database.prepare(`SELECT id,name,group_id,public_count FROM work_genres
      WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 50 OFFSET ?`).bind(pattern, (page - 1) * 50),
  ]);
  return { total: Number((count.results[0] as { count: number } | undefined)?.count ?? 0), items: rows.results as WorkGenre[] };
}

export async function getWorkGenreGroup(runtime: AppRuntime, name: string) {
  const result = await getD1(runtime).prepare(
    `SELECT id,name,group_id,public_count FROM work_genres
     WHERE group_id=(SELECT group_id FROM work_genres WHERE name=?) ORDER BY id`,
  ).bind(name).all<WorkGenre>();
  return result.results;
}

export async function mergeWorkGenreGroups(runtime: AppRuntime, input: {
  sourceGroup: number;
  targetGroup: number;
  sourceSnapshot: string;
  targetSnapshot: string;
  userId: number;
}) {
  if (input.sourceGroup === input.targetGroup || !input.sourceSnapshot || !input.targetSnapshot) {
    throw new HttpError(400, "请选择两个不同的类型组。");
  }
  const database = getD1(runtime);
  try {
    await database.batch([
      // A failed preview comparison aborts the entire D1 batch, including the audit.
      database.prepare(`SELECT CASE WHEN
        (SELECT group_concat(id, ',') FROM (SELECT id FROM work_genres WHERE group_id=? ORDER BY id))=?
        AND (SELECT group_concat(id, ',') FROM (SELECT id FROM work_genres WHERE group_id=? ORDER BY id))=?
        THEN 1 ELSE json('genre_merge_stale') END`)
        .bind(input.sourceGroup, input.sourceSnapshot, input.targetGroup, input.targetSnapshot),
      database.prepare("UPDATE work_genres SET group_id=? WHERE group_id=?")
        .bind(input.targetGroup, input.sourceGroup),
      database.prepare(`INSERT INTO auth_audit_logs(user_id,event_type,detail_json)
        VALUES(?,'admin_genre_merge',?)`).bind(input.userId, JSON.stringify(input)),
    ]);
  } catch (error) {
    if (/malformed JSON/i.test(String(error))) {
      throw new HttpError(409, "类型组已变化，请重新预览后再合并。");
    }
    throw error;
  }
}
