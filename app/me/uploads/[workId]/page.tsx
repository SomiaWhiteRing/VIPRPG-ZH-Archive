import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { requireAccountUser } from "@/lib/server/auth/account-user";
import {
  getOwnedWorkForEdit,
  type UploaderWorkEdit,
} from "@/lib/server/db/game-library";
import { loadUploadSuggestions } from "@/app/upload/upload-suggestions";
import {
  UploadClient,
  type UploadInitialWork,
} from "@/app/upload/upload-client";

export const dynamic = "force-dynamic";

export default async function UploadedWorkPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const workId = parseId((await params).workId);
  const user = await requireAccountUser(`/me/uploads/${workId}`);
  const work = await getOwnedWorkForEdit(workId, user);
  if (!work) notFound();
  const suggestions = await loadUploadSuggestions();

  return (
    <div data-account-full-width>
      <PageHeader
        actions={<BackLink href="/me/uploads" label="返回我的上传" />}
        title={`编辑作品：${work.chineseTitle || work.originalTitle}`}
      />
      <UploadClient
        currentUser={{
          id: user.id,
          displayName: user.displayName,
          permissionKeys: user.permissionKeys,
        }}
        initialWork={{
          id: work.id,
          originalTitle: work.originalTitle,
          chineseTitle: work.chineseTitle,
          description: work.description,
          originalReleaseDate: work.originalReleaseDate,
          engineFamily: work.engineFamily as UploadInitialWork["engineFamily"],
          isOriginal: work.isOriginal,
          isTranslation: work.isTranslation,
          language: work.language,
          status: work.status as "published" | "hidden",
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
            roleKey: characterRole(character.roleKey),
            spoilerLevel: character.spoilerLevel,
            sortOrder: character.sortOrder ?? 0,
            notes: character.notes,
          })),
          authors: staffCredits(work, "author"),
          translators: staffCredits(work, "translator"),
          externalDownloadUrl: work.externalDownloadUrl,
          sourceUrl: work.sourceUrl,
          previewBlobSha256s: work.media
            .filter((media) => media.kind === "preview")
            .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
            .map((media) => media.blobSha256),
          currentArchive: work.currentArchive
            ? {
                name: work.currentArchive.sourceName,
                fileCount: work.currentArchive.sourceFileCount,
                sizeBytes: work.currentArchive.sourceSizeBytes,
              }
            : null,
        }}
        suggestions={suggestions}
      />
    </div>
  );
}

function staffCredits(
  work: UploaderWorkEdit,
  roleKey: "author" | "translator",
): UploadInitialWork["authors"] {
  return work.creators
    .filter((creator) => creator.roleKey === roleKey)
    .map((creator) => ({
      creator: {
        name: creator.name,
        originalName: creator.originalName,
        websiteUrl: creator.websiteUrl,
        extra: {},
      },
      staff: {
        creatorName: creator.name,
        roleKey,
        roleLabel: creator.roleLabel,
        notes: creator.notes,
      },
    }));
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return id;
}

function characterRole(
  value: string,
): "main" | "supporting" | "cameo" | "mentioned" | "other" {
  return value === "main" || value === "cameo" || value === "mentioned" || value === "other"
    ? value
    : "supporting";
}
