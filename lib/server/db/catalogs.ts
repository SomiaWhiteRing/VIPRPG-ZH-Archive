import { getD1 } from "@/lib/server/db/d1";
import type { ArchiveUser } from "@/lib/server/db/users";
import { HttpError } from "@/lib/server/http/json";

export type CatalogItem = {
  workId: number;
  title: string;
  originalTitle: string;
  chineseTitle: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  language: string;
  previewBlobSha256: string | null;
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
  coverBlobSha256: string | null;
  customCoverBlobSha256: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CatalogDetail = CatalogSummary & {
  ownerProfileShowsCatalogs: boolean;
  items: CatalogItem[];
};
export type CatalogInput = {
  title?: string;
  description?: string | null;
  coverBlobSha256?: string;
};

export async function listCatalogs(): Promise<CatalogSummary[]> {
  const rows = await getD1()
    .prepare(
      `${CATALOG_SUMMARY_SELECT} ORDER BY c.updated_at DESC,c.id DESC LIMIT 200`,
    )
    .all<Row>();
  return (rows.results ?? []).map(mapSummary);
}

export async function searchCatalogsForOwner(input: {
  userId: number;
  page?: number;
  pageSize?: number;
}): Promise<{ items: CatalogSummary[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize ?? 20)));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const database = getD1();
  const [countResult, rowsResult] = await database.batch([
    database
      .prepare(`SELECT COUNT(*) AS count FROM catalogs WHERE owner_user_id=? AND status='published'`)
      .bind(input.userId),
    database
      .prepare(`${CATALOG_SUMMARY_SELECT} AND c.owner_user_id=? ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?`)
      .bind(input.userId, pageSize, (page - 1) * pageSize),
  ]);
  return {
    items: ((rowsResult.results ?? []) as Row[]).map(mapSummary),
    total: Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    page,
    pageSize,
  };
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
  const coverBlobSha256 = input.coverBlobSha256 === undefined
    ? row.cover_blob_sha256
    : await requiredCatalogCover(input.coverBlobSha256);
  await getD1()
    .prepare(
      `UPDATE catalogs
       SET title=?,description=?,cover_blob_sha256=?,updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
    )
    .bind(
      title,
      input.description === undefined ? row.description : clean(input.description),
      coverBlobSha256,
      id,
    )
    .run();
  return requiredCatalog(id);
}

export async function assertCatalogUpdateAllowed(
  id: number,
  actor: ArchiveUser,
): Promise<void> {
  await ownedCatalog(id, actor, "catalog.update_own");
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

export async function updateCatalogItem(
  catalogId: number,
  workId: unknown,
  sortOrder: unknown,
  note: unknown,
  actor: ArchiveUser,
): Promise<CatalogDetail> {
  await ownedCatalog(catalogId, actor, "catalog.reorder_own");
  if (
    typeof workId !== "number" ||
    !Number.isSafeInteger(workId) ||
    workId <= 0
  )
    throw new HttpError(400, "目录条目不合法");
  if (
    typeof sortOrder !== "number" ||
    !Number.isSafeInteger(sortOrder) ||
    sortOrder < 0
  )
    throw new HttpError(400, "目录条目排序值必须是 0 或正整数");
  if (note !== null && note !== undefined && typeof note !== "string")
    throw new HttpError(400, "目录条目备注必须是字符串");
  const database = getD1();
  const results = await database.batch([
    database
      .prepare(
        `UPDATE catalog_items SET sort_order=?,note=? WHERE catalog_id=? AND work_id=?`,
      )
      .bind(sortOrder, clean(note), catalogId, workId),
    database
      .prepare(
        `UPDATE catalogs SET updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND EXISTS (
           SELECT 1 FROM catalog_items WHERE catalog_id=? AND work_id=?
         )`,
      )
      .bind(catalogId, catalogId, workId),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1)
    throw new HttpError(404, "目录条目不存在");
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
      .prepare(`INSERT OR IGNORE INTO catalog_items(catalog_id,work_id,note) VALUES(?,?,?)`)
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
      `SELECT
         ci.work_id,
         w.original_title,
         w.chinese_title,
         w.original_release_date,
         w.engine_family,
         w.language,
         (
           SELECT ma.blob_sha256
           FROM work_media_assets wma
           JOIN media_assets ma ON ma.id = wma.media_asset_id
           WHERE wma.work_id = w.id AND ma.kind = 'preview'
           ORDER BY wma.is_primary DESC, wma.sort_order, wma.media_asset_id
           LIMIT 1
         ) AS preview_blob_sha256,
         ci.sort_order,
         ci.note
       FROM catalog_items ci
       JOIN works w ON w.id = ci.work_id
       WHERE ci.catalog_id = ? AND w.status = 'published'
       ORDER BY ci.sort_order ASC, ci.work_id DESC`,
    )
    .bind(row.id)
    .all<ItemRow>();
  return {
    ...mapSummary(row),
    ownerProfileShowsCatalogs: row.owner_profile_show_catalogs === 1,
    items: (items.results ?? []).map((item) => ({
      workId: item.work_id,
      title: item.chinese_title || item.original_title,
      originalTitle: item.original_title,
      chineseTitle: item.chinese_title,
      originalReleaseDate: item.original_release_date,
      engineFamily: item.engine_family,
      language: item.language,
      previewBlobSha256: item.preview_blob_sha256,
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
  cover_blob_sha256: string | null;
}> {
  const row = await getD1()
    .prepare(
      `SELECT id,owner_user_id,title,description,cover_blob_sha256
       FROM catalogs
       WHERE id=? AND status='published'
       LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: number;
      owner_user_id: number;
      title: string;
      description: string | null;
      cover_blob_sha256: string | null;
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
    coverBlobSha256: row.cover_blob_sha256,
    customCoverBlobSha256: row.custom_cover_blob_sha256,
    createdAt: row.created_at,
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
async function requiredCatalogCover(value: string): Promise<string> {
  const sha256 = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new HttpError(400, "目录封面哈希不合法");
  }
  const blob = await getD1()
    .prepare(
      `SELECT sha256
       FROM blobs
       WHERE sha256=? AND status='active' AND content_type_hint LIKE 'image/%'
       LIMIT 1`,
    )
    .bind(sha256)
    .first<{ sha256: string }>();
  if (!blob) throw new HttpError(400, "目录封面不存在或不是可用图片");
  return blob.sha256;
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
  owner_profile_show_catalogs: number;
  title: string;
  description: string | null;
  item_count: number;
  cover_blob_sha256: string | null;
  custom_cover_blob_sha256: string | null;
  created_at: string;
  updated_at: string;
};
type ItemRow = {
  work_id: number;
  original_title: string;
  chinese_title: string | null;
  original_release_date: string | null;
  engine_family: string;
  language: string;
  preview_blob_sha256: string | null;
  sort_order: number;
  note: string | null;
};

const CATALOG_SUMMARY_SELECT = `
  SELECT
    c.id,
    c.owner_user_id,
    u.display_name AS owner_name,
    u.profile_show_catalogs AS owner_profile_show_catalogs,
    c.title,
    c.description,
    (
      SELECT COUNT(*)
      FROM catalog_items ci
      JOIN works cw ON cw.id = ci.work_id
      WHERE ci.catalog_id = c.id AND cw.status = 'published'
    ) AS item_count,
    c.cover_blob_sha256 AS custom_cover_blob_sha256,
    COALESCE(c.cover_blob_sha256, (
      SELECT ma.blob_sha256
      FROM work_media_assets wma
      JOIN media_assets ma ON ma.id = wma.media_asset_id
      WHERE wma.work_id = (
        SELECT first_item.work_id
        FROM catalog_items first_item
        JOIN works first_work ON first_work.id = first_item.work_id
        WHERE first_item.catalog_id = c.id AND first_work.status = 'published'
        ORDER BY first_item.sort_order ASC, first_item.work_id DESC
        LIMIT 1
      )
        AND ma.kind = 'preview'
      ORDER BY wma.is_primary DESC, wma.sort_order, wma.media_asset_id
      LIMIT 1
    )) AS cover_blob_sha256,
    c.created_at,
    c.updated_at
  FROM catalogs c
  JOIN users u ON u.id = c.owner_user_id
  WHERE c.status = 'published'`;
