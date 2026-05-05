import { getD1 } from "@/lib/server/db/d1";

export type PublicArchiveCounts = {
  works: number;
  creators: number;
  characters: number;
  tags: number;
  series: number;
};

export type RecentWorkSummary = {
  slug: string;
  title: string;
  updatedAt: string;
};

export async function getPublicArchiveCounts(): Promise<PublicArchiveCounts> {
  const [works, creators, characters, tags, series] = await Promise.all([
    countTable("works"),
    countTable("creators"),
    countTable("characters"),
    countTable("tags"),
    countTable("series"),
  ]);

  return { works, creators, characters, tags, series };
}

export async function listRecentlyUpdatedWorks(
  limit = 8,
): Promise<RecentWorkSummary[]> {
  const result = await getD1()
    .prepare(
      `SELECT
         w.slug AS slug,
         COALESCE(w.chinese_title, w.original_title) AS title,
         w.updated_at AS updated_at
       FROM works w
       WHERE w.status = 'published'
       ORDER BY w.updated_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ slug: string; title: string; updated_at: string }>();

  const rows = result.results ?? [];
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title ?? row.slug,
    updatedAt: row.updated_at,
  }));
}

async function countTable(tableName: string): Promise<number> {
  const row = await getD1()
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
