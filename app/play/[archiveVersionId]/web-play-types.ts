export type WebPlayMetadata = {
  ok: true;
  archiveVersionId: number;
  releaseId: number;
  workId: number;
  title: string;
  originalTitle: string;
  chineseTitle: string | null;
  workSlug: string;
  releaseLabel: string;
  archiveLabel: string;
  archiveKey: string;
  manifestSha256: string;
  downloadZipBuilderVersion: string;
  webPlayInstallerVersion: string;
  easyRpgRuntimeVersion: string;
  runtimeBasePath: string;
  playKey: string;
  downloadUrl: string;
  totalFiles: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  engineFamily: string;
  usesManiacsPatch: boolean;
  canPlay: boolean;
};

export type WebPlayInstallStatus =
  | "created"
  | "installing"
  | "ready"
  | "failed"
  | "deleted";

export type WebPlayInstallPhase =
  | "metadata"
  | "requesting_storage"
  | "downloading_zip"
  | "extracting_zip"
  | "writing_index"
  | "ready";

export type WebPlayInstallation = {
  playKey: string;
  archiveVersionId: number;
  manifestSha256: string;
  downloadZipBuilderVersion: string;
  webPlayInstallerVersion: string;
  easyRpgRuntimeVersion: string;
  title: string;
  releaseLabel: string;
  archiveLabel: string;
  status: WebPlayInstallStatus;
  phase: WebPlayInstallPhase;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
  lastPlayedAt: string | null;
  totalFiles: number;
  totalSizeBytes: number;
  downloadedBytes: number;
  downloadBytesTotal: number;
  installedFiles: number;
  installedBytes: number;
  currentPath: string | null;
  persistedStorage: boolean | null;
  storageQuotaBytes: number | null;
  storageUsageBytes: number | null;
  error: string | null;
};

export type WebPlayStorageSnapshot = {
  persistedStorage: boolean | null;
  storageQuotaBytes: number | null;
  storageUsageBytes: number | null;
};

export type WebPlayFileRecord = {
  id: string;
  playKey: string;
  path: string;
  size: number;
  updatedAt: string;
};

export type WebPlayInstallWorkerInput =
  | {
      type: "install";
      metadata: WebPlayMetadata;
      storageSnapshot?: WebPlayStorageSnapshot;
    }
  | {
      type: "cancel";
      playKey: string;
    };

export type WebPlayInstallWorkerOutput =
  | {
      type: "installation";
      installation: WebPlayInstallation;
    }
  | {
      type: "log";
      playKey: string;
      level: "info" | "warning" | "error";
      message: string;
    };
