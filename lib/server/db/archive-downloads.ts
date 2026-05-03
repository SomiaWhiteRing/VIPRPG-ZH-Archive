import { webPlayLocalSkippedExtensions } from "@/lib/archive/web-play-local-policy";
import { getD1 } from "@/lib/server/db/d1";

export type ArchiveDownloadRecord = {
  id: number;
  releaseId: number;
  workId: number;
  archiveLabel: string;
  archiveKey: string;
  manifestSha256: string;
  manifestR2Key: string;
  packerVersion: string;
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  releaseLabel: string;
  workSlug: string;
  workOriginalTitle: string;
  workChineseTitle: string | null;
  engineFamily: string;
  usesManiacsPatch: boolean;
};

type ArchiveDownloadRow = {
  id: number;
  release_id: number;
  work_id: number;
  archive_label: string;
  archive_key: string;
  manifest_sha256: string;
  manifest_r2_key: string;
  packer_version: string;
  total_files: number;
  total_size_bytes: number;
  estimated_r2_get_count: number;
  release_label: string;
  work_slug: string;
  work_original_title: string | null;
  work_chinese_title: string | null;
  engine_family: string;
  uses_maniacs_patch: number;
};

export type WebPlayInstallTargetTotals = {
  totalFiles: number;
  totalSizeBytes: number;
};

export function parseArchiveVersionId(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("Invalid archive version id");
  }

  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid archive version id");
  }

  return id;
}

export async function getWebPlayInstallTargetTotals(
  archiveVersionId: number,
): Promise<WebPlayInstallTargetTotals> {
  const skippedExtensionClauses = webPlayLocalSkippedExtensions
    .map(() => "AND LOWER(path) NOT LIKE ?")
    .join("\n        ");
  const skippedExtensionPatterns = webPlayLocalSkippedExtensions.map(
    (extension) => `%.${extension}`,
  );
  const row = await getD1()
    .prepare(
      `SELECT
        COUNT(*) AS total_files,
        COALESCE(SUM(size_bytes), 0) AS total_size_bytes
      FROM archive_version_files
      WHERE archive_version_id = ?
        ${skippedExtensionClauses}`,
    )
    .bind(archiveVersionId, ...skippedExtensionPatterns)
    .first<{
      total_files: number | null;
      total_size_bytes: number | null;
    }>();

  return {
    totalFiles: row?.total_files ?? 0,
    totalSizeBytes: row?.total_size_bytes ?? 0,
  };
}

export async function getPublishedArchiveDownloadRecord(
  archiveVersionId: number,
): Promise<ArchiveDownloadRecord | null> {
  const row = await getD1()
    .prepare(
      `SELECT
        av.id,
        av.release_id,
        w.id AS work_id,
        av.archive_label,
        av.archive_key,
        av.manifest_sha256,
        av.manifest_r2_key,
        av.packer_version,
        av.total_files,
        av.total_size_bytes,
        av.estimated_r2_get_count,
        r.release_label,
        w.slug AS work_slug,
        w.original_title AS work_original_title,
        w.chinese_title AS work_chinese_title,
        w.engine_family,
        w.uses_maniacs_patch
      FROM archive_versions av
      JOIN releases r ON r.id = av.release_id
      JOIN works w ON w.id = r.work_id
      WHERE av.id = ?
        AND av.status = 'published'
        AND r.status <> 'deleted'
        AND w.status <> 'deleted'
      LIMIT 1`,
    )
    .bind(archiveVersionId)
    .first<ArchiveDownloadRow>();

  if (!row || !row.work_original_title) {
    return null;
  }

  return {
    id: row.id,
    releaseId: row.release_id,
    workId: row.work_id,
    archiveLabel: row.archive_label,
    archiveKey: row.archive_key,
    manifestSha256: row.manifest_sha256,
    manifestR2Key: row.manifest_r2_key,
    packerVersion: row.packer_version,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
    estimatedR2GetCount: row.estimated_r2_get_count,
    releaseLabel: row.release_label,
    workSlug: row.work_slug,
    workOriginalTitle: row.work_original_title,
    workChineseTitle: row.work_chinese_title,
    engineFamily: row.engine_family,
    usesManiacsPatch: row.uses_maniacs_patch === 1,
  };
}

export async function listCurrentArchiveDownloadRecords(): Promise<ArchiveDownloadRecord[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        av.id,
        av.release_id,
        w.id AS work_id,
        av.archive_label,
        av.archive_key,
        av.manifest_sha256,
        av.manifest_r2_key,
        av.packer_version,
        av.total_files,
        av.total_size_bytes,
        av.estimated_r2_get_count,
        r.release_label,
        w.slug AS work_slug,
        w.original_title AS work_original_title,
        w.chinese_title AS work_chinese_title,
        w.engine_family,
        w.uses_maniacs_patch
      FROM archive_versions av
      JOIN releases r ON r.id = av.release_id
      JOIN works w ON w.id = r.work_id
      WHERE av.status = 'published'
        AND av.is_current = 1
        AND r.status <> 'deleted'
        AND w.status <> 'deleted'
      ORDER BY COALESCE(w.chinese_title, w.original_title), r.release_label, av.archive_label`,
    )
    .all<ArchiveDownloadRow>();

  return rows.results
    .filter((row) => Boolean(row.work_original_title))
    .map((row) => ({
      id: row.id,
      releaseId: row.release_id,
      workId: row.work_id,
      archiveLabel: row.archive_label,
      archiveKey: row.archive_key,
      manifestSha256: row.manifest_sha256,
      manifestR2Key: row.manifest_r2_key,
      packerVersion: row.packer_version,
      totalFiles: row.total_files,
      totalSizeBytes: row.total_size_bytes,
      estimatedR2GetCount: row.estimated_r2_get_count,
      releaseLabel: row.release_label,
      workSlug: row.work_slug,
      workOriginalTitle: row.work_original_title ?? "",
      workChineseTitle: row.work_chinese_title,
      engineFamily: row.engine_family,
      usesManiacsPatch: row.uses_maniacs_patch === 1,
    }));
}
