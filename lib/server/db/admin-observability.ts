import { getD1 } from "@/lib/server/db/d1";

export type StatusCount = {
  status: string;
  count: number;
};

export type RecentImportJob = {
  id: number;
  status: string;
  sourceName: string | null;
  sourceSizeBytes: number | null;
  fileCount: number;
  excludedFileCount: number;
  excludedSizeBytes: number;
  missingBlobCount: number;
  missingCorePackCount: number;
  uploadedBlobCount: number;
  uploadedBlobSizeBytes: number;
  uploadedCorePackCount: number;
  uploadedCorePackSizeBytes: number;
  r2PutCount: number;
  preflightDurationMs: number | null;
  uploadDurationMs: number;
  commitDurationMs: number | null;
  failedStage: string | null;
  archiveVersionId: number | null;
  uploaderName: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type RecentDownloadBuild = {
  id: number;
  archiveVersionId: number;
  workTitle: string;
  releaseLabel: string;
  archiveLabel: string;
  downloadCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  failureCount: number;
  totalR2GetCount: number;
  sizeBytes: number | null;
  lastCacheStatus: string | null;
  lastDurationMs: number | null;
  lastErrorMessage: string | null;
  lastAccessedAt: string | null;
};

export type ExpensiveArchiveVersion = {
  archiveVersionId: number;
  workTitle: string;
  releaseLabel: string;
  archiveLabel: string;
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
};

export type AdminObservability = {
  imports: {
    statusCounts: StatusCount[];
    totalSourceSizeBytes: number;
    totalAcceptedSizeBytes: number;
    totalExcludedSizeBytes: number;
    totalMissingBlobCount: number;
    totalMissingCorePackCount: number;
    totalMissingBlobSizeBytes: number;
    totalMissingCorePackSizeBytes: number;
    totalUploadedBlobCount: number;
    totalUploadedBlobSizeBytes: number;
    totalUploadedCorePackCount: number;
    totalUploadedCorePackSizeBytes: number;
    totalManifestSizeBytes: number;
    totalR2PutCount: number;
    averagePreflightDurationMs: number;
    averageUploadDurationMs: number;
    averageCommitDurationMs: number;
    recent: RecentImportJob[];
  };
  downloads: {
    buildCount: number;
    totalDownloadCount: number;
    cacheHitCount: number;
    cacheMissCount: number;
    cacheBypassCount: number;
    failureCount: number;
    totalR2GetCount: number;
    totalBytesServed: number;
    cachedBytesServed: number;
    estimatedR2GetSavedByCache: number;
    recent: RecentDownloadBuild[];
    expensiveArchives: ExpensiveArchiveVersion[];
  };
};

type ImportTotalsRow = {
  total_source_size_bytes: number | null;
  total_accepted_size_bytes: number | null;
  total_excluded_size_bytes: number | null;
  total_missing_blob_count: number | null;
  total_missing_core_pack_count: number | null;
  total_missing_blob_size_bytes: number | null;
  total_missing_core_pack_size_bytes: number | null;
  total_uploaded_blob_count: number | null;
  total_uploaded_blob_size_bytes: number | null;
  total_uploaded_core_pack_count: number | null;
  total_uploaded_core_pack_size_bytes: number | null;
  total_manifest_size_bytes: number | null;
  total_r2_put_count: number | null;
  average_preflight_duration_ms: number | null;
  average_upload_duration_ms: number | null;
  average_commit_duration_ms: number | null;
};

type DownloadTotalsRow = {
  build_count: number | null;
  total_download_count: number | null;
  cache_hit_count: number | null;
  cache_miss_count: number | null;
  cache_bypass_count: number | null;
  failure_count: number | null;
  total_r2_get_count: number | null;
  total_bytes_served: number | null;
  cached_bytes_served: number | null;
  estimated_r2_get_saved_by_cache: number | null;
};

type RecentImportRow = {
  id: number;
  status: string;
  source_name: string | null;
  source_size_bytes: number | null;
  file_count: number;
  excluded_file_count: number;
  excluded_size_bytes: number;
  missing_blob_count: number;
  missing_core_pack_count: number;
  uploaded_blob_count: number;
  uploaded_blob_size_bytes: number;
  uploaded_core_pack_count: number;
  uploaded_core_pack_size_bytes: number;
  r2_put_count: number;
  preflight_duration_ms: number | null;
  upload_duration_ms: number;
  commit_duration_ms: number | null;
  failed_stage: string | null;
  archive_version_id: number | null;
  uploader_name: string | null;
  created_at: string;
  completed_at: string | null;
};

type RecentDownloadRow = {
  id: number;
  archive_version_id: number;
  work_title: string;
  release_label: string;
  archive_label: string;
  download_count: number;
  cache_hit_count: number;
  cache_miss_count: number;
  failure_count: number;
  total_r2_get_count: number;
  size_bytes: number | null;
  last_cache_status: string | null;
  last_duration_ms: number | null;
  last_error_message: string | null;
  last_accessed_at: string | null;
};

type ExpensiveArchiveRow = {
  archive_version_id: number;
  work_title: string;
  release_label: string;
  archive_label: string;
  total_files: number;
  total_size_bytes: number;
  estimated_r2_get_count: number;
};

export async function getAdminObservability(): Promise<AdminObservability> {
  const [
    importStatusCounts,
    importTotals,
    recentImports,
    downloadTotals,
    recentDownloads,
    expensiveArchives,
  ] = await Promise.all([
    listImportStatusCounts(),
    getImportTotals(),
    listRecentImports(),
    getDownloadTotals(),
    listRecentDownloads(),
    listExpensiveArchiveVersions(),
  ]);

  return {
    imports: {
      statusCounts: importStatusCounts,
      totalSourceSizeBytes: importTotals.total_source_size_bytes ?? 0,
      totalAcceptedSizeBytes: importTotals.total_accepted_size_bytes ?? 0,
      totalExcludedSizeBytes: importTotals.total_excluded_size_bytes ?? 0,
      totalMissingBlobCount: importTotals.total_missing_blob_count ?? 0,
      totalMissingCorePackCount: importTotals.total_missing_core_pack_count ?? 0,
      totalMissingBlobSizeBytes: importTotals.total_missing_blob_size_bytes ?? 0,
      totalMissingCorePackSizeBytes:
        importTotals.total_missing_core_pack_size_bytes ?? 0,
      totalUploadedBlobCount: importTotals.total_uploaded_blob_count ?? 0,
      totalUploadedBlobSizeBytes: importTotals.total_uploaded_blob_size_bytes ?? 0,
      totalUploadedCorePackCount: importTotals.total_uploaded_core_pack_count ?? 0,
      totalUploadedCorePackSizeBytes:
        importTotals.total_uploaded_core_pack_size_bytes ?? 0,
      totalManifestSizeBytes: importTotals.total_manifest_size_bytes ?? 0,
      totalR2PutCount: importTotals.total_r2_put_count ?? 0,
      averagePreflightDurationMs: importTotals.average_preflight_duration_ms ?? 0,
      averageUploadDurationMs: importTotals.average_upload_duration_ms ?? 0,
      averageCommitDurationMs: importTotals.average_commit_duration_ms ?? 0,
      recent: recentImports,
    },
    downloads: {
      buildCount: downloadTotals.build_count ?? 0,
      totalDownloadCount: downloadTotals.total_download_count ?? 0,
      cacheHitCount: downloadTotals.cache_hit_count ?? 0,
      cacheMissCount: downloadTotals.cache_miss_count ?? 0,
      cacheBypassCount: downloadTotals.cache_bypass_count ?? 0,
      failureCount: downloadTotals.failure_count ?? 0,
      totalR2GetCount: downloadTotals.total_r2_get_count ?? 0,
      totalBytesServed: downloadTotals.total_bytes_served ?? 0,
      cachedBytesServed: downloadTotals.cached_bytes_served ?? 0,
      estimatedR2GetSavedByCache:
        downloadTotals.estimated_r2_get_saved_by_cache ?? 0,
      recent: recentDownloads,
      expensiveArchives,
    },
  };
}

async function listImportStatusCounts(): Promise<StatusCount[]> {
  const rows = await getD1()
    .prepare(
      `SELECT status, COUNT(*) AS count
      FROM import_jobs
      GROUP BY status
      ORDER BY count DESC, status`,
    )
    .all<StatusCount>();

  return rows.results ?? [];
}

async function getImportTotals(): Promise<ImportTotalsRow> {
  const row = await getD1()
    .prepare(
      `SELECT
        SUM(source_size_bytes) AS total_source_size_bytes,
        SUM(COALESCE(source_size_bytes, 0) - excluded_size_bytes) AS total_accepted_size_bytes,
        SUM(excluded_size_bytes) AS total_excluded_size_bytes,
        SUM(missing_blob_count) AS total_missing_blob_count,
        SUM(missing_core_pack_count) AS total_missing_core_pack_count,
        SUM(missing_blob_size_bytes) AS total_missing_blob_size_bytes,
        SUM(missing_core_pack_size_bytes) AS total_missing_core_pack_size_bytes,
        SUM(uploaded_blob_count) AS total_uploaded_blob_count,
        SUM(uploaded_blob_size_bytes) AS total_uploaded_blob_size_bytes,
        SUM(uploaded_core_pack_count) AS total_uploaded_core_pack_count,
        SUM(uploaded_core_pack_size_bytes) AS total_uploaded_core_pack_size_bytes,
        SUM(manifest_size_bytes) AS total_manifest_size_bytes,
        SUM(r2_put_count) AS total_r2_put_count,
        AVG(preflight_duration_ms) AS average_preflight_duration_ms,
        AVG(NULLIF(upload_duration_ms, 0)) AS average_upload_duration_ms,
        AVG(commit_duration_ms) AS average_commit_duration_ms
      FROM import_jobs`,
    )
    .first<ImportTotalsRow>();

  return row ?? {
    total_source_size_bytes: 0,
    total_accepted_size_bytes: 0,
    total_excluded_size_bytes: 0,
    total_missing_blob_count: 0,
    total_missing_core_pack_count: 0,
    total_missing_blob_size_bytes: 0,
    total_missing_core_pack_size_bytes: 0,
    total_uploaded_blob_count: 0,
    total_uploaded_blob_size_bytes: 0,
    total_uploaded_core_pack_count: 0,
    total_uploaded_core_pack_size_bytes: 0,
    total_manifest_size_bytes: 0,
    total_r2_put_count: 0,
    average_preflight_duration_ms: 0,
    average_upload_duration_ms: 0,
    average_commit_duration_ms: 0,
  };
}

async function listRecentImports(): Promise<RecentImportJob[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        ij.id,
        ij.status,
        ij.source_name,
        ij.source_size_bytes,
        ij.file_count,
        ij.excluded_file_count,
        ij.excluded_size_bytes,
        ij.missing_blob_count,
        ij.missing_core_pack_count,
        ij.uploaded_blob_count,
        ij.uploaded_blob_size_bytes,
        ij.uploaded_core_pack_count,
        ij.uploaded_core_pack_size_bytes,
        ij.r2_put_count,
        ij.preflight_duration_ms,
        ij.upload_duration_ms,
        ij.commit_duration_ms,
        ij.failed_stage,
        ij.archive_version_id,
        u.display_name AS uploader_name,
        ij.created_at,
        ij.completed_at
      FROM import_jobs ij
      LEFT JOIN users u ON u.id = ij.uploader_id
      ORDER BY ij.created_at DESC
      LIMIT 10`,
    )
    .all<RecentImportRow>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    sourceName: row.source_name,
    sourceSizeBytes: row.source_size_bytes,
    fileCount: row.file_count,
    excludedFileCount: row.excluded_file_count,
    excludedSizeBytes: row.excluded_size_bytes,
    missingBlobCount: row.missing_blob_count,
    missingCorePackCount: row.missing_core_pack_count,
    uploadedBlobCount: row.uploaded_blob_count,
    uploadedBlobSizeBytes: row.uploaded_blob_size_bytes,
    uploadedCorePackCount: row.uploaded_core_pack_count,
    uploadedCorePackSizeBytes: row.uploaded_core_pack_size_bytes,
    r2PutCount: row.r2_put_count,
    preflightDurationMs: row.preflight_duration_ms,
    uploadDurationMs: row.upload_duration_ms,
    commitDurationMs: row.commit_duration_ms,
    failedStage: row.failed_stage,
    archiveVersionId: row.archive_version_id,
    uploaderName: row.uploader_name,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

async function getDownloadTotals(): Promise<DownloadTotalsRow> {
  const row = await getD1()
    .prepare(
      `SELECT
        COUNT(*) AS build_count,
        SUM(download_count) AS total_download_count,
        SUM(cache_hit_count) AS cache_hit_count,
        SUM(cache_miss_count) AS cache_miss_count,
        SUM(cache_bypass_count) AS cache_bypass_count,
        SUM(failure_count) AS failure_count,
        SUM(total_r2_get_count) AS total_r2_get_count,
        SUM(COALESCE(size_bytes, 0) * download_count) AS total_bytes_served,
        SUM(COALESCE(size_bytes, 0) * cache_hit_count) AS cached_bytes_served,
        SUM(COALESCE(estimated_r2_get_count, 0) * cache_hit_count)
          AS estimated_r2_get_saved_by_cache
      FROM download_builds`,
    )
    .first<DownloadTotalsRow>();

  return row ?? {
    build_count: 0,
    total_download_count: 0,
    cache_hit_count: 0,
    cache_miss_count: 0,
    cache_bypass_count: 0,
    failure_count: 0,
    total_r2_get_count: 0,
    total_bytes_served: 0,
    cached_bytes_served: 0,
    estimated_r2_get_saved_by_cache: 0,
  };
}

async function listRecentDownloads(): Promise<RecentDownloadBuild[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        db.id,
        db.archive_version_id,
        COALESCE(w.chinese_title, w.original_title) AS work_title,
        r.release_label,
        av.archive_label,
        db.download_count,
        db.cache_hit_count,
        db.cache_miss_count,
        db.failure_count,
        db.total_r2_get_count,
        db.size_bytes,
        db.last_cache_status,
        db.last_duration_ms,
        db.last_error_message,
        db.last_accessed_at
      FROM download_builds db
      JOIN archive_versions av ON av.id = db.archive_version_id
      JOIN releases r ON r.id = av.release_id
      JOIN works w ON w.id = r.work_id
      ORDER BY db.last_accessed_at DESC
      LIMIT 10`,
    )
    .all<RecentDownloadRow>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    archiveVersionId: row.archive_version_id,
    workTitle: row.work_title,
    releaseLabel: row.release_label,
    archiveLabel: row.archive_label,
    downloadCount: row.download_count,
    cacheHitCount: row.cache_hit_count,
    cacheMissCount: row.cache_miss_count,
    failureCount: row.failure_count,
    totalR2GetCount: row.total_r2_get_count,
    sizeBytes: row.size_bytes,
    lastCacheStatus: row.last_cache_status,
    lastDurationMs: row.last_duration_ms,
    lastErrorMessage: row.last_error_message,
    lastAccessedAt: row.last_accessed_at,
  }));
}

async function listExpensiveArchiveVersions(): Promise<ExpensiveArchiveVersion[]> {
  const rows = await getD1()
    .prepare(
      `SELECT
        av.id AS archive_version_id,
        COALESCE(w.chinese_title, w.original_title) AS work_title,
        r.release_label,
        av.archive_label,
        av.total_files,
        av.total_size_bytes,
        av.estimated_r2_get_count
      FROM archive_versions av
      JOIN releases r ON r.id = av.release_id
      JOIN works w ON w.id = r.work_id
      WHERE av.status = 'published'
      ORDER BY av.estimated_r2_get_count DESC, av.total_size_bytes DESC
      LIMIT 10`,
    )
    .all<ExpensiveArchiveRow>();

  return (rows.results ?? []).map((row) => ({
    archiveVersionId: row.archive_version_id,
    workTitle: row.work_title,
    releaseLabel: row.release_label,
    archiveLabel: row.archive_label,
    totalFiles: row.total_files,
    totalSizeBytes: row.total_size_bytes,
    estimatedR2GetCount: row.estimated_r2_get_count,
  }));
}
