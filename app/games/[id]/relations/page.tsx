import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { requireAccountUser } from "@/lib/server/auth/account-user";
import { getRelationEditorCapabilities } from "@/lib/authz/permissions";
import { getGameWorkDetail } from "@/lib/server/db/game-library";
import { parsePositiveId } from "@/lib/server/http/request";
import { RelationCreateDialog, RelationManager } from "../relation-editor";

export const dynamic = "force-dynamic";

export default async function WorkRelationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const workId = parsePositiveId((await params).id, "work id");
  const user = await requireAccountUser(`/games/${workId}/relations`);
  const work = await getGameWorkDetail(workId);
  if (!work) notFound();

  const capabilities = getRelationEditorCapabilities(user);
  const canManage = Object.values(capabilities).some(Boolean);
  if (!canManage) redirect(`/games/${workId}`);

  const title = work.chineseTitle || work.originalTitle;
  const canCreate =
    capabilities.canCreateRelation || capabilities.canCreateTranslation;

  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-5 sm:py-8">
      <PageHeader
        actions={
          <>
            <BackLink href={`/games/${workId}`} label="返回作品" />
            {canCreate ? (
              <RelationCreateDialog
                canCreateRelation={capabilities.canCreateRelation}
                canCreateTranslation={capabilities.canCreateTranslation}
                language={work.language}
                workId={work.id}
              />
            ) : null}
          </>
        }
        subtitle={title}
        title="编辑关联"
      />
      <RelationManager
        {...capabilities}
        currentUserId={user.id}
        language={work.language}
        parallelTranslations={work.parallelTranslations}
        relations={work.relations}
        translations={work.translations}
        workId={work.id}
      />
    </main>
  );
}
