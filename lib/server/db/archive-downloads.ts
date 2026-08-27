import { getD1 } from "@/lib/server/db/d1";

type DownloadRow = {
  id: number;
  work_id: number;
  archive_label: string;
  manifest_sha256: string;
  packer_version: string;
  total_files: number;
  total_size_bytes: number;
  estimated_r2_get_count: number;
  work_original_title: string;
  work_chinese_title: string | null;
  engine_family: string;
  uses_maniacs_patch: number;
};
type TotalsRow = {
  total_files: number | null;
  total_size_bytes: number | null;
};

export type ArchiveDownloadRecord = {
  id: number;
  archiveLabel: string;
  manifestSha256: string;
  packerVersion: string;
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  workId: number;
  workOriginalTitle: string;
  workChineseTitle: string | null;
  engineFamily: string;
  usesManiacsPatch: boolean;
};
export type WebPlayInstallTargetTotals = {
  totalFiles: number;
  totalSizeBytes: number;
};
export function parseArchiveVersionId(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("Invalid archive version id");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error("Invalid archive version id");
  return id;
}
export async function getWebPlayInstallTargetTotals(
  id: number,
): Promise<WebPlayInstallTargetTotals> {
  const row = await getD1()
    .prepare(
      `SELECT web_play_file_count AS total_files,web_play_size_bytes AS total_size_bytes FROM archive_versions WHERE id=?`,
    )
    .bind(id)
    .first<TotalsRow>();
  return {
    totalFiles: row?.total_files ?? 0,
    totalSizeBytes: row?.total_size_bytes ?? 0,
  };
}
export async function getPublishedArchiveDownloadRecord(
  id: number,
): Promise<ArchiveDownloadRecord | null> {
  const row = await getD1()
    .prepare(
      `SELECT av.id,
          av.work_id,
          av.archive_label,
          av.manifest_sha256,
          av.packer_version,
          av.total_files,
          av.total_size_bytes,
          av.estimated_r2_get_count,
          w.original_title AS work_original_title,
          w.chinese_title AS work_chinese_title,
          w.engine_family,
          w.uses_maniacs_patch
       FROM archive_versions av
       JOIN works w ON w.id = av.work_id
       WHERE av.id = ?
         AND av.status = 'published'
         AND av.is_current = 1
         AND w.status = 'published'
       LIMIT 1`,
    )
    .bind(id)
    .first<DownloadRow>();
  if (!row || !row.work_original_title) return null;
  return {
    id: row.id,
    archiveLabel: row.archive_label,
    manifestSha256: row.manifest_sha256,
    packerVersion: row.packer_version,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
    estimatedR2GetCount: row.estimated_r2_get_count,
    workId: row.work_id,
    workOriginalTitle: row.work_original_title,
    workChineseTitle: row.work_chinese_title,
    engineFamily: row.engine_family,
    usesManiacsPatch: row.uses_maniacs_patch === 1,
  };
}
