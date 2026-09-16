export type StatusCount = {
  status: string;
  count: number;
};

export type RecentImportJob = {
  id: number;
  workId: number | null;
  workTitle: string | null;
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
  errorMessage: string | null;
  archiveVersionId: number | null;
  uploaderName: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type RecentDownloadBuild = {
  id: number;
  archiveVersionId: number;
  workTitle: string;
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

export type AdminImportJobDetail = RecentImportJob & {
  excludedFileTypes: Array<{
    fileType: string;
    fileCount: number;
    totalSizeBytes: number;
    examplePath: string | null;
  }>;
};
