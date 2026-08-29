import { getD1 } from "@/lib/server/db/d1";
import type { ArchiveUser } from "@/lib/server/db/users";
import { HttpError } from "@/lib/server/http/json";

export type CatalogItem = {
  workId: number;
  title: string;
  sortOrder: number;
  note: string | null;
};
export type CatalogSummary = {
  id: number;
  ownerUserId: number;
  ownerName: string;
  title: string;
  description: string | null;
  itemCount: number;
  updatedAt: string;
};
export type CatalogDetail = CatalogSummary & { items: CatalogItem[] };
export type CatalogInput = {
  title?: string;
  description?: string | null;
};

export async function listCatalogs(): Promise<CatalogSummary[]> {
  const rows = await getD1()
    .prepare(
      `${CATALOG_SUMMARY_SELECT} ORDER BY c.updated_at DESC,c.id DESC LIMIT 200`,
    )
    .all<Row>();
  return (rows.results ?? []).map(mapSummary);
}

export async function listCatalogsContainingWork(
  workId: number,
): Promise<CatalogSummary[]> {
  const rows = await getD1()
    .prepare(
      `${CATALOG_SUMMARY_SELECT}
       AND EXISTS (
         SELECT 1 FROM catalog_items ci
         WHERE ci.catalog_id = c.id AND ci.work_id = ?
       )
       ORDER BY c.updated_at DESC,c.id DESC LIMIT 200`,
    )
    .bind(workId)
    .all<Row>();
  return (rows.results ?? []).map(mapSummary);
}

export async function searchCatalogs(
  query: string,
  limit = 300,
): Promise<CatalogSummary[]> {
  const like = `%${query.trim()}%`;
  const rows = await getD1()
    .prepare(
      `${CATALOG_SUMMARY_SELECT} AND (c.title LIKE ? OR c.description LIKE ?) ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`,
    )
    .bind(like, like, Math.max(1, Math.min(300, limit)))
    .all<Row>();
  return (rows.results ?? []).map(mapSummary);
}

export async function getCatalogById(
  id: number,
): Promise<CatalogDetail | null> {
  return loadCatalogDetail(id);
}

export async function createCatalog(
  input: CatalogInput,
  actor: ArchiveUser,
): Promise<CatalogDetail> {
  assertPermission(actor, "catalog.create");
  const title = requiredTitle(input.title ?? "");
  const result = await getD1()
    .prepare(
      `INSERT INTO catalogs(owner_user_id,title,description) VALUES(?,?,?)`,
    )
    .bind(actor.id, title, clean(input.description))
    .run();
  if (!Number.isSafeInteger(result.meta.last_row_id))
    throw new Error("目录未创建");
  const detail = await getCatalogById(Number(result.meta.last_row_id));
  if (!detail) throw new Error("目录创建后不可读取");
  return detail;
}

export async function updateCatalog(
  id: number,
  input: CatalogInput,
  actor: ArchiveUser,
): Promise<CatalogDetail> {
  const row = await ownedCatalog(id, actor, "catalog.update_own");
  const title = requiredTitle(input.title ?? row.title);
  await getD1()
    .prepare(
      `UPDATE catalogs SET title=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(
      title,
      input.description === undefined ? row.description : clean(input.description),
      id,
    )
    .run();
  return requiredCatalog(id);
}

export async function deleteCatalog(
  id: number,
  actor: ArchiveUser,
): Promise<void> {
  await ownedCatalog(id, actor, "catalog.delete_own");
  await getD1()
    .prepare(
      `UPDATE catalogs SET status='deleted',updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(id)
    .run();
}

export async function replaceCatalogItems(
  catalogId: number,
  items: Array<{ workId: number; sortOrder: number; note?: string | null }>,
  actor: ArchiveUser,
): Promise<CatalogDetail> {
  await ownedCatalog(catalogId, actor, "catalog.reorder_own");
  if (!Array.isArray(items)) throw new HttpError(400, "目录项目顺序不合法");
  const seen = new Set<number>();
  const normalized = items.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !Number.isSafeInteger(item.workId) ||
      item.workId <= 0 ||
      !Number.isSafeInteger(item.sortOrder) ||
      seen.has(item.workId)
    )
      throw new HttpError(400, "目录项目顺序不合法");
    seen.add(item.workId);
    return { workId: item.workId, sortOrder: item.sortOrder, note: clean(item.note) };
  });
  if (normalized.length) {
    const rows = await getD1()
      .prepare(
        `SELECT id FROM works WHERE id IN (${normalized.map(() => "?").join(",")}) AND status='published'`,
      )
      .bind(...normalized.map((item) => item.workId))
      .all<{ id: number }>();
    if ((rows.results ?? []).length !== normalized.length)
      throw new HttpError(400, "目录只能收录已发布游戏");
  }
  const database = getD1();
  const statements = [
    database
      .prepare(`DELETE FROM catalog_items WHERE catalog_id=?`)
      .bind(catalogId),
    ...normalized.map((item) =>
      database
        .prepare(
          `INSERT INTO catalog_items(catalog_id,work_id,sort_order,note) VALUES(?,?,?,?)`,
        )
        .bind(catalogId, item.workId, item.sortOrder, item.note),
    ),
    database
      .prepare(`UPDATE catalogs SET updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(catalogId),
  ];
  await database.batch(statements);
  return requiredCatalog(catalogId);
}

export async function addCatalogItem(
  catalogId: number,
  workId: number,
  note: string | null | undefined,
  actor: ArchiveUser,
): Promise<CatalogDetail> {
  await ownedCatalog(catalogId, actor, "catalog.reorder_own");
  if (!Number.isSafeInteger(workId) || workId <= 0)
    throw new HttpError(400, "目录项目不合法");
  const work = await getD1()
    .prepare(`SELECT id FROM works WHERE id=? AND status='published' LIMIT 1`)
    .bind(workId)
    .first<{ id: number }>();
  if (!work) throw new HttpError(400, "目录只能收录已发布游戏");
  await getD1().batch([
    getD1()
      .prepare(`INSERT OR IGNORE INTO catalog_items(catalog_id,work_id,sort_order,note) VALUES(?,?,0,?)`)
      .bind(catalogId, workId, clean(note)),
    getD1()
      .prepare(`UPDATE catalogs SET updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(catalogId),
  ]);
  return requiredCatalog(catalogId);
}

export async function removeCatalogItem(
  catalogId: number,
  workId: number,
  actor: ArchiveUser,
): Promise<CatalogDetail> {
  await ownedCatalog(catalogId, actor, "catalog.reorder_own");
  if (!Number.isSafeInteger(workId) || workId <= 0)
    throw new HttpError(400, "目录项目不合法");
  await getD1().batch([
    getD1()
      .prepare(`DELETE FROM catalog_items WHERE catalog_id=? AND work_id=?`)
      .bind(catalogId, workId),
    getD1()
      .prepare(`UPDATE catalogs SET updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(catalogId),
  ]);
  return requiredCatalog(catalogId);
}

async function loadCatalogDetail(id: number): Promise<CatalogDetail | null> {
  const row = await getD1()
    .prepare(`${CATALOG_SUMMARY_SELECT} AND c.id=? LIMIT 1`)
    .bind(id)
    .first<Row>();
  if (!row) return null;
  const items = await getD1()
    .prepare(
      `SELECT ci.work_id,COALESCE(w.chinese_title,w.original_title) AS title,ci.sort_order,ci.note FROM catalog_items ci JOIN works w ON w.id=ci.work_id WHERE ci.catalog_id=? AND w.status='published' ORDER BY ci.sort_order,ci.work_id`,
    )
    .bind(row.id)
    .all<ItemRow>();
  return {
    ...mapSummary(row),
    items: (items.results ?? []).map((item) => ({
      workId: item.work_id,
      title: item.title,
      sortOrder: item.sort_order,
      note: item.note,
    })),
  };
}
async function requiredCatalog(id: number): Promise<CatalogDetail> {
  const catalog = await getCatalogById(id);
  if (!catalog) throw new HttpError(404, "目录不存在");
  return catalog;
}
async function ownedCatalog(
  id: number,
  actor: ArchiveUser,
  ownPermission:
    "catalog.update_own" | "catalog.delete_own" | "catalog.reorder_own",
): Promise<{
  id: number;
  owner_user_id: number;
  title: string;
  description: string | null;
}> {
  const row = await getD1()
    .prepare(
      `SELECT id,owner_user_id,title,description FROM catalogs WHERE id=? AND status='published' LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: number;
      owner_user_id: number;
      title: string;
      description: string | null;
    }>();
  if (!row) throw new HttpError(404, "目录不存在");
  if (actor.permissionKeys.includes("catalog.manage_any")) return row;
  if (
    !actor.permissionKeys.includes(ownPermission) ||
    row.owner_user_id !== actor.id
  )
    throw new HttpError(403, "无权操作此目录");
  return row;
}
function assertPermission(actor: ArchiveUser, key: "catalog.create"): void {
  if (
    !actor.permissionKeys.includes(key) &&
    !actor.permissionKeys.includes("catalog.manage_any")
  )
    throw new HttpError(403, "无权操作目录");
}
function mapSummary(row: Row): CatalogSummary {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    title: row.title,
    description: row.description,
    itemCount: row.item_count,
    updatedAt: row.updated_at,
  };
}
function requiredTitle(value: string): string {
  if (typeof value !== "string")
    throw new HttpError(400, "目录标题必须是字符串");
  const title = value.trim();
  if (!title) throw new HttpError(400, "目录标题不能为空");
  return title.slice(0, 200);
}
function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new HttpError(400, "目录说明必须是字符串");
  const result = value.trim();
  return result || null;
}
type Row = {
  id: number;
  owner_user_id: number;
  owner_name: string;
  title: string;
  description: string | null;
  item_count: number;
  updated_at: string;
};
type ItemRow = {
  work_id: number;
  title: string;
  sort_order: number;
  note: string | null;
};

const CATALOG_SUMMARY_SELECT = `SELECT c.id,c.owner_user_id,u.display_name AS owner_name,c.title,c.description,(SELECT COUNT(*) FROM catalog_items ci JOIN works cw ON cw.id=ci.work_id WHERE ci.catalog_id=c.id AND cw.status='published') AS item_count,c.updated_at FROM catalogs c JOIN users u ON u.id=c.owner_user_id WHERE c.status='published'`;
