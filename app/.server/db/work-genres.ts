import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError } from "@/lib/http";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { auditedEntityBatch } from "@/app/.server/db/entity-audit";

export type WorkGenre = { id: number; name: string; group_id: number; public_count: number };
export type WorkGenreGroup = { id: number; members: WorkGenre[]; publicCount: number };

export async function suggestWorkGenres(runtime: AppRuntime, query: string) {
  const prefix = query.replace(/[\\%_]/g, (value) => `\\${value}`) + "%";
  const order = query ? "name COLLATE NOCASE" : "public_count DESC, name COLLATE NOCASE, name";
  const result = await getD1(runtime).prepare(
    `SELECT name FROM work_genres WHERE public_count > 0
     AND name LIKE ? ESCAPE '\\' ORDER BY ${order} LIMIT 12`,
  ).bind(prefix).all<{ name: string }>();
  return result.results.map((row) => row.name);
}

export async function listWorkGenreGroups(runtime: AppRuntime, query: string, page: number) {
  const database = getD1(runtime);
  const pattern = query.replace(/[\\%_]/g, (value) => `\\${value}`) + "%";
  const [count, rows] = await database.batch([
    database.prepare("SELECT COUNT(DISTINCT group_id) AS count FROM work_genres WHERE name LIKE ? ESCAPE '\\'").bind(pattern),
    database.prepare(`WITH selected_groups AS (
      SELECT group_id, SUM(public_count) AS public_count, MIN(name) AS sort_name
      FROM work_genres WHERE group_id IN (
        SELECT group_id FROM work_genres WHERE name LIKE ? ESCAPE '\\'
      )
      GROUP BY group_id ORDER BY public_count DESC, sort_name, group_id LIMIT 50 OFFSET ?
    )
    SELECT g.id,g.name,g.group_id,g.public_count FROM selected_groups s
    JOIN work_genres g ON g.group_id=s.group_id
    ORDER BY s.public_count DESC,s.sort_name,s.group_id,g.public_count DESC,g.name,g.id`)
      .bind(pattern, (page - 1) * 50),
  ]);
  const groups = new Map<number, WorkGenreGroup>();
  for (const member of rows.results as WorkGenre[]) {
    let group = groups.get(member.group_id);
    if (!group) {
      group = { id: member.group_id, members: [], publicCount: 0 };
      groups.set(member.group_id, group);
    }
    group.members.push(member);
    group.publicCount += member.public_count;
  }
  return { total: Number((count.results[0] as { count: number } | undefined)?.count ?? 0), items: [...groups.values()] };
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
  actor: ArchiveUser;
}) {
  if (input.sourceGroup === input.targetGroup || !input.sourceSnapshot || !input.targetSnapshot) {
    throw new HttpError(400, "请选择两个不同的类型组。");
  }
  const database = getD1(runtime);
  try {
    await auditedEntityBatch(database, [
      // A failed preview comparison aborts the entire D1 batch, including the audit.
      database.prepare(`SELECT CASE WHEN
        (SELECT group_concat(id, ',') FROM (SELECT id FROM work_genres WHERE group_id=? ORDER BY id))=?
        AND (SELECT group_concat(id, ',') FROM (SELECT id FROM work_genres WHERE group_id=? ORDER BY id))=?
        THEN 1 ELSE json('genre_merge_stale') END`)
        .bind(input.sourceGroup, input.sourceSnapshot, input.targetGroup, input.targetSnapshot),
      database.prepare("UPDATE work_genres SET group_id=? WHERE group_id=?")
        .bind(input.targetGroup, input.sourceGroup),
    ], {
      actor: input.actor, eventType: "admin_genre_merge", source: "admin", operation: "merge", permission: "genre.manage",
      targets: [{ type: "genre_group", id: input.sourceGroup }, { type: "genre_group", id: input.targetGroup }],
      snapshot: { sql: `SELECT json_group_array(json_object('id',id,'name',name,'groupId',group_id))
        FROM (SELECT id,name,group_id FROM work_genres WHERE group_id IN (?,?) ORDER BY id)`,
        binds: [input.sourceGroup, input.targetGroup] },
      context: { sourceGroup: input.sourceGroup, targetGroup: input.targetGroup },
    });
  } catch (error) {
    if (/malformed JSON/i.test(String(error))) {
      throw new HttpError(409, "类型组已变化，请重新预览后再合并。");
    }
    throw error;
  }
}
