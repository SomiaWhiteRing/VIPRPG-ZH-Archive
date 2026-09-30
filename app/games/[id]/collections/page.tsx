import { parseAccountPage } from "@/app/.server/auth/account-user";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { getGameWorkDetail } from "@/app/.server/db/game-library";
import { listWorkCollections } from "@/app/.server/db/work-community";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { runtimeContext } from "@/app/.server/router-context";
import { loadWorkOverviewSidebar } from "@/app/.server/work-overview-sidebar";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { DetailPageLayout, DetailPageShell } from "@/app/components/ui/detail-page-layout";
import { EmptyState } from "@/app/components/ui/empty-state";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { WorkOverviewSidebar } from "@/app/components/work/work-overview-sidebar";
import { WorkPageHeader } from "@/app/components/work/work-page-header";
import { WorkViewTracker } from "@/app/components/work/work-view-tracker";
import { formatDate, formatExactTimestamp, parseTimestamp } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useWorkFavorite } from "@/app/components/work/use-work-favorite";
import { requestJson } from "@/lib/ui/api-response";
import { useEffect, useState } from "react";
import type { WorkFavoriteUpdate } from "@/lib/user-tags";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const id = parsePositiveId(args.params.id ?? "", "work id");
  const work = await getGameWorkDetail(runtime, id);
  if (!work) throwNotFound();
  const currentUser = await getCurrentUser(runtime);
  const page = parseAccountPage(new URL(args.request.url).searchParams.get("page") ?? undefined);
  const [sidebar, collections] = await Promise.all([
    loadWorkOverviewSidebar(runtime, id, currentUser),
    listWorkCollections(runtime, id, page),
  ]);
  return { work, sidebar, collections };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({
    title: [loaderData?.work.chineseTitle || loaderData?.work.originalTitle || "游戏", "收藏与吐槽"],
    page: loaderData?.collections.page,
  }, error);

export default function WorkCollectionsPage() {
  const { work, sidebar, collections: initialCollections } = useLoaderData<typeof loader>();
  const favorite = useWorkFavorite(sidebar.community);
  const [snapshot, setSnapshot] = useState({ source: initialCollections, collections: initialCollections });
  const collections = snapshot.source === initialCollections ? snapshot.collections : initialCollections;
  useEffect(() => {
    const title = pageMetaDescriptors({ title: [work.chineseTitle || work.originalTitle, "收藏与吐槽"], page: collections.page })
      .find((descriptor) => "title" in descriptor);
    if (title && "title" in title && typeof title.title === "string") document.title = title.title;
  }, [work.chineseTitle, work.originalTitle, collections.page]);
  async function onFavoriteSaved(update: WorkFavoriteUpdate) {
    favorite.onSaved(update);
    const result = await requestJson<{ ok: true; collections: typeof collections }>(
      `/api/works/${work.id}/collections?page=${collections.page}`, {}, "收藏列表加载失败",
    );
    setSnapshot({ source: initialCollections, collections: result.collections });
  }
  const current = work.archiveVersions[0] ?? null;
  return (
    <DetailPageShell key={`${work.id}:${sidebar.currentUser?.id ?? "anonymous"}`}>
      <WorkViewTracker workId={work.id} />
      <WorkPageHeader
        chineseTitle={work.chineseTitle}
        coverBlobSha256={work.coverBlobSha256}
        engineFamily={work.engineFamily}
        language={work.language}
        originalTitle={work.originalTitle}
        tabs={[
          { href: `/games/${work.id}`, label: "概览" },
          ...(current ? [{ href: `/play/${work.id}`, label: "在线游玩", reloadDocument: true }] : []),
          { href: `/games/${work.id}/collections`, label: "收藏与吐槽", active: true },
        ]}
      />
      <DetailPageLayout
        sidebarLabel="作品操作与资料"
        sidebar={<WorkOverviewSidebar work={work} data={{ ...sidebar, community: favorite.community }} onFavoriteSaved={onFavoriteSaved} />}
        main={
          <section aria-labelledby="collections-title" className="py-4.5">
            {collections.items.length ? (
              <ul className="grid gap-x-7 gap-y-7 sm:grid-cols-2">
                {collections.items.map((entry) => (
                  <li className="flex min-w-0 items-start gap-3.5" key={entry.userId}>
                    <Link className="shrink-0" to={`/users/${entry.userId}`}>
                      <UserAvatar avatarBlobSha256={entry.avatarBlobSha256} displayName={entry.displayName} size={48} />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="border-b border-border pb-1">
                        <Link className="wrap-anywhere text-sm font-bold text-foreground hover:text-primary hover:underline" to={`/users/${entry.userId}`}>
                          {entry.displayName}
                        </Link>
                      </div>
                      <time className="mt-1 block text-xs text-muted" dateTime={parseTimestamp(entry.favoritedAt).toISOString()} title={formatExactTimestamp(entry.favoritedAt)}>
                        {formatDate(entry.favoritedAt)}
                      </time>
                      {entry.note ? <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-black">{entry.note}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="暂无公开收藏。" />}
            <PaginationLinks basePath={`/games/${work.id}/collections`} page={collections.page} pageSize={collections.pageSize} total={collections.total} />
          </section>
        }
      />
    </DetailPageShell>
  );
}
