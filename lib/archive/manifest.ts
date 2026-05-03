import type { ArchiveFileRole, ArchiveStorageKind } from "@/lib/archive/file-policy";

export type ArchiveManifest = {
  schema: "viprpg-archive.manifest.v1";
  work: {
    slug: string;
    originalTitle: string;
    chineseTitle: string | null;
  };
  release: {
    key: string;
    label: string;
    type: string;
    baseVariant: "original" | "remake" | "other";
    variantLabel: string;
  };
  archiveVersion: {
    key: string;
    label: string;
    variantLabel: string;
    language: string;
    isProofread: boolean;
    isImageEdited: boolean;
    createdAt: string;
    filePolicyVersion: string;
    packerVersion: string;
    sourceType: "browser_folder" | "browser_zip" | "preindexed_manifest";
    sourceName: string;
    sourceFileCount: number;
    sourceSize: number;
    includedFileCount: number;
    includedSize: number;
    excludedFileCount: number;
    excludedSize: number;
  };
  corePacks: ArchiveManifestCorePack[];
  files: ArchiveManifestFile[];
};

export type ArchiveManifestCorePack = {
  id: string;
  sha256: string;
  size: number;
  uncompressedSize: number;
  fileCount: number;
  format: "zip";
  compression: "deflate-low";
};

export type ArchiveManifestFile = {
  path: string;
  pathSortKey: string;
  role: ArchiveFileRole;
  sha256: string;
  crc32: number;
  size: number;
  mtimeMs: number | null;
  storage:
    | {
        kind: "blob";
        blobSha256: string;
      }
    | {
        kind: "core_pack";
        packId: string;
        entry: string;
      };
};

export type ArchiveCommitMetadata = {
  work: {
    slug: string;
    originalTitle: string;
    chineseTitle: string | null;
    sortTitle: string | null;
    description: string | null;
    originalReleaseDate: string | null;
    originalReleasePrecision: "year" | "month" | "day" | "unknown";
    engineFamily: "rpg_maker_2000" | "rpg_maker_2003" | "mixed" | "unknown" | "other";
    engineDetail: string | null;
    usesManiacsPatch: boolean;
    iconBlobSha256: string | null;
    thumbnailBlobSha256: string | null;
    browsingImageBlobSha256s: string[];
    status: "draft" | "published" | "hidden";
    extra: Record<string, unknown>;
  };
  release: {
    key: string;
    label: string;
    baseVariant: "original" | "remake" | "other";
    variantLabel: string;
    type:
      | "original"
      | "translation"
      | "revision"
      | "localized_revision"
      | "demo"
      | "event_submission"
      | "patch_applied_full_release"
      | "repack"
      | "other";
    releaseDate: string | null;
    releaseDatePrecision: "year" | "month" | "day" | "unknown";
    sourceName: string | null;
    sourceUrl: string | null;
    executablePath: string | null;
    rightsNotes: string | null;
    status: "draft" | "published" | "hidden";
    extra: Record<string, unknown>;
  };
  archiveVersion: {
    key: string;
    label: string;
    variantLabel: string;
    language: string;
    isProofread: boolean;
    isImageEdited: boolean;
  };
  workTitles: Array<{
    title: string;
    language: string | null;
    titleType: "alias";
  }>;
  creators: Array<{
    slug: string;
    name: string;
    originalName: string | null;
    websiteUrl: string | null;
    extra: Record<string, unknown>;
  }>;
  workStaff: Array<{
    creatorSlug: string;
    roleKey: "author" | "scenario" | "graphics" | "music" | "translator" | "editor" | "publisher" | "other";
    roleLabel: string | null;
    notes: string | null;
  }>;
  releaseStaff: Array<{
    creatorSlug: string;
    roleKey: "author" | "translator" | "proofreader" | "image_editor" | "publisher" | "repacker" | "other";
    roleLabel: string | null;
    notes: string | null;
  }>;
  tags: string[];
  externalLinks: {
    work: Array<{
      label: string;
      url: string;
      linkType: "official" | "wiki" | "source" | "video" | "download_page" | "other";
    }>;
    release: Array<{
      label: string;
      url: string;
      linkType: "official" | "source" | "download_page" | "patch_note" | "other";
    }>;
  };
};

export type ArchiveCommitFile = ArchiveManifestFile & {
  storageKind: ArchiveStorageKind;
  blobSha256: string | null;
  corePackSha256: string | null;
  packEntryPath: string | null;
};

export type ExcludedFileTypeSummary = {
  fileType: string;
  fileCount: number;
  totalSizeBytes: number;
  examplePath: string;
};
