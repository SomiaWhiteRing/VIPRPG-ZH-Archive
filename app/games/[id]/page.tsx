import { parseAccountPage } from "@/app/.server/auth/account-user";
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
import { WorkCard } from "@/app/components/work/work-card";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { DetailPageLayout, DetailPageShell } from "@/app/components/ui/detail-page-layout";
import { EmptyState } from "@/app/components/ui/empty-state";
import { WorkOverviewSidebar } from "@/app/components/work/work-overview-sidebar";
import { WorkPageHeader } from "@/app/components/work/work-page-header";
import { WorkViewTracker } from "@/app/components/work/work-view-tracker";
import { formatNumber } from "@/lib/format";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { tagHref } from "@/lib/user-tags";
import { getPublicRelationCards, publicRelationLabel } from "./public-relations";
import { AlertTriangle } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { isCharacterRoleKey } from "@/lib/character-names";
import { WorkMediaGallery } from "./work-media-gallery";
import { WorkDescription } from "./work-description";
import { WorkDiscussionSection, useWorkCollections } from "@/app/components/work/work-discussion-section";
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
    canonical: publicWork ? `${runtime.origin}/games/${work.id}` : undefined,
    locale: runtime.uiLocale,
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

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({
    title: loaderData?.title || translate(locale, "work.detail"),
    alternates: { canonical: loaderData?.canonical },
  }, error, locale);
};

export default function GameDetailPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const { work, sidebar, canPinComments, title, current, primaryMedia, media, tags: initialTags, comments, collections: initialCollections, relationCards } = useLoaderData<typeof loader>();
  const { collections, refreshCollections } = useWorkCollections(work.id, initialCollections);
  const favorite = useWorkFavorite(sidebar.community, initialTags);
  const { community, tags } = favorite;
  async function onFavoriteSaved(update: WorkFavoriteUpdate) {
    favorite.onSaved(update);
    await refreshCollections();
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
          { href: "#sec-intro", label: t("work.overview"), active: true },
          ...(current
            ? [
                {
                  href: `/play/${work.id}`,
                  label: t("work.play"),
                  reloadDocument: true,
                },
              ]
            : []),
          ...(media.length
            ? [{ href: "#sec-gallery", label: t("work.gallery"), count: media.length }]
            : []),
          ...(work.characters.length
            ? [
                {
                  href: "#sec-cast",
                  label: t("core.nav.characters"),
                  count: work.characters.length,
                },
              ]
            : []),
          ...(relationCards.length
            ? [
                {
                  href: "#sec-relations",
                  label: t("work.relations"),
                  count: relationCards.length,
                },
              ]
            : []),
          {
            href: "#sec-comments",
            label: t("work.comments"),
          },
        ]}
      />

      <DetailPageLayout
        sidebarLabel={t("work.sidebar")}
        main={
          <>
            <section
              aria-labelledby="intro-title"
              className="scroll-mt-28 py-4.5"
              id="sec-intro"
            >
              <div className="mb-3.5 flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-base font-bold" id="intro-title">
                  {t("work.intro")}
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
                  <span>{t("work.maniac")}</span>
                </div>
              ) : null}
              {work.description ? (
                <WorkDescription key={work.description} description={work.description} />
              ) : (
                <p className="text-sm text-muted">{t("work.noDescription")}</p>
              )}
              {tags.length ? (
                <div aria-label={t("library.tags")} className="mt-4 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <Link
                      className={tag.source === "public"
                        ? "inline-flex min-h-7.5 items-center gap-1.5 rounded-full border border-secondary/30 px-2.75 py-1 text-sm font-medium text-secondary hover:border-secondary hover:bg-secondary/10"
                        : "inline-flex min-h-7.5 items-center gap-1.5 rounded-full border border-primary/30 px-2.75 py-1 text-sm font-medium text-primary hover:border-primary hover:bg-primary/10"}
                      to={tagHref(tag.name, tag.source === "public" ? "all" : "user")}
                      key={tag.name}
                    >
                      {tag.name}
                      <small className="font-mono text-[10px] font-normal tabular-nums" aria-label={t("work.tagUses", { count: tag.usageCount })}>{formatNumber(tag.usageCount, locale)}</small>
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
                <div className="mb-3.5 flex items-baseline justify-between gap-4">
                  <h2 className="m-0 text-base font-bold" id="gallery-title">
                    {t("work.gallery")}
                  </h2>
                  <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted">
                    {t("work.galleryCount", { count: media.length })}
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
                <div className="mb-3.5 flex items-baseline justify-between gap-4">
                  <h2 className="m-0 text-base font-bold" id="cast-title">
                    {t("work.cast")}
                  </h2>
                  <Link
                    aria-label={t("work.allCast")}
                    className="shrink-0 whitespace-nowrap text-sm font-medium text-secondary hover:underline"
                    to={`/games/${work.id}/characters`}
                  >
                    {t("work.more")}
                  </Link>
                </div>
                <div
                  aria-label={t("work.castList")}
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
                        {t(`work.role.${isCharacterRoleKey(character.roleKey) ? character.roleKey : "other"}`)}
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
                <div className="mb-3.5 flex items-baseline justify-between gap-4">
                  <h2 className="m-0 text-base font-bold" id="relations-title">
                    {t("work.related")}
                  </h2>
                  {relationCards.length ? (
                    <Link
                      aria-label={t("work.allRelated")}
                      className="shrink-0 whitespace-nowrap text-sm font-medium text-secondary hover:underline"
                      to={`/games/${work.id}/related`}
                    >
                      {t("work.more")}
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
                          {publicRelationLabel(type, locale)}
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
                  <EmptyState title={t("work.noRelated")} variant="plain" />
                )}
              </section>
            ) : null}

            <WorkDiscussionSection
              workId={work.id}
              currentUserId={currentUser?.id ?? null}
              canPin={canPinComments}
              commentCount={community.commentCount}
              comments={comments}
              collections={collections}
            />
          </>
        }
        sidebar={<WorkOverviewSidebar work={work} data={{ ...sidebar, community }} onFavoriteSaved={onFavoriteSaved} favoriteSummary="tags" />}
      />
    </DetailPageShell>
  );
}
