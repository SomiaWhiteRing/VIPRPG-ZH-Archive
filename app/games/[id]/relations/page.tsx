import { requireAccountUser } from "@/app/.server/auth/account-user";
import { getGameWorkDetail } from "@/app/.server/db/game-library";
import { redirectPage, throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { getRelationEditorCapabilities } from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { RelationCreateDialog, RelationManager } from "../relation-editor";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const workId = parsePositiveId((await params).id, "work id");
  const user = await requireAccountUser(runtime, `/games/${workId}/relations`);
  const work = await getGameWorkDetail(runtime, workId);
  if (!work) throwNotFound();

  const capabilities = getRelationEditorCapabilities(user);
  const canManage = Object.values(capabilities).some(Boolean);
  if (!canManage) redirectPage(`/games/${workId}`);

  const title = work.chineseTitle || work.originalTitle;
  const canCreate =
    capabilities.canCreateRelation || capabilities.canCreateTranslation;

  return {
    workId,
    user: pickPageFields(user, ["id"]),
    work,
    capabilities,
    title,
    canCreate,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: [loaderData?.title || "游戏", "作品关联"] }, error);

export default function WorkRelationsPage() {
  const { workId, user, work, capabilities, title, canCreate } =
    useLoaderData<typeof loader>();
  return (
    <main
      key={`${work.id}:${user.id}`}
      className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-5 sm:py-8"
    >
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
        title="作品关联"
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
