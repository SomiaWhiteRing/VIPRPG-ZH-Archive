import type {
  ArchiveCommitMetadata,
  ArchiveManifest,
  ExcludedFileTypeSummary,
} from "@/lib/archive/manifest";

export type UploadTaskStatus =
  | "created"
  | "running"
  | "paused"
  | "needs_source_reselect"
  | "completed"
  | "failed_recoverable"
  | "failed_terminal"
  | "canceled";

export type UploadTaskPhase =
  | "created"
  | "source_selected"
  | "enumerating"
  | "hashing"
  | "building_core_pack"
  | "manifest_ready"
  | "creating_import_job"
  | "preflighting"
  | "uploading_missing_objects"
  | "verifying_objects"
  | "committing"
  | "completed";

export type UploadSourceKind = "folder" | "zip";

export type BrowserUploadTaskSnapshot = {
  localTaskId: string;
  serverImportJobId: number | null;
  status: UploadTaskStatus;
  phase: UploadTaskPhase;
  sourceKind: UploadSourceKind;
  sourceName: string;
  sourceFingerprint: string | null;
  filePolicyVersion: string;
  packerVersion: string;
  metadata: ArchiveCommitMetadata;
  manifestSha256: string | null;
  manifestJson: string | null;
  corePackSha256: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  progress: UploadTaskProgress;
  stats: UploadTaskStats;
  error: string | null;
  result: UploadTaskCommitResult | null;
};

export type UploadTaskProgress = {
  percent: number;
  processedBytes: number;
  totalBytes: number;
  uploadedBytes: number;
  uploadBytesTotal: number;
  processedFiles: number;
  totalFiles: number;
  uploadedObjects: number;
  totalUploadObjects: number;
  currentPath: string | null;
};

export type UploadTaskStats = {
  sourceFileCount: number;
  sourceSizeBytes: number;
  includedFileCount: number;
  includedSizeBytes: number;
  excludedFileCount: number;
  excludedSizeBytes: number;
  uniqueBlobCount: number;
  uniqueBlobSizeBytes: number;
  corePackFileCount: number;
  corePackRawSizeBytes: number;
  corePackZipSizeBytes: number;
  estimatedR2GetCount: number;
  excludedFileTypes: ExcludedFileTypeSummary[];
};

export type UploadTaskCommitResult = {
  workId: number;
  releaseId: number;
  archiveVersionId: number;
  manifestSha256: string;
  manifestR2Key: string;
  fileCount: number;
  uniqueBlobCount: number;
  corePackCount: number;
  alreadyExisted: boolean;
};

export type UploadWorkerInput =
  | {
      type: "start";
      localTaskId: string;
      resumeLocalTaskId: string | null;
      sourceKind: UploadSourceKind;
      files: File[];
      metadata: ArchiveCommitMetadata;
    }
  | {
      type: "pause";
      localTaskId: string;
    }
  | {
      type: "resume";
      localTaskId: string;
    }
  | {
      type: "cancel";
      localTaskId: string;
    }
  | {
      type: "checkpoint";
    };

export type UploadWorkerOutput =
  | {
      type: "task";
      task: BrowserUploadTaskSnapshot;
    }
  | {
      type: "log";
      localTaskId: string;
      message: string;
    };

export type ArchiveManifestBuildResult = {
  manifest: ArchiveManifest;
  manifestJson: string;
  manifestSha256: string;
  corePackBytes: Uint8Array;
  corePackSha256: string;
};
