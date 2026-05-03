import { getD1 } from "@/lib/server/db/d1";

export type AdminArchiveVersion = {
  id: number;
  releaseId: number;
  workId: number;
  workTitle: string;
  workOriginalTitle: string;
  workChineseTitle: string | null;
  releaseLabel: string;
  archiveKey: string;
  archiveLabel: string;
  language: string;
  status: "draft" | "published" | "hidden" | "deleted";
  isCurrent: boolean;
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  createdAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
  purgedAt: string | null;
  uploaderName: string | null;
};

type ArchiveVersionRow = {
  id: number;
  release_id: number;
  work_id: number;
  work_title: string;
  work_original_title: string;
  work_chinese_title: string | null;
  release_label: string;
  archive_key: string;
  archive_label: string;
  language: string;
  status: AdminArchiveVersion["status"];
  is_current: number;
  total_files: number;
  total_size_bytes: number;
  estimated_r2_get_count: number;
  created_at: string;
  published_at: string | null;
  deleted_at: string | null;
  purged_at: string | null;
  uploader_name: string | null;
};

type ArchiveVersionIdentityRow = {
  id: number;
  release_id: number;
  archive_key: string;
  status: AdminArchiveVersion["status"];
  is_current: number;
  purged_at: string | null;
};

type IdRow = {
  id: number;
};

type ArchiveVersionListFilter = "all" | "active" | "trash";

export async function listArchiveVersionsForAdmin(
  limit = 100,
  filter: ArchiveVersionListFilter = "all",
): Promise<AdminArchiveVersion[]> {
  const whereSql =
    filter === "active"
      ? "WHERE av.status <> 'deleted'"
      : filter === "trash"
        ? "WHERE av.status = 'deleted'"
        : "";
  const orderSql =
    filter === "trash"
      ? `ORDER BY
        av.purged_at IS NOT NULL ASC,
        datetime(av.deleted_at) DESC,
        av.id DESC`
      : `ORDER BY
        CASE av.status
          WHEN 'published' THEN 0
          WHEN 'hidden' THEN 1
          WHEN 'draft' THEN 2
          WHEN 'deleted' THEN 3
          ELSE 4
        END,
        av.created_at DESC,
        av.id DESC`;
  const rows = await getD1()
    .prepare(
      `SELECT
        av.id,
        av.release_id,
        w.id AS work_id,
        COALESCE(w.chinese_title, w.original_title) AS work_title,
        w.original_title AS work_original_title,
        w.chinese_title AS work_chinese_title,
        r.release_label,
        av.archive_key,
        av.archive_label,
        av.language,
        av.status,
        av.is_current,
        av.total_files,
        av.total_size_bytes,
        av.estimated_r2_get_count,
        av.created_at,
        av.published_at,
        av.deleted_at,
        av.purged_at,
        u.display_name AS uploader_name
      FROM archive_versions av
      JOIN releases r ON r.id = av.release_id
      JOIN works w ON w.id = r.work_id
      LEFT JOIN users u ON u.id = av.uploader_id
      ${whereSql}
      ${orderSql}
      LIMIT ?`,
    )
    .bind(clampLimit(limit))
    .all<ArchiveVersionRow>();

  return (rows.results ?? []).map(mapArchiveVersionRow);
}

export async function moveArchiveVersionToTrash(
  archiveVersionId: number,
): Promise<AdminArchiveVersion> {
  const target = await getArchiveVersionIdentity(archiveVersionId);

  if (!target) {
    throw new Error("ArchiveVersion 不存在");
  }

  if (target.status === "deleted") {
    return requiredAdminArchiveVersion(archiveVersionId);
  }

  await getD1()
    .prepare(
      `UPDATE archive_versions
      SET status = 'deleted',
        is_current = 0,
        deleted_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    )
    .bind(archiveVersionId)
    .run();

  await ensureCurrentArchiveVersion(target.release_id, target.archive_key);

  return requiredAdminArchiveVersion(archiveVersionId);
}

export async function restoreArchiveVersion(
  archiveVersionId: number,
): Promise<AdminArchiveVersion> {
  const target = await getArchiveVersionIdentity(archiveVersionId);

  if (!target) {
    throw new Error("ArchiveVersion 不存在");
  }

  if (target.status !== "deleted") {
    return requiredAdminArchiveVersion(archiveVersionId);
  }

  if (target.purged_at) {
    throw new Error("ArchiveVersion 已最终清理，不能还原");
  }

  await getD1()
    .prepare(
      `UPDATE archive_versions
      SET status = 'published',
        deleted_at = NULL,
        published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
        is_current = 0
      WHERE id = ?`,
    )
    .bind(archiveVersionId)
    .run();

  await ensureCurrentArchiveVersion(target.release_id, target.archive_key);

  return requiredAdminArchiveVersion(archiveVersionId);
}

export async function setCurrentArchiveVersion(
  archiveVersionId: number,
): Promise<AdminArchiveVersion> {
  const target = await getArchiveVersionIdentity(archiveVersionId);

  if (!target || target.status !== "published") {
    throw new Error("只能把 published ArchiveVersion 设为当前版本");
  }

  await getD1()
    .prepare(
      `UPDATE archive_versions
      SET is_current = CASE WHEN id = ? THEN 1 ELSE 0 END
      WHERE release_id = ?
        AND archive_key = ?
        AND status = 'published'`,
    )
    .bind(archiveVersionId, target.release_id, target.archive_key)
    .run();

  return requiredAdminArchiveVersion(archiveVersionId);
}

async function ensureCurrentArchiveVersion(
  releaseId: number,
  archiveKey: string,
): Promise<void> {
  const current = await getD1()
    .prepare(
      `SELECT id
      FROM archive_versions
      WHERE release_id = ?
        AND archive_key = ?
        AND status = 'published'
        AND is_current = 1
      LIMIT 1`,
    )
    .bind(releaseId, archiveKey)
    .first<IdRow>();

  if (current) {
    return;
  }

  const replacement = await getD1()
    .prepare(
      `SELECT id
      FROM archive_versions
      WHERE release_id = ?
        AND archive_key = ?
        AND status = 'published'
      ORDER BY
        COALESCE(published_at, created_at) DESC,
        id DESC
      LIMIT 1`,
    )
    .bind(releaseId, archiveKey)
    .first<IdRow>();

  if (!replacement) {
    return;
  }

  await setCurrentArchiveVersion(replacement.id);
}

async function requiredAdminArchiveVersion(
  archiveVersionId: number,
): Promise<AdminArchiveVersion> {
  const rows = await getD1()
    .prepare(
      `SELECT
        av.id,
        av.release_id,
        w.id AS work_id,
        COALESCE(w.chinese_title, w.original_title) AS work_title,
        w.original_title AS work_original_title,
        w.chinese_title AS work_chinese_title,
        r.release_label,
        av.archive_key,
        av.archive_label,
        av.language,
        av.status,
        av.is_current,
        av.total_files,
        av.total_size_bytes,
        av.estimated_r2_get_count,
        av.created_at,
        av.published_at,
        av.deleted_at,
        av.purged_at,
        u.display_name AS uploader_name
      FROM archive_versions av
      JOIN releases r ON r.id = av.release_id
      JOIN works w ON w.id = r.work_id
      LEFT JOIN users u ON u.id = av.uploader_id
      WHERE av.id = ?
      LIMIT 1`,
    )
    .bind(archiveVersionId)
    .all<ArchiveVersionRow>();

  const row = rows.results?.[0];

  if (!row) {
    throw new Error("ArchiveVersion 不存在");
  }

  return mapArchiveVersionRow(row);
}

async function getArchiveVersionIdentity(
  archiveVersionId: number,
): Promise<ArchiveVersionIdentityRow | null> {
  const row = await getD1()
    .prepare(
      `SELECT id, release_id, archive_key, status, is_current, purged_at
      FROM archive_versions
      WHERE id = ?
      LIMIT 1`,
    )
    .bind(archiveVersionId)
    .first<ArchiveVersionIdentityRow>();

  return row ?? null;
}

function mapArchiveVersionRow(row: ArchiveVersionRow): AdminArchiveVersion {
  return {
    id: row.id,
    releaseId: row.release_id,
    workId: row.work_id,
    workTitle: row.work_title,
    workOriginalTitle: row.work_original_title,
    workChineseTitle: row.work_chinese_title,
    releaseLabel: row.release_label,
    archiveKey: row.archive_key,
    archiveLabel: row.archive_label,
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
    uploaderName: row.uploader_name,
  };
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }

  return Math.max(1, Math.min(300, Math.floor(value)));
}
