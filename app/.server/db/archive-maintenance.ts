import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { canDeleteArchiveVersion } from "@/lib/authz/archive-permissions";
import { hasPermission } from "@/lib/authz/permissions";
import type {
  AdminArchiveVersion,
  PaginatedAdminArchiveVersions,
} from "@/lib/dto/db/archive-maintenance";
import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";
import { isArchiveEngineFamily } from "@/lib/labels";

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
  maintainer_ids: string | null;
  work_status: string;
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

export async function searchArchiveVersionsForAdmin(
  runtime: AppRuntime,
  input: AdminArchiveSearchInput,
): Promise<PaginatedAdminArchiveVersions> {
  const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const { clauses, binds } = archiveClauses(
    input.actor,
    input.filter ?? "all",
    input.query,
    input.status,
  );
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order =
    input.sort === "size"
      ? "av.total_size_bytes DESC, av.id DESC"
      : "av.created_at DESC, av.id DESC";
  const database = getD1(runtime);
  const [rowsResult, countResult] = await database.batch([
    database
      .prepare(`${archiveSelect()} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...binds, pageSize, (page - 1) * pageSize),
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM archive_versions av JOIN works w ON w.id=av.work_id ${where}`,
      )
      .bind(...binds),
  ]);
  return {
    items: ((rowsResult.results ?? []) as Row[]).map(mapRow),
    total: Number(
      (countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0,
    ),
    page,
    pageSize,
  };
}

export async function listArchiveVersionsForAdmin(
  runtime: AppRuntime,
  limit = 100,
  filter: Filter = "all",
  actor: ArchiveUser,
): Promise<AdminArchiveVersion[]> {
  const { clauses, binds } = archiveClauses(actor, filter);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await getD1(runtime)
    .prepare(
      `${archiveSelect()} ${where}
       ORDER BY av.created_at DESC, av.id DESC
       LIMIT ?`,
    )
    .bind(...binds, Math.max(1, Math.min(300, limit)))
    .all<Row>();
  return (rows.results ?? []).map(mapRow);
}

function archiveClauses(
  actor: ArchiveUser,
  filter: Filter,
  query?: string,
  status?: string,
) {
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
    clauses.push(
      "(COALESCE(w.chinese_title,w.original_title) LIKE ? OR CAST(av.id AS TEXT) LIKE ?)",
    );
    binds.push(value, value);
  }
  const canReadAny =
    hasPermission(actor, "archive_version.read_private") ||
    hasPermission(actor, "archive_version.update") ||
    hasPermission(actor, "archive_version.delete_any") ||
    hasPermission(actor, "archive_version.restore") ||
    hasPermission(actor, "archive_version.set_current");
  if (!canReadAny) {
    clauses.push(
      "w.status<>'deleted' AND EXISTS(SELECT 1 FROM work_uploaders wu WHERE wu.work_id=av.work_id AND wu.user_id=?)",
    );
    binds.push(actor.id);
  }
  return { clauses, binds };
}

function archiveSelect(): string {
  return `SELECT av.id,
      av.work_id,
      w.status AS work_status,
      (SELECT GROUP_CONCAT(user_id) FROM work_uploaders WHERE work_id=av.work_id) AS maintainer_ids,
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

export async function moveArchiveVersionToTrash(
  runtime: AppRuntime,
  id: number,
  actor?: ArchiveUser,
): Promise<AdminArchiveVersion> {
  const row = await identity(runtime, id);
  if (!row) throw new HttpError(404, "ArchiveVersion 不存在");
  if (actor) {
    const archive = await required(runtime, id);
    const maintainerId = archive.workDeleted
      ? null
      : (archive.maintainerIds.find((id) => id === actor.id) ?? null);
    if (!canDeleteArchiveVersion(actor, maintainerId))
      throw new HttpError(404, "ArchiveVersion 不存在");
  }
  await getD1(runtime)
    .prepare(
      `UPDATE archive_versions SET status='deleted',is_current=0,deleted_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(id)
    .run();
  await ensureCurrent(runtime, row.work_id);
  return required(runtime, id);
}
export async function restoreArchiveVersion(
  runtime: AppRuntime,
  id: number,
): Promise<AdminArchiveVersion> {
  const row = await identity(runtime, id);
  if (!row) throw new Error("ArchiveVersion 不存在");
  if (row.purged_at) throw new Error("ArchiveVersion 已最终清理，不能还原");
  await getD1(runtime)
    .prepare(
      `UPDATE archive_versions SET status='published',deleted_at=NULL,published_at=COALESCE(published_at,CURRENT_TIMESTAMP),is_current=0 WHERE id=? AND status='deleted' AND purged_at IS NULL`,
    )
    .bind(id)
    .run();
  await ensureCurrent(runtime, row.work_id);
  return required(runtime, id);
}
export async function setCurrentArchiveVersion(
  runtime: AppRuntime,
  id: number,
): Promise<AdminArchiveVersion> {
  const row = await identity(runtime, id);
  if (!row || row.status !== "published" || row.purged_at)
    throw new Error("只能把未清理的 published ArchiveVersion 设为当前版本");
  const work = await getD1(runtime)
    .prepare(
      `SELECT w.engine_family,
         EXISTS(
           SELECT 1 FROM work_external_links wel
           WHERE wel.work_id=w.id AND wel.link_type='download_page'
         ) AS has_download_link
       FROM works w WHERE w.id=? AND w.status<>'deleted' LIMIT 1`,
    )
    .bind(row.work_id)
    .first<{ engine_family: string; has_download_link: number }>();
  if (
    !work ||
    !isArchiveEngineFamily(work.engine_family) ||
    work.has_download_link === 1
  ) {
    throw new Error(
      "只有使用 RPG Maker 2000/2003 系引擎且没有外部下载的作品才能设置当前归档",
    );
  }
  await getD1(runtime).batch([
    getD1(runtime)
      .prepare(
        `UPDATE archive_versions SET is_current=0 WHERE work_id=? AND status='published'`,
      )
      .bind(row.work_id),
    getD1(runtime)
      .prepare(
        `UPDATE archive_versions SET is_current=1 WHERE id=? AND work_id=? AND status='published' AND purged_at IS NULL`,
      )
      .bind(id, row.work_id),
  ]);
  return required(runtime, id);
}
export async function ensureCurrentArchiveVersion(
  runtime: AppRuntime,
  workId: number,
): Promise<void> {
  const work = await getD1(runtime)
    .prepare(
      `SELECT w.engine_family,
         EXISTS(
           SELECT 1 FROM work_external_links wel
           WHERE wel.work_id=w.id AND wel.link_type='download_page'
         ) AS has_download_link
       FROM works w WHERE w.id=? AND w.status<>'deleted' LIMIT 1`,
    )
    .bind(workId)
    .first<{ engine_family: string; has_download_link: number }>();
  if (
    !work ||
    !isArchiveEngineFamily(work.engine_family) ||
    work.has_download_link === 1
  ) {
    return;
  }
  const current = await getD1(runtime)
    .prepare(
      `SELECT id FROM archive_versions WHERE work_id=? AND status='published' AND is_current=1 LIMIT 1`,
    )
    .bind(workId)
    .first();
  if (current) return;
  const replacement = await getD1(runtime)
    .prepare(
      `SELECT id FROM archive_versions WHERE work_id=? AND status='published' ORDER BY COALESCE(published_at,created_at) DESC,id DESC LIMIT 1`,
    )
    .bind(workId)
    .first<{ id: number }>();
  if (replacement) await setCurrentArchiveVersion(runtime, replacement.id);
}
const ensureCurrent = ensureCurrentArchiveVersion;
async function identity(
  runtime: AppRuntime,
  id: number,
): Promise<IdentityRow | null> {
  return getD1(runtime)
    .prepare(
      `SELECT id,work_id,status,is_current,purged_at,uploader_id FROM archive_versions WHERE id=? LIMIT 1`,
    )
    .bind(id)
    .first<IdentityRow>();
}
async function required(
  runtime: AppRuntime,
  id: number,
): Promise<AdminArchiveVersion> {
  const row = await getD1(runtime)
    .prepare(
      `SELECT av.id,
          av.work_id,
      w.status AS work_status,
      (SELECT GROUP_CONCAT(user_id) FROM work_uploaders WHERE work_id=av.work_id) AS maintainer_ids,
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
    maintainerIds: (row.maintainer_ids ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number),
    workDeleted: row.work_status === "deleted",
    uploaderName: row.uploader_name,
  };
}
