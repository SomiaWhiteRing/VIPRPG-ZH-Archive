import { workReadCondition } from "@/app/.server/db/work-visibility";
import type { AppRuntime } from "@/app/.server/runtime";
import { characterNodePath, type CharacterCategory } from "@/lib/character-index";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { auditRecord } from "@/lib/entity-audit";
import type { EntryHistoryNames, entryHistorySnapshots } from "@/lib/entry-history";
import { formatExactTimestamp } from "@/lib/format";

export async function getEntryHistoryNames(
  runtime: AppRuntime,
  user: ArchiveUser,
  edits: ReturnType<typeof entryHistorySnapshots>[],
): Promise<EntryHistoryNames> {
  const workIds = new Set<number>();
  const userIds = new Set<number>();
  const archiveIds = new Set<number>();
  const categoryIds = new Set<string>();
  for (const { before, after } of edits) {
    for (const snapshot of [before, after]) {
      if (!snapshot) continue;
      for (const field of ["workCredits", "relations", "translationRelations", "currentArchives", "memberships", "maintainers"] as const) {
        const values = snapshot[field];
        if (!Array.isArray(values)) continue;
        for (const value of values) {
          if (field === "maintainers" && typeof value === "number") userIds.add(value);
          const row = auditRecord(value);
          if (!row) continue;
          if (field === "currentArchives" && typeof row.id === "number") archiveIds.add(row.id);
          if (typeof row.categoryId === "string") categoryIds.add(row.categoryId);
          for (const key of ["workId", "fromWorkId", "toWorkId"]) {
            if (typeof row[key] === "number") workIds.add(row[key]);
          }
        }
      }
    }
  }
  const db = runtime.db;
  const access = workReadCondition(user);
  const [works, users, archives, categories] = await Promise.all([
    workIds.size ? db.prepare(`SELECT w.id, COALESCE(NULLIF(w.chinese_title,''),w.original_title) AS name
      FROM works w WHERE w.id IN (SELECT value FROM json_each(?)) AND ${access.sql}`)
      .bind(JSON.stringify([...workIds]), ...access.binds).all<{ id: number; name: string }>() : null,
    userIds.size ? db.prepare("SELECT id, display_name AS name FROM users WHERE id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify([...userIds])).all<{ id: number; name: string }>() : null,
    archiveIds.size ? db.prepare("SELECT id, COALESCE(published_at, created_at) AS date FROM archive_versions WHERE id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify([...archiveIds])).all<{ id: number; date: string }>() : null,
    categoryIds.size ? db.prepare(`SELECT id,parent_id AS parentId,label,original_name AS originalName,
      source_url AS sourceUrl,sort_order AS sortOrder FROM character_categories`).all<CharacterCategory>() : null,
  ]);
  return {
    works: new Map(works?.results.map(row => [row.id, row.name])),
    users: new Map(users?.results.map(row => [row.id, row.name])),
    archives: new Map(archives?.results.map(row => [row.id, formatExactTimestamp(row.date)])),
    categories: new Map([...categoryIds].map(id => [id, characterNodePath(categories?.results ?? [], id)])),
  };
}
