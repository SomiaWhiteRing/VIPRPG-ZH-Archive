import { hasPermission } from "@/lib/authz/permissions";
import type { ArchiveUser } from "@/lib/server/db/users";
import { getD1 } from "@/lib/server/db/d1";
import { HttpError } from "@/lib/server/http/json";

export type AdminArchiveVersion = {
  id: number;
  workId: number;
  workTitle: string;
  language: string;
  status: "processing" | "published" | "hidden" | "deleted";
  isCurrent: boolean;
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  createdAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  uploaderId: number | null;
  uploaderName: string | null;
};
type Row = {
  id: number;
  work_id: number;
  work_title: string;
  language: string;
  status: "processing" | "published" | "hidden" | "deleted";
  is_current: number;
  total_files: number;
  total_size_bytes: number;
  estimated_r2_get_count: number;
  created_at: string;
  published_at: string | null;
  deleted_at: string | null;
  purged_at: string | null;
  uploader_id: number | null;
  uploader_name: string | null;
};
type IdentityRow = {
  id: number;
  work_id: number;
  status: string;
  is_current: number;
  purged_at: string | null;
  uploader_id: number | null;
};
type Filter = "all" | "active" | "trash";
type AdminArchiveSearchInput = {
  actor: ArchiveUser;
  filter?: Filter;
  query?: string;
  status?: string;
  sort?: "default" | "size";
  page?: number;
  pageSize?: number;
};
export type PaginatedAdminArchiveVersions = {
  items: AdminArchiveVersion[];
  total: number;
  page: number;
  pageSize: number;
};

export async function searchArchiveVersionsForAdmin(
  input: AdminArchiveSearchInput,
): Promise<PaginatedAdminArchiveVersions> {
  const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const { clauses, binds } = archiveClauses(input.actor, input.filter ?? "all", input.query, input.status);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = input.sort === "size"
    ? "av.total_size_bytes DESC, av.id DESC"
    : "av.created_at DESC, av.id DESC";
  const database = getD1();
  const [rowsResult, countResult] = await database.batch([
    database.prepare(
      `${archiveSelect()} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ).bind(...binds, pageSize, (page - 1) * pageSize),
    database.prepare(
      `SELECT COUNT(*) AS count FROM archive_versions av JOIN works w ON w.id=av.work_id ${where}`,
    ).bind(...binds),
  ]);
  return {
    items: ((rowsResult.results ?? []) as Row[]).map(mapRow),
    total: Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0),
    page,
    pageSize,
  };
}

export async function listArchiveVersionsForAdmin(
  limit = 100,
  filter: Filter = "all",
  actor: ArchiveUser,
): Promise<AdminArchiveVersion[]> {
  const { clauses, binds } = archiveClauses(actor, filter);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await getD1()
    .prepare(
      `${archiveSelect()} ${where}
       ORDER BY av.created_at DESC, av.id DESC
       LIMIT ?`,
    )
    .bind(...binds, Math.max(1, Math.min(300, limit)))
    .all<Row>();
  return (rows.results ?? []).map(mapRow);
}

function archiveClauses(actor: ArchiveUser, filter: Filter, query?: string, status?: string) {
  const clauses: string[] = [];
  const binds: Array<string | number> = [];
  if (filter === "active") clauses.push("av.status <> 'deleted'");
  if (filter === "trash") clauses.push("av.status='deleted'");
  if (status && status !== "all") {
    clauses.push("av.status=?");
    binds.push(status);
  }
  if (query?.trim()) {
    const value = `%${query.trim()}%`;
    clauses.push("(COALESCE(w.chinese_title,w.original_title) LIKE ? OR CAST(av.id AS TEXT) LIKE ?)");
    binds.push(value, value);
  }
  const canReadAny =
    hasPermission(actor, "archive_version.read_private") ||
    hasPermission(actor, "archive_version.update") ||
    hasPermission(actor, "archive_version.delete_any") ||
    hasPermission(actor, "archive_version.restore") ||
    hasPermission(actor, "archive_version.set_current");
  if (!canReadAny) {
    clauses.push("av.uploader_id=?");
    binds.push(actor.id);
  }
  return { clauses, binds };
}

function archiveSelect(): string {
  return `SELECT av.id,
      av.work_id,
      COALESCE(w.chinese_title, w.original_title) AS work_title,
      w.language,
      av.status,
      av.is_current,
      av.total_files,
      av.total_size_bytes,
      av.estimated_r2_get_count,
      av.created_at,
      av.published_at,
      av.deleted_at,
      av.purged_at,
      av.uploader_id,
      u.display_name AS uploader_name
    FROM archive_versions av
    JOIN works w ON w.id = av.work_id
    LEFT JOIN users u ON u.id = av.uploader_id`;
}
export function canDeleteArchiveVersion(
  actor: ArchiveUser,
  uploaderId: number | null,
): boolean {
  return (
    hasPermission(actor, "archive_version.delete_any") ||
    (hasPermission(actor, "archive_version.delete_own") &&
      uploaderId === actor.id)
  );
}
export async function moveArchiveVersionToTrash(
  id: number,
  actor?: ArchiveUser,
): Promise<AdminArchiveVersion> {
  const row = await identity(id);
  if (!row) throw new HttpError(404, "ArchiveVersion 不存在");
  if (actor && !canDeleteArchiveVersion(actor, row.uploader_id))
    throw new HttpError(404, "ArchiveVersion 不存在");
  await getD1()
    .prepare(
      `UPDATE archive_versions SET status='deleted',is_current=0,deleted_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(id)
    .run();
  await ensureCurrent(row.work_id);
  return required(id);
}
export async function restoreArchiveVersion(
  id: number,
): Promise<AdminArchiveVersion> {
  const row = await identity(id);
  if (!row) throw new Error("ArchiveVersion 不存在");
  if (row.purged_at) throw new Error("ArchiveVersion 已最终清理，不能还原");
  await getD1()
    .prepare(
      `UPDATE archive_versions SET status='published',deleted_at=NULL,published_at=COALESCE(published_at,CURRENT_TIMESTAMP),is_current=0 WHERE id=? AND status='deleted' AND purged_at IS NULL`,
    )
    .bind(id)
    .run();
  await ensureCurrent(row.work_id);
  return required(id);
}
export async function setCurrentArchiveVersion(
  id: number,
): Promise<AdminArchiveVersion> {
  const row = await identity(id);
  if (!row || row.status !== "published" || row.purged_at)
    throw new Error("只能把未清理的 published ArchiveVersion 设为当前版本");
  await getD1().batch([
    getD1()
      .prepare(
        `UPDATE archive_versions SET is_current=0 WHERE work_id=? AND status='published'`,
      )
      .bind(row.work_id),
    getD1()
      .prepare(
        `UPDATE archive_versions SET is_current=1 WHERE id=? AND work_id=? AND status='published' AND purged_at IS NULL`,
      )
      .bind(id, row.work_id),
  ]);
  return required(id);
}
export async function ensureCurrentArchiveVersion(
  workId: number,
): Promise<void> {
  const current = await getD1()
    .prepare(
      `SELECT id FROM archive_versions WHERE work_id=? AND status='published' AND is_current=1 LIMIT 1`,
    )
    .bind(workId)
    .first();
  if (current) return;
  const replacement = await getD1()
    .prepare(
      `SELECT id FROM archive_versions WHERE work_id=? AND status='published' ORDER BY COALESCE(published_at,created_at) DESC,id DESC LIMIT 1`,
    )
    .bind(workId)
    .first<{ id: number }>();
  if (replacement) await setCurrentArchiveVersion(replacement.id);
}
const ensureCurrent = ensureCurrentArchiveVersion;
async function identity(id: number): Promise<IdentityRow | null> {
  return getD1()
    .prepare(
      `SELECT id,work_id,status,is_current,purged_at,uploader_id FROM archive_versions WHERE id=? LIMIT 1`,
    )
    .bind(id)
    .first<IdentityRow>();
}
async function required(id: number): Promise<AdminArchiveVersion> {
  const row = await getD1()
    .prepare(
      `SELECT av.id,
          av.work_id,
          COALESCE(w.chinese_title, w.original_title) AS work_title,
          w.language,
          av.status,
          av.is_current,
          av.total_files,
          av.total_size_bytes,
          av.estimated_r2_get_count,
          av.created_at,
          av.published_at,
          av.deleted_at,
          av.purged_at,
          av.uploader_id,
          u.display_name AS uploader_name
       FROM archive_versions av
       JOIN works w ON w.id = av.work_id
       LEFT JOIN users u ON u.id = av.uploader_id
       WHERE av.id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<Row>();
  if (!row) throw new Error("ArchiveVersion 不存在");
  return mapRow(row);
}
function mapRow(row: Row): AdminArchiveVersion {
  return {
    id: row.id,
    workId: row.work_id,
    workTitle: row.work_title,
    language: row.language,
    status: row.status,
    isCurrent: row.is_current === 1,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
    estimatedR2GetCount: row.estimated_r2_get_count,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    deletedAt: row.deleted_at,
    purgedAt: row.purged_at,
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_name,
  };
}
