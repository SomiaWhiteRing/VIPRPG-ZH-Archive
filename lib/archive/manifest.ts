import type { ArchiveFileRole, ArchiveStorageKind } from "@/lib/archive/file-policy";

export type ArchiveManifest = {
  schema: "viprpg-archive.manifest.v1";
  game: {
    originalTitle: string;
    chineseTitle: string | null;
    language: string;
    isOriginal: boolean;
  };
  archiveVersion: {
    sourceName: string | null;
    sourceUrl: string | null;
    createdAt: string;
    filePolicyVersion: string;
    packerVersion: string;
    sourceType: "browser_folder" | "browser_zip" | "preindexed_manifest";
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
  pathBytesB64?: string | null;
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
  game: {
    originalTitle: string;
    chineseTitle: string | null;
    description: string | null;
    originalReleaseDate: string | null;
    originalReleasePrecision: "year" | "month" | "day" | "unknown";
    engineFamily:
      | "rpg_maker_2000"
      | "rpg_maker_2003"
      | "rpg_maker_2003_maniac"
      | "rpg_maker_xp"
      | "rpg_maker_vx"
      | "rpg_maker_vx_ace"
      | "rpg_maker_mv"
      | "rpg_maker_mz"
      | "rpg_maker_unite"
      | "mixed"
      | "unknown"
      | "other";
    isOriginal: boolean;
    language: string;
    browsingImageBlobSha256s: string[];
    status: "draft" | "published" | "hidden";
    extra: Record<string, unknown>;
  };
  target: {
    mode: "create" | "update";
    workId: number | null;
  };
  archiveVersion: {
    sourceName: string | null;
    sourceUrl: string | null;
  };
  workTitles: Array<{
    title: string;
    language: string | null;
    titleType: "alias";
  }>;
  characters?: Array<{
    name: string;
    originalName: string | null;
    roleKey: "main" | "supporting" | "cameo" | "mentioned" | "other";
    spoilerLevel: number;
    sortOrder: number | null;
    notes: string | null;
  }>;
  creators: Array<{
    name: string;
    originalName: string | null;
    websiteUrl: string | null;
    extra: Record<string, unknown>;
  }>;
  workStaff: Array<{
    creatorName: string;
    roleKey: "author" | "scenario" | "graphics" | "music" | "translator" | "editor" | "publisher" | "proofreader" | "image_editor" | "other";
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
