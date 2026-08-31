import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { requireAccountUser } from "@/lib/server/auth/account-user";
import { getOwnedWorkForEdit } from "@/lib/server/db/game-library";
import { loadUploadSuggestions } from "@/app/upload/upload-suggestions";
import { WorkEditClient } from "./work-edit-client";

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
    <div>
      <PageHeader
        actions={<BackLink href="/me/uploads" label="返回我的上传" />}
        title={`维护资料：${work.chineseTitle || work.originalTitle}`}
      />
      <WorkEditClient
        currentUserId={user.id}
        suggestions={suggestions}
        work={{
          id: work.id,
          originalTitle: work.originalTitle,
          chineseTitle: work.chineseTitle,
          description: work.description,
          originalReleaseDate: work.originalReleaseDate,
          engineFamily: work.engineFamily,
          isOriginal: work.isOriginal,
          isTranslation: work.isTranslation,
          language: work.language,
          status: work.status as "published" | "hidden",
          aliases: work.aliases,
          tags: work.tags,
          characters: work.characters,
          authors: work.creators
            .filter((creator) => creator.roleKey === "author")
            .map((creator) => creator.name),
          translators: work.creators
            .filter((creator) => creator.roleKey === "translator")
            .map((creator) => creator.name),
          distribution: work.distribution,
          externalDownloadUrl: work.externalDownloadUrl,
          sourceUrl: work.sourceUrl,
          previewBlobSha256s: work.media
            .filter((media) => media.kind === "preview")
            .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
            .map((media) => media.blobSha256),
        }}
      />
    </div>
  );
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return id;
}
