import type { UploadInitialWork } from "@/app/upload/upload-client";
import type { AdminWorkEdit } from "@/lib/dto/db/game-library";
import { isCharacterRoleKey } from "@/lib/character-names";
import { isExtraStaffRole } from "@/lib/staff-credits";

export function uploadInitialWork(work: AdminWorkEdit): UploadInitialWork {
  const staff = work.creators.map((creator) => ({
    selection: {
      kind: "existing" as const,
      creatorId: creator.id,
      name: creator.name,
      displayName: creator.displayName,
    },
    roleKey: creator.roleKey as UploadInitialWork["authors"][number]["roleKey"],
    roleLabel: creator.roleLabel,
    notes: creator.notes,
  }));
  return {
    id: work.id,
    originalTitle: work.originalTitle,
    chineseTitle: work.chineseTitle,
    description: work.description,
    genre: work.genre,
    moreInfo: work.moreInfo,
    usesUnsupportedManiac: work.usesUnsupportedManiac,
    originalReleaseDate: work.originalReleaseDate,
    engineFamily: work.engineFamily as UploadInitialWork["engineFamily"],
    isOriginal: work.isOriginal,
    isTranslation: work.isTranslation,
    language: work.language,
    status: work.status === "published" ? "published" : "hidden",
    aliases: work.aliases,
    tags: work.tags,
    characters: work.characters,
    characterCredits: work.characterCredits.map((character) => ({
      selection: {
        kind: "existing" as const,
        characterId: character.id,
        originalName: character.originalName,
        displayName: character.displayName,
      },
      portrait: character.portraitChoice,
      faceSheetBlobSha256s: [],
      roleKey: isCharacterRoleKey(character.roleKey) ? character.roleKey : "supporting",
      spoilerLevel: character.spoilerLevel,
      sortOrder: character.sortOrder ?? 0,
      notes: character.notes,
    })),
    authors: staff.filter((credit) => credit.roleKey === "author"),
    translators: staff.filter((credit) => credit.roleKey === "translator"),
    extraStaff: staff.filter((credit) => isExtraStaffRole(credit.roleKey)),
    externalDownloadUrl: work.externalLinks.find((link) => link.linkType === "download_page")?.url ?? null,
    archiveSourceUrl: work.currentArchive?.sourceUrl ?? null,
    coverBlobSha256: work.media.find((media) => media.role === "cover")?.blobSha256 ?? "",
    previewBlobSha256s: work.media.filter((media) => media.role === "preview")
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
      .map((media) => media.blobSha256),
    currentArchive: work.currentArchive ? {
      name: work.currentArchive.sourceName,
      usesSharedPlayer: work.currentArchive.usesSharedPlayer,
      fileCount: work.currentArchive.sourceFileCount,
      sizeBytes: work.currentArchive.sourceSizeBytes,
    } : null,
  };
}
