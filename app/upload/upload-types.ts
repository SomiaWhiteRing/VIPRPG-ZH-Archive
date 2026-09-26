import type {
  ArchiveCommitMetadata,
  ArchiveManifestFile,
  ExcludedFileTypeSummary,
} from "@/lib/archive/manifest";
import type { CharacterCreditSelection } from "@/lib/character-names";
import type { CreatorSelection } from "@/lib/creator-names";
import type { ResourceCleanupReport } from "@/lib/archive/resource-cleanup";
import type { StaffRow } from "./staff-editor";
import type { MoreInfoRow } from "@/app/components/work/work-more-info-editor";

export type UploadFormMetadata = {
  usesUnsupportedManiac: boolean;
  originalTitle: string;
  chineseTitle: string;
  aliasTitles: string[];
  engineFamily: ArchiveCommitMetadata["game"]["engineFamily"];
  description: string;
  tags: string[];
  characters: CharacterCreditSelection[];
  authors: (CreatorSelection | null)[];
  extraStaff: StaffRow[];
  moreInfo: MoreInfoRow[];
  translators: (CreatorSelection | null)[];
  originalReleaseDate: string;
  isOriginal: boolean;
  isTranslation: boolean;
  language: string;
  archiveSourceUrl: string;
  externalDownloadUrl: string;
  status: "published" | "hidden";
};

export type UploadImageSelections = {
  cover: File | null;
  browsingImages: File[];
  replacePreviews: boolean;
};

export type UploadAssociationDefaults = {
  characters: NonNullable<ArchiveCommitMetadata["characters"]>;
  authors: ArchiveCommitMetadata["workStaff"];
  translators: ArchiveCommitMetadata["workStaff"];
};

export type UploadFormDraft = {
  form: UploadFormMetadata;
  associationDefaults: UploadAssociationDefaults;
  imageSelections: UploadImageSelections;
  characterFaceSheetFiles: Record<number, File[]>;
  sourceFaceSheetFiles?: File[];
  sourceFaceSheetWarnings?: string[];
};

export type UploadTaskStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "canceled";

export type UploadTaskPhase =
  | "enumerating"
  | "hashing"
  | "analyzing_resources"
  | "building_core_pack"
  | "creating_import_job"
  | "preflighting"
  | "uploading_source"
  | "verifying_source"
  | "awaiting_metadata"
  | "uploading_metadata"
  | "committing"
  | "completed";

export type UploadSourceKind = "folder" | "zip" | "7z";

export type UploadSourcePrefill = {
  gameTitle: string | null;
  titleImages: File[];
  faceSheetFiles: File[];
  faceSheetWarnings: string[];
};

export type UploadSourceFile = {
  file: File;
  relativePath: string;
};

export type MetadataBlobUpload = {
  sha256: string;
  file: File;
  contentType: string;
};

export type UploadTaxonomySuggestion = {
  value: string;
  meta: string;
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
  formDraft?: UploadFormDraft;
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
  resourceCleanup: ResourceCleanupReport | null;
};

export type UploadTaskCommitResult = {
  translators: import("@/lib/creator-names").ConfirmedCreatorSelection[];
  workId: number;
  archiveVersionId: number;
  manifestSha256: string;
  fileCount: number;
  uniqueBlobCount: number;
  corePackCount: number;
};

export type UploadWorkerInput =
  | { type: "save_form_draft"; localTaskId: string; formDraft: UploadFormDraft }
  | {
      type: "start_source";
      accountId: number;
      localTaskId: string;
      sourceKind: UploadSourceKind;
      sourceName: string;
      cleanupResources: boolean;
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
  | { type: "source_prefill"; prefill: UploadSourcePrefill }
  | { type: "draft_saved"; draft: UploadRecoveryDraft }
  | { type: "draft_save_error"; message: string }
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
