import { getCurrentUser } from "@/app/.server/auth/current-user";
import { getGameWorkDetail } from "@/app/.server/db/game-library";
import { canPinWorkComments, listRootComments } from "@/app/.server/db/work-community";
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
import { formatNumber } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { tagHref } from "@/lib/user-tags";
import { CHARACTER_ROLE_LABELS, getPublicRelationCards } from "./public-relations";
import { AlertTriangle } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { WorkMediaGallery } from "./work-media-gallery";
import { WorkDescription } from "./work-description";
import { useWorkFavorite } from "@/app/components/work/use-work-favorite";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);
  const id = parsePositiveId((await params).id, "work id");
  const work = await getGameWorkDetail(runtime, id);
  if (!work) throwNotFound();
  const currentUser = await getCurrentUser(runtime);
  const [sidebar, comments, tags, canPinComments] = await Promise.all([
    loadWorkOverviewSidebar(runtime, id, currentUser),
    listRootComments(runtime, { kind: "work", id }, currentUser?.id ?? null, null),
    listWorkTagSummaries(runtime, id),
    canPinWorkComments(runtime, id, currentUser),
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
    tags,
    relationCards: getPublicRelationCards(work),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: loaderData?.title || "游戏详情" }, error);

export default function GameDetailPage() {
  const { work, sidebar, canPinComments, title, current, primaryMedia, media, tags: initialTags, comments, relationCards } = useLoaderData<typeof loader>();
  const favorite = useWorkFavorite(sidebar.community, initialTags);
  const { community, tags } = favorite;
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
            label: "评论",
            count: community.commentCount,
          },
          { href: `/games/${work.id}/collections`, label: "收藏与吐槽" },
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
              <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                <h2 className="m-0 text-base font-bold" id="comments-title">
                  评论
                </h2>
                <span className="font-mono text-xs text-muted max-[560px]:text-left">
                  按发帖时间排序
                </span>
              </div>
              <CommentPanel
                currentUserId={currentUser?.id ?? null}
                canPin={canPinComments}
                initialComments={comments.items}
                initialNextCursor={comments.nextCursor}
                target={{ kind: "work", id: work.id }}
              />
            </section>
          </>
        }
        sidebar={<WorkOverviewSidebar work={work} data={{ ...sidebar, community }} onFavoriteSaved={favorite.onSaved} favoriteSummary="tags" />}
      />
    </DetailPageShell>
  );
}
