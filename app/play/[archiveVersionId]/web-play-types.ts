export type WebPlayMetadata = {
  ok: true;
  archiveVersionId: number;
  workId: number;
  title: string;
  originalTitle: string;
  chineseTitle: string | null;
  coverBlobSha256: string | null;
  manifestSha256: string;
  downloadZipBuilderVersion: string;
  webPlayInstallerVersion: string;
  easyRpgRuntimeVersion: string;
  runtimeBasePath: string;
  playKey: string;
  downloadUrl: string;
  totalFiles: number;
  totalSizeBytes: number;
  installTotalFiles: number;
  installTotalSizeBytes: number;
  estimatedR2GetCount: number;
  engineFamily: string;
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
  workId?: number;
  archiveVersionId: number;
  manifestSha256: string;
  webPlayInstallerVersion: string;
  title: string;
  originalTitle?: string;
  engineFamily?: string;
  /** Absent only on pre-existing OPFS installations, including older Android APKs. */
  storageKind?: WebPlayStorageKind;
  coverBlobSha256?: string | null;
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

export type WebPlayStorageKind = "browser-bucket" | "browser-opfs" | "android-opfs";

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
      storageKind: WebPlayStorageKind;
      storageSnapshot?: WebPlayStorageSnapshot;
    }
  | {
      type: "cancel";
      playKey: string;
    };

export type WebPlayInstallWorkerOutput =
  | { type: "install-finished" }
  | { type: "install-rejected"; message: string }
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
