import type { ArchiveFileRole } from "@/lib/archive/file-policy";
import type { WorkMoreInfo } from "@/lib/work-more-info";

import type {
  CharacterPortraitChoice,
  CharacterSelection,
} from "@/lib/character-names";
import type { CreatorSelection } from "@/lib/creator-names";

export type ArchiveManifest = {
  schema: "viprpg-archive.manifest.v1";
  game: {
    originalTitle: string;
    chineseTitle: string | null;
    language: string;
    isOriginal: boolean;
    isTranslation: boolean;
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

export type ArchiveSourceManifest = {
  schema: ArchiveManifest["schema"];
  archiveVersion: Pick<
    ArchiveManifest["archiveVersion"],
    | "filePolicyVersion"
    | "packerVersion"
    | "sourceType"
    | "sourceFileCount"
    | "sourceSize"
    | "includedFileCount"
    | "includedSize"
    | "excludedFileCount"
    | "excludedSize"
  >;
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
      | "other";
    isOriginal: boolean;
    isTranslation: boolean;
    language: string;
    coverBlobSha256: string;
    previewBlobSha256s: string[];
    status: "processing" | "published" | "hidden";
    extra: Record<string, unknown> & {
      moreInfo?: WorkMoreInfo[];
      usesUnsupportedManiac?: boolean;
    };
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
    selection: CharacterSelection;
    portrait: CharacterPortraitChoice | null;
    faceSheetBlobSha256s: string[];
    roleKey: "main" | "supporting" | "cameo" | "mentioned" | "other";
    spoilerLevel: number;
    sortOrder: number | null;
    notes: string | null;
  }>;
  workStaff: Array<{
    selection: CreatorSelection;
    roleKey:
      | "author"
      | "scenario"
      | "graphics"
      | "music"
      | "planning"
      | "programming"
      | "translator"
      | "other";
    roleLabel: string | null;
    notes: string | null;
  }>;
  tags: string[];
};

export type ExcludedFileTypeSummary = {
  fileType: string;
  fileCount: number;
  totalSizeBytes: number;
  examplePath: string;
};
