import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { UploadClient, type UploadInitialWork } from "@/app/upload/upload-client";
import { hasPermission } from "@/lib/authz/permissions";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { getOwnedWorkForEdit } from "@/lib/server/db/game-library";
import { isArchiveEngineFamily } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function UploadWorkVersionPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const workId = parseId((await params).workId);
  const currentUser = await getCurrentUserFromCookies();
  if (!currentUser) redirect(`/login?next=${encodeURIComponent(`/upload/${workId}`)}`);
  if (
    !hasPermission(currentUser, "import_job.create") ||
    !hasPermission(currentUser, "work.update_own")
  ) {
    redirect("/");
  }
  const work = await getOwnedWorkForEdit(workId, currentUser);
  if (!work || work.distribution !== "archive" || !isArchiveEngineFamily(work.engineFamily)) notFound();
  const initialWork: UploadInitialWork = {
    id: work.id,
    originalTitle: work.originalTitle,
    chineseTitle: work.chineseTitle,
    aliases: work.aliases,
    description: work.description,
    engineFamily: work.engineFamily,
    language: work.language,
    isOriginal: work.isOriginal,
    status: work.status === "hidden" ? "hidden" : "published",
    tags: work.tags,
    characterCredits: work.characterCredits.map((character) => ({
      name: character.primaryName,
      originalName: character.originalName,
      roleKey: characterRole(character.roleKey),
      spoilerLevel: character.spoilerLevel,
      sortOrder: character.sortOrder,
      notes: character.notes,
    })),
    authorCredits: work.creators
      .filter((creator) => creator.roleKey === "author")
      .map((creator) => ({
        creator: {
          name: creator.name,
          originalName: creator.originalName,
          websiteUrl: creator.websiteUrl,
          extra: {},
        },
        staff: {
          creatorName: creator.name,
          roleKey: "author",
          roleLabel: creator.roleLabel,
          notes: creator.notes,
        },
      })),
    previewBlobSha256s: work.media
      .filter((media) => media.kind === "preview")
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
      .map((media) => media.blobSha256),
  };
  return (
    <main>
      <PageHeader
        actions={<BackLink href={`/me/uploads/${work.id}`} label="返回作品维护" />}
        subtitle="文件上传开始后仍可继续填写或修改资料。"
        title={`上传新版本：${work.chineseTitle || work.originalTitle}`}
      />
      <UploadClient
        currentUser={{
          id: currentUser.id,
          permissionKeys: currentUser.permissionKeys,
        }}
        initialWork={initialWork}
      />
    </main>
  );
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return id;
}

function characterRole(
  value: string,
): UploadInitialWork["characterCredits"][number]["roleKey"] {
  return value === "main" || value === "cameo" || value === "mentioned" || value === "other"
    ? value
    : "supporting";
}
