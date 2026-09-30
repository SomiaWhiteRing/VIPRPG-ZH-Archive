import { getWorkRelationEditorCapabilities } from "@/app/.server/db/relations";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { getGameWorkRelations } from "@/app/.server/db/game-library";
import { redirectPage, throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { RelationCreateForm, RelationManager } from "../relation-editor";
import { useRouteRefresh } from "@/app/components/use-route-refresh";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const workId = parsePositiveId((await params).id, "work id");
  const user = await requireAccountUser(runtime, `/games/${workId}/relations`);
  const work = await getGameWorkRelations(runtime, workId);
  if (!work) throwNotFound();

  const capabilities = await getWorkRelationEditorCapabilities(runtime, workId, user);
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
  const { data, refresh } = useRouteRefresh(useLoaderData<typeof loader>());
  const { workId, user, work, capabilities, title, canCreate } =
    data;
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
              <RelationCreateForm
                canCreateRelation={capabilities.canCreateRelation}
                canCreateTranslation={capabilities.canCreateTranslation}
                language={work.language}
                workId={work.id}
                onSaved={refresh}
                excludedWorkIds={[
                  ...work.relations,
                  ...work.translations,
                  ...work.parallelTranslations,
                ].map((item) => item.workId)}
              />
            ) : null}
          </>
        }
        subtitle={title}
        title="作品关联"
      />
      <RelationManager
        {...capabilities}
        language={work.language}
        parallelTranslations={work.parallelTranslations}
        relations={work.relations}
        translations={work.translations}
        workId={work.id}
        onSaved={refresh}
      />
    </main>
  );
}
