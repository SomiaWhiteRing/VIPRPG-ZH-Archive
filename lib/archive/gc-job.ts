/** Manual cleanup is a persisted snapshot, separate from the scheduled GC cursor. */
export type GcJobStatus = "scanning" | "ready" | "running" | "needs_retry" | "completed" | "cancelled";
export type GcJobPhase = "archives" | "blobs" | "core_packs" | "manifests";
export type GcJobReport = {
  id: string;
  status: GcJobStatus;
  phase: GcJobPhase;
  graceDays: number;
  createdAt: string;
  confirmedAt: string | null;
  scannedCount: number;
  archiveCount: number;
  archiveFileCount: number;
  archiveSizeBytes: number;
  objectCount: number;
  objectSizeBytes: number;
  missingObjectCount: number;
  totalItems: number;
  processedItems: number;
  purgedArchiveCount: number;
  deletedObjectCount: number;
  deletedSizeBytes: number;
  skippedCount: number;
  failedCount: number;
  failures: Array<{ type: string; key: string; error: string }>;
  safetyLocks: {
    executionLockedAt: string | null;
    staleExecution: boolean;
    manifestCount: number;
    staleManifestCount: number;
  };
};
export type GcJobAction = "start" | "scan" | "status" | "confirm" | "run" | "retry" | "cancel";
