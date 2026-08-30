import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { requireAccountUser } from "@/lib/server/auth/account-user";
import { getOwnedWorkForEdit } from "@/lib/server/db/game-library";
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

  return (
    <div>
      <PageHeader
        actions={<BackLink href="/me/uploads" label="返回我的上传" />}
        subtitle={work.distribution === "archive" ? "本站归档作品" : "外部下载作品"}
        title={work.chineseTitle || work.originalTitle}
      />
      <WorkEditClient
        work={{
          id: work.id,
          originalTitle: work.originalTitle,
          chineseTitle: work.chineseTitle,
          description: work.description,
          engineFamily: work.engineFamily,
          isOriginal: work.isOriginal,
          language: work.language,
          status: work.status as "published" | "hidden",
          aliases: work.aliases,
          tags: work.tags,
          characters: work.characters,
          authors: work.creators
            .filter((creator) => creator.roleKey === "author")
            .map((creator) => creator.name),
          distribution: work.distribution,
          externalDownloadUrl: work.externalDownloadUrl,
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
