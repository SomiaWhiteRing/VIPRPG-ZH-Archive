import { parseAccountPage } from "@/app/.server/auth/account-user";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/app/components/ui/tabs";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { useState } from "react";
import { requestJson } from "@/lib/ui/api-response";
import type { WorkFavoriteUpdate } from "@/lib/user-tags";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { getGameWorkDetail } from "@/app/.server/db/game-library";
import { canPinWorkComments, listRootComments, listWorkCollections } from "@/app/.server/db/work-community";
import { listWorkTagSummaries } from "@/app/.server/db/user-work-tags";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { loadWorkOverviewSidebar } from "@/app/.server/work-overview-sidebar";
import { CommentPanel } from "@/app/components/comments/comment-panel";
import { WorkCard } from "@/app/components/work/work-card";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { DetailPageLayout, DetailPageShell } from "@/app/components/ui/detail-page-layout";
import { EmptyState } from "@/app/components/ui/empty-state";
import { WorkOverviewSidebar } from "@/app/components/work/work-overview-sidebar";
import { WorkPageHeader } from "@/app/components/work/work-page-header";
import { WorkViewTracker } from "@/app/components/work/work-view-tracker";
import { formatNumber, formatDate, formatExactTimestamp, parseTimestamp } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { tagHref } from "@/lib/user-tags";
import { CHARACTER_ROLE_LABELS, getPublicRelationCards } from "./public-relations";
import { AlertTriangle } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData, useSearchParams, useNavigate, useRevalidator } from "react-router";
import { WorkMediaGallery } from "./work-media-gallery";
import { WorkDescription } from "./work-description";
import { useWorkFavorite } from "@/app/components/work/use-work-favorite";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);
  const id = parsePositiveId((await params).id, "work id");
  const work = await getGameWorkDetail(runtime, id);
  if (!work) throwNotFound();
  const publicWork = work.status === "published" && work.audience === "public";
  const currentUser = await getCurrentUser(runtime);
  const page = parseAccountPage(new URL(args.request.url).searchParams.get("page") ?? undefined);
  const [sidebar, comments, tags, canPinComments, collections] = await Promise.all([
    loadWorkOverviewSidebar(runtime, id, currentUser, publicWork),
    listRootComments(runtime, { kind: "work", id }, currentUser?.id ?? null, null),
    listWorkTagSummaries(runtime, id),
    canPinWorkComments(runtime, id, currentUser),
    listWorkCollections(runtime, id, page, true),
  ]);
  return {
    work,
    sidebar,
    canPinComments,
    title: work.chineseTitle || work.originalTitle,
    current: work.archiveVersions[0] ?? null,
    primaryMedia: work.coverBlobSha256,
    media: [...work.media].sort((a, b) => Number(b.role === "cover") - Number(a.role === "cover") || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    comments,
    collections,
    tags,
    relationCards: getPublicRelationCards(work),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: loaderData?.title || "游戏详情" }, error);

export default function GameDetailPage() {
  const { work, sidebar, canPinComments, title, current, primaryMedia, media, tags: initialTags, comments, collections: initialCollections, relationCards } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const activeTab = searchParams.get("tab") === "collections" ? "collections" : "comments";
  const [snapshot, setSnapshot] = useState({ source: initialCollections, collections: initialCollections });
  const collections = snapshot.source === initialCollections ? snapshot.collections : initialCollections;
  const favorite = useWorkFavorite(sidebar.community, initialTags);
  const { community, tags } = favorite;
  async function onFavoriteSaved(update: WorkFavoriteUpdate) {
    favorite.onSaved(update);
    const result = await requestJson<{ ok: true; collections: typeof collections }>(
      `/api/works/${work.id}/collections?notes=1&page=${collections.page}`, {}, "吐槽列表加载失败",
    );
    setSnapshot({ source: initialCollections, collections: result.collections });
  }
  const { currentUser } = sidebar;
  const relationGroups = new Map<string, typeof relationCards>();
  for (const relation of relationCards) {
    const group = relationGroups.get(relation.type);
    if (group) group.push(relation);
    else relationGroups.set(relation.type, [relation]);
  }

  return (
    <DetailPageShell key={`${work.id}:${currentUser?.id ?? "anonymous"}`}>
      <WorkViewTracker workId={work.id} />
      <WorkPageHeader
        chineseTitle={work.chineseTitle}
        coverBlobSha256={primaryMedia}
        engineFamily={work.engineFamily}
        language={work.language}
        originalTitle={work.originalTitle}
        tabs={[
          { href: "#sec-intro", label: "概览", active: true },
          ...(current
            ? [
                {
                  href: `/play/${work.id}`,
                  label: "在线游玩",
                  reloadDocument: true,
                },
              ]
            : []),
          ...(media.length
            ? [{ href: "#sec-gallery", label: "画廊", count: media.length }]
            : []),
          ...(work.characters.length
            ? [
                {
                  href: "#sec-cast",
                  label: "角色",
                  count: work.characters.length,
                },
              ]
            : []),
          ...(relationCards.length
            ? [
                {
                  href: "#sec-relations",
                  label: "关联",
                  count: relationCards.length,
                },
              ]
            : []),
          {
            href: "#sec-comments",
            label: "评论与吐槽",
          },
        ]}
      />

      <DetailPageLayout
        sidebarLabel="作品操作与资料"
        main={
          <>
            <section
              aria-labelledby="intro-title"
              className="scroll-mt-28 py-4.5"
              id="sec-intro"
            >
              <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                <h2 className="m-0 text-base font-bold" id="intro-title">
                  简介
                </h2>
              </div>
              {work.usesUnsupportedManiac ? (
                <div
                  className="mb-3.5 flex gap-2.5 rounded-lg border border-[#b47800]/35 bg-[#fff7df] px-3 py-2.5 text-sm text-[#684a00] dark:border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-200"
                  role="note"
                >
                  <AlertTriangle
                    aria-hidden
                    className="mt-0.5 shrink-0"
                    size={16}
                  />
                  <span>该游戏使用了 EasyRPG 不支持的 Maniac 语法，可能无法正常游玩。</span>
                </div>
              ) : null}
              {work.description ? (
                <WorkDescription key={work.description} description={work.description} />
              ) : (
                <p className="text-sm text-muted">暂无简介。</p>
              )}
              {tags.length ? (
                <div aria-label="标签" className="mt-4 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <Link
                      className={tag.source === "public"
                        ? "inline-flex min-h-7.5 items-center gap-1.5 rounded-full border border-secondary/30 px-2.75 py-1 text-sm font-medium text-secondary hover:border-secondary hover:bg-secondary/10"
                        : "inline-flex min-h-7.5 items-center gap-1.5 rounded-full border border-primary/30 px-2.75 py-1 text-sm font-medium text-primary hover:border-primary hover:bg-primary/10"}
                      to={tagHref(tag.name, tag.source === "public" ? "all" : "user")}
                      key={tag.name}
                    >
                      {tag.name}
                      <small className="font-mono text-[10px] font-normal tabular-nums" aria-label={`${tag.usageCount} 次使用`}>{formatNumber(tag.usageCount)}</small>
                    </Link>
                  ))}
                </div>
              ) : null}
            </section>

            {media.length ? (
              <section
                aria-labelledby="gallery-title"
                className="scroll-mt-28 border-t border-border py-4.5"
                id="sec-gallery"
              >
                <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                  <h2 className="m-0 text-base font-bold" id="gallery-title">
                    画廊
                  </h2>
                  <span className="font-mono text-xs text-muted max-[560px]:text-left">
                    {media.length} 张
                  </span>
                </div>
                <WorkMediaGallery items={media} title={title} />
              </section>
            ) : null}

            {work.characters.length ? (
              <section
                aria-labelledby="cast-title"
                className="scroll-mt-28 border-t border-border py-4.5"
                id="sec-cast"
              >
                <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                  <h2 className="m-0 text-base font-bold" id="cast-title">
                    登场角色
                  </h2>
                  <Link
                    aria-label="查看全部登场角色"
                    className="text-sm font-medium text-secondary hover:underline"
                    to={`/games/${work.id}/characters`}
                  >
                    更多
                  </Link>
                </div>
                <div
                  aria-label="角色列表"
                  className="flex gap-2.5 overflow-x-auto pb-1.5 [scroll-snap-type:x_proximity] scrollbar-thin"
                >
                  {work.characters.map((character, index) => (
                    <Link
                      className="group grid basis-24 shrink-0 content-start gap-1 text-foreground"
                      to={`/characters/${character.id}`}
                      key={`${character.id}:${index}`}
                    >
                      <CharacterPortrait
                        className="w-full text-2xl transition-shadow duration-150 group-hover:shadow-[0_3px_10px_rgb(23_33_43/14%)]"
                        displayName={character.displayName}
                        portrait={character.portrait}
                        size={96}
                        toneKey={index}
                      />
                      <span className="text-sm font-semibold wrap-anywhere">
                        {character.displayName}
                      </span>
                      <span
                        className={`inline-flex justify-self-start rounded-full border border-border bg-card px-2 py-[0.05rem] font-mono text-xs text-muted ${character.roleKey === "main" ? "border-primary/40 bg-primary/10 text-secondary" : ""}`}
                      >
                        {CHARACTER_ROLE_LABELS[character.roleKey] ?? "其他"}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {relationCards.length ? (
              <section
                aria-labelledby="relations-title"
                className="scroll-mt-28 border-t border-border py-4.5"
                id="sec-relations"
              >
                <span aria-hidden="true" className="sr-only" id="relations" />
                <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                  <h2 className="m-0 text-base font-bold" id="relations-title">
                    关联作品
                  </h2>
                  {relationCards.length ? (
                    <Link
                      aria-label="查看全部关联作品"
                      className="text-sm font-medium text-secondary hover:underline"
                      to={`/games/${work.id}/related`}
                    >
                      更多
                    </Link>
                  ) : null}
                </div>
                {relationCards.length ? (
                  <div className="flex snap-x snap-proximity items-stretch gap-3 overflow-x-auto pb-1.5 scrollbar-thin">
                    {Array.from(relationGroups, ([type, relations]) => (
                      <div
                        className="shrink-0 border-l border-border pl-3 first:border-l-0 first:pl-0"
                        key={type}
                      >
                        <h3 className="mb-2 text-sm font-normal text-muted">
                          {type}
                        </h3>
                        <div className="flex gap-3">
                          {relations.map((relation) => (
                            <div className="w-[150px] shrink-0 snap-start" key={relation.key}>
                              <WorkCard
                                href={relation.href}
                                title={relation.title}
                                coverBlobSha256={relation.coverBlobSha256}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="暂无公开关联作品。" variant="plain" />
                )}
              </section>
            ) : null}

            <section
              aria-labelledby="comments-title"
              className="scroll-mt-28 border-t border-border py-4.5"
              id="sec-comments"
            >
              <Tabs value={activeTab} onValueChange={(value) => {
                setSearchParams((params) => {
                  params.set("tab", value);
                  return params;
                }, { preventScrollReset: true });
              }}>
                <TabsList aria-label="作品评论与吐槽" id="comments-title">
                  <TabsTrigger value="comments">评论（{formatNumber(community.commentCount)}）</TabsTrigger>
                  <TabsTrigger value="collections">吐槽（{formatNumber(collections.total)}）</TabsTrigger>
                </TabsList>
                <TabsContent value="comments" forceMount className="data-[state=inactive]:hidden">
                  <CommentPanel
                    onChanged={() => { void revalidator.revalidate(); }}
                    currentUserId={currentUser?.id ?? null}
                    canPin={canPinComments}
                    initialComments={comments.items}
                    initialNextCursor={comments.nextCursor}
                    target={{ kind: "work", id: work.id }}
                  />
                </TabsContent>
                <TabsContent value="collections">
                  {collections.items.length ? (
                    <ul className="grid gap-7">
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
                            {entry.note ? <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-black dark:text-foreground">{entry.note}</p> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : <EmptyState title="暂无吐槽。" />}
                  <PaginationLinks page={collections.page} pageSize={collections.pageSize} total={collections.total}
                    onPageChange={(page) => {
                      const params = new URLSearchParams(searchParams);
                      params.set("tab", "collections");
                      params.set("page", String(page));
                      void navigate(`?${params}#sec-comments`, { preventScrollReset: true });
                    }} />
                </TabsContent>
              </Tabs>
            </section>
          </>
        }
        sidebar={<WorkOverviewSidebar work={work} data={{ ...sidebar, community }} onFavoriteSaved={onFavoriteSaved} favoriteSummary="tags" />}
      />
    </DetailPageShell>
  );
}
