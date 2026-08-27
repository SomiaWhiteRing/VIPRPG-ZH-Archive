import { getD1 } from "@/lib/server/db/d1";
import type { ArchiveUser } from "@/lib/server/db/users";
import { HttpError } from "@/lib/server/http/json";
import { slugify } from "@/lib/slug";

export type CatalogItem = {
  workId: number;
  slug: string;
  title: string;
  sortOrder: number;
  note: string | null;
};
export type CatalogSummary = {
  id: number;
  ownerUserId: number;
  ownerName: string;
  slug: string;
  title: string;
  description: string | null;
  itemCount: number;
  updatedAt: string;
};
export type CatalogDetail = CatalogSummary & { items: CatalogItem[] };
export type CatalogInput = {
  title?: string;
  description?: string | null;
  slug?: string | null;
};

export async function listCatalogs(): Promise<CatalogSummary[]> {
  const rows = await getD1()
    .prepare(
      `${CATALOG_SUMMARY_SELECT} ORDER BY c.updated_at DESC,c.id DESC LIMIT 200`,
    )
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
      `${CATALOG_SUMMARY_SELECT} AND (c.title LIKE ? OR c.slug LIKE ? OR c.description LIKE ?) ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`,
    )
    .bind(like, like, like, Math.max(1, Math.min(300, limit)))
    .all<Row>();
  return (rows.results ?? []).map(mapSummary);
}

export async function getCatalogBySlug(
  slug: string,
): Promise<CatalogDetail | null> {
  return loadCatalogDetail("c.slug=?", slug);
}

export async function createCatalog(
  input: CatalogInput,
  actor: ArchiveUser,
): Promise<CatalogDetail> {
  assertPermission(actor, "catalog.create");
  const title = requiredTitle(input.title ?? "");
  const slugInput = optionalText(input.slug, "目录 slug");
  const slug = await uniqueSlug(slugInput || slugify(title, "catalog"));
  let result: { meta: { last_row_id?: number } };
  try {
    result = await getD1()
      .prepare(
        `INSERT INTO catalogs(owner_user_id,slug,title,description) VALUES(?,?,?,?)`,
      )
      .bind(actor.id, slug, title, clean(input.description))
      .run();
  } catch (error) {
    if (isConstraintError(error)) throw new HttpError(409, "目录 slug 已存在");
    throw error;
  }
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
  const slugInput = optionalText(input.slug, "目录 slug");
  const slug =
    slugInput && slugInput !== row.slug
      ? await uniqueSlug(slugInput, id)
      : row.slug;
  try {
    await getD1()
      .prepare(
        `UPDATE catalogs SET slug=?,title=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .bind(
        slug,
        title,
        input.description === undefined
          ? row.description
          : clean(input.description),
        id,
      )
      .run();
  } catch (error) {
    if (isConstraintError(error)) throw new HttpError(409, "目录 slug 已存在");
    throw error;
  }
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
  items: Array<{ workId: number; note?: string | null }>,
  actor: ArchiveUser,
): Promise<CatalogDetail> {
  await ownedCatalog(catalogId, actor, "catalog.reorder_own");
  if (!Array.isArray(items)) throw new HttpError(400, "目录项目顺序不合法");
  const seen = new Set<number>();
  const normalized = items.map((item, index) => {
    if (
      !item ||
      typeof item !== "object" ||
      !Number.isSafeInteger(item.workId) ||
      item.workId <= 0 ||
      seen.has(item.workId)
    )
      throw new HttpError(400, "目录项目顺序不合法");
    seen.add(item.workId);
    return { workId: item.workId, sortOrder: index, note: clean(item.note) };
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

async function getCatalogById(id: number): Promise<CatalogDetail | null> {
  return loadCatalogDetail("c.id=?", id);
}

async function loadCatalogDetail(
  predicate: "c.slug=?" | "c.id=?",
  value: string | number,
): Promise<CatalogDetail | null> {
  const row = await getD1()
    .prepare(
      `${CATALOG_SUMMARY_SELECT} AND ${predicate} LIMIT 1`,
    )
    .bind(value)
    .first<Row>();
  if (!row) return null;
  const items = await getD1()
    .prepare(
      `SELECT ci.work_id,w.slug,COALESCE(w.chinese_title,w.original_title) AS title,ci.sort_order,ci.note FROM catalog_items ci JOIN works w ON w.id=ci.work_id WHERE ci.catalog_id=? AND w.status='published' ORDER BY ci.sort_order,ci.work_id`,
    )
    .bind(row.id)
    .all<ItemRow>();
  return {
    ...mapSummary(row),
    items: (items.results ?? []).map((item) => ({
      workId: item.work_id,
      slug: item.slug,
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
  slug: string;
  title: string;
  description: string | null;
}> {
  const row = await getD1()
    .prepare(
      `SELECT id,owner_user_id,slug,title,description FROM catalogs WHERE id=? AND status='published' LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: number;
      owner_user_id: number;
      slug: string;
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
async function uniqueSlug(base: string, ignoreId?: number): Promise<string> {
  const normalized = slugify(base, "catalog");
  let value = normalized;
  let suffix = 2;
  while (
    await getD1()
      .prepare(`SELECT 1 FROM catalogs WHERE slug=? AND id<>? LIMIT 1`)
      .bind(value, ignoreId ?? 0)
      .first()
  ) {
    value = `${normalized}-${suffix++}`;
  }
  return value;
}
function mapSummary(row: Row): CatalogSummary {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    slug: row.slug,
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
function optionalText(value: string | null | undefined, label: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string")
    throw new HttpError(400, `${label}必须是字符串`);
  return value.trim();
}
function isConstraintError(error: unknown): boolean {
  return /constraint|unique|already exists/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
type Row = {
  id: number;
  owner_user_id: number;
  owner_name: string;
  slug: string;
  title: string;
  description: string | null;
  item_count: number;
  updated_at: string;
};
type ItemRow = {
  work_id: number;
  slug: string;
  title: string;
  sort_order: number;
  note: string | null;
};

const CATALOG_SUMMARY_SELECT = `SELECT c.id,c.owner_user_id,u.display_name AS owner_name,c.slug,c.title,c.description,(SELECT COUNT(*) FROM catalog_items ci JOIN works cw ON cw.id=ci.work_id WHERE ci.catalog_id=c.id AND cw.status='published') AS item_count,c.updated_at FROM catalogs c JOIN users u ON u.id=c.owner_user_id WHERE c.status='published'`;
