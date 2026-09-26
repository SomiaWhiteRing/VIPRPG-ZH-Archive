import { getGameWorkDetail, getPublicGameWorkSummaries } from "@/app/.server/db/game-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { runtimeContext } from "@/app/.server/router-context";
import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { GameLibraryListRow } from "@/app/games/game-library-list-row";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { getPublicRelationCards } from "../public-relations";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const workId = parsePositiveId(args.params.id ?? "", "work id");
  const work = await getGameWorkDetail(runtime, workId);
  if (!work) throwNotFound();

  const relations = getPublicRelationCards(work);
  const summaries = await getPublicGameWorkSummaries(runtime, relations.map((item) => item.workId));
  const byId = new Map(summaries.map((item) => [item.id, item]));

  return {
    workId,
    title: work.chineseTitle || work.originalTitle,
    relations: relations.flatMap((item) => {
      const summary = byId.get(item.workId);
      return summary ? [{ ...item, work: summary }] : [];
    }),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({
    title: [loaderData?.title || "游戏", "关联作品"],
  }, error);

export default function WorkRelatedPage() {
  const { workId, title, relations } = useLoaderData<typeof loader>();
  const groups = new Map<string, typeof relations>();
  for (const relation of relations) {
    const group = groups.get(relation.type);
    if (group) group.push(relation);
    else groups.set(relation.type, [relation]);
  }

  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-5 sm:py-8">
      <PageHeader
        actions={<BackLink href={`/games/${workId}#sec-relations`} label="返回作品" />}
        subtitle={title}
        title="关联作品"
      />
      {
        relations.length ? (
          <div className="grid gap-7">
            {Array.from(groups, ([type, items], index) => (
              <section key={type} aria-labelledby={`relation-group-${index}`}>
                <header className="flex items-baseline gap-3 border-b border-border pb-3">
                  <h2 className="m-0 font-display text-xl font-bold" id={`relation-group-${index}`}>{type}</h2>
                </header>
                <ol className="divide-y divide-border border-b border-border">
                  {items.map((item) => (
                    <li key={item.key}>
                      <GameLibraryListRow work={item.work} />
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        ) : <EmptyState title="暂无公开关联作品。" />
      }
    </main>
  );
}
