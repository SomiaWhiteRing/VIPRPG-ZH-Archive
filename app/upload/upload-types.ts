import type {
  ArchiveCommitMetadata,
  ArchiveManifestFile,
  ExcludedFileTypeSummary,
} from "@/lib/archive/manifest";

export type UploadTaskStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "canceled";

export type UploadTaskPhase =
  | "enumerating"
  | "hashing"
  | "building_core_pack"
  | "creating_import_job"
  | "preflighting"
  | "uploading_source"
  | "verifying_source"
  | "awaiting_metadata"
  | "uploading_metadata"
  | "committing"
  | "completed";

export type UploadSourceKind = "folder" | "zip";

export type UploadSourceFile = {
  file: File;
  relativePath: string;
};

export type MetadataBlobUpload = {
  sha256: string;
  file: File;
  contentType: string;
};

export type PreparedArchiveSource = {
  sourceKind: UploadSourceKind;
  sourceName: string;
  files: ArchiveManifestFile[];
  corePack: {
    sha256: string;
    size: number;
    uncompressedSize: number;
    fileCount: number;
  };
  stats: UploadTaskStats;
};

export type UploadRecoveryDraft = {
  key: string;
  accountId: number;
  localTaskId: string;
  serverImportJobId: number;
  targetWorkId: number | null;
  preparedSource: PreparedArchiveSource;
  metadata: ArchiveCommitMetadata | null;
  metadataBlobs: MetadataBlobUpload[];
  metadataConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BrowserUploadTaskSnapshot = {
  accountId: number;
  localTaskId: string;
  serverImportJobId: number | null;
  targetWorkId: number | null;
  status: UploadTaskStatus;
  phase: UploadTaskPhase;
  sourceKind: UploadSourceKind;
  sourceName: string;
  sourceReady: boolean;
  metadataConfirmed: boolean;
  commitStarted: boolean;
  createdAt: string;
  progress: UploadTaskProgress;
  stats: UploadTaskStats;
  error: string | null;
  result: UploadTaskCommitResult | null;
};

export type UploadTaskProgress = {
  percent: number;
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
  archiveVersionId: number;
  manifestSha256: string;
  fileCount: number;
  uniqueBlobCount: number;
  corePackCount: number;
};

export type UploadWorkerInput =
  | {
      type: "start_source";
      accountId: number;
      localTaskId: string;
      sourceKind: UploadSourceKind;
      sourceName: string;
      files: UploadSourceFile[];
      targetWorkId: number | null;
    }
  | {
      type: "confirm_metadata";
      localTaskId: string;
      metadata: ArchiveCommitMetadata;
      metadataBlobs: MetadataBlobUpload[];
    }
  | { type: "revoke_metadata"; localTaskId: string }
  | { type: "restore"; draft: UploadRecoveryDraft }
  | { type: "cancel"; localTaskId: string };

export type UploadWorkerOutput =
  | { type: "task"; task: BrowserUploadTaskSnapshot }
  | { type: "draft_saved"; draft: UploadRecoveryDraft }
  | {
      type: "settled";
      task: BrowserUploadTaskSnapshot;
      draftRemoved: boolean;
    }
  | {
      type: "cancel_rejected";
      task: BrowserUploadTaskSnapshot;
      message: string;
    };
