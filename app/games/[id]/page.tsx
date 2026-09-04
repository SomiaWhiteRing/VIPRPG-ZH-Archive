import { Card } from "@/app/components/ui/card";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { WorkCommunityStats } from "@/app/components/work/work-community-stats";
import { WorkPageHeader } from "@/app/components/work/work-page-header";
import {
  WorkPageLayout,
  WorkPageShell,
  WorkSidebar,
} from "@/app/components/work/work-page-layout";
import { WorkSidebarInfo } from "@/app/components/work/work-sidebar-info";
import { WorkViewTracker } from "@/app/components/work/work-view-tracker";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import { getRelationEditorCapabilities } from "@/lib/authz/permissions";
import { formatNumber } from "@/lib/format";
import {
  WORK_RELATION_TYPES,
  languageLabel,
  relationLabel,
} from "@/lib/labels";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { listCatalogs, listCatalogsContainingWork } from "@/lib/server/db/catalogs";
import {
  getGameWorkDetail,
  type GameTranslationRelation,
  type GameWorkRelation,
} from "@/lib/server/db/game-library";
import {
  getWorkCommunitySummary,
  listPickerEmojis,
  listRootComments,
} from "@/lib/server/db/work-community";
import { parsePositiveId } from "@/lib/server/http/request";
import { publicCopy } from "@/lib/public-copy";
import { AlertTriangle, ExternalLink, Link2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkActionBar } from "./work-action-bar";
import { WorkCommunityPanel } from "./work-community-panel";
import {
  CatalogAddDialog,
  WorkEngagementActions,
} from "./work-engagement-actions";
import { WorkMediaGallery } from "./work-media-gallery";

export const dynamic = "force-dynamic";

const CHARACTER_ROLE_LABELS: Record<string, string> = {
  main: "主角",
  supporting: "配角",
  cameo: "客串",
  mentioned: "提及",
  other: "其他",
};

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = parsePositiveId((await params).id, "work id");
  const work = await getGameWorkDetail(id);
  if (!work) notFound();

  const currentUser = await getCurrentUserFromCookies();
  const relationCapabilities = getRelationEditorCapabilities(currentUser);
  const title = work.chineseTitle || work.originalTitle;
  const current = work.archiveVersions[0] ?? null;
  const externalDownload =
    work.externalLinks.find((link) => link.linkType === "download_page") ?? null;
  const primaryMedia =
    work.media.find((media) => media.isPrimary)?.blobSha256 ??
    work.previewBlobSha256;
  const media = [...work.media].sort((a, b) => {
    if (a.blobSha256 === primaryMedia) return -1;
    if (b.blobSha256 === primaryMedia) return 1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  const [community, comments, emojis, catalogs, containingCatalogs] = await Promise.all([
    getWorkCommunitySummary(work.id, currentUser?.id ?? null),
    listRootComments(work.id, currentUser?.id ?? null, null),
    listPickerEmojis(),
    currentUser ? listCatalogs() : Promise.resolve([]),
    listCatalogsContainingWork(work.id),
  ]);
  const userCatalogs = currentUser
    ? catalogs.filter((catalog) => catalog.ownerUserId === currentUser.id)
    : [];
  const relatedTranslations = dedupeTranslations([
    ...work.translations,
    ...work.parallelTranslations,
  ]).sort(compareTranslations);
  const orderedRelations = WORK_RELATION_TYPES.flatMap((type) =>
    work.relations
      .filter((relation) => relation.relationType === type)
      .sort(compareRelatedWorks),
  );
  const relationCards = [
    ...relatedTranslations.map((item) => ({
      key: `translation-${item.workId}`,
      href: `/games/${item.workId}`,
      type: `${item.role === "original" ? "原版" : "译版"} · ${languageLabel(item.language)}`,
      title: item.title,
      previewBlobSha256: item.previewBlobSha256 ?? null,
    })),
    ...orderedRelations.map((item) => ({
      key: `relation-${item.id}`,
      href: `/games/${item.workId}`,
      type: relationLabel(item.relationType),
      title: item.title,
      previewBlobSha256: item.previewBlobSha256 ?? null,
    })),
  ];
  const showRelationEditor =
    relationCapabilities.canCreateRelation ||
    relationCapabilities.canCreateTranslation ||
    relationCapabilities.canUpdate ||
    relationCapabilities.canDeleteRelation ||
    relationCapabilities.canDeleteTranslation;
  const externalLinks = work.externalLinks.filter(
    (link) => link.linkType !== "download_page",
  );

  return (
    <WorkPageShell>
      <WorkViewTracker workId={work.id} />
      <WorkPageHeader
        aliases={work.aliases}
        chineseTitle={work.chineseTitle}
        engineFamily={work.engineFamily}
        language={work.language}
        originalTitle={work.originalTitle}
        tabs={[
          { href: "#sec-intro", label: "概览", active: true },
          ...(current ? [{ href: `/play/${current.id}`, label: "在线游玩" }] : []),
          ...(media.length ? [{ href: "#sec-gallery", label: "截图", count: media.length }] : []),
          ...(work.characters.length ? [{ href: "#sec-cast", label: "角色", count: work.characters.length }] : []),
          ...(relationCards.length ? [{ href: "#sec-relations", label: "关联", count: relationCards.length }] : []),
          { href: "#sec-comments", label: "评论", count: community.commentCount },
        ]}
      />

      <WorkPageLayout
        main={
          <>
          <section aria-labelledby="intro-title" className="scroll-mt-20 py-4.5" id="sec-intro">
            <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
              <h2 className="m-0 text-base font-bold" id="intro-title">简介</h2>
              {work.distribution === "external" ? (
                <span className="font-mono text-xs text-muted max-[560px]:text-left">外部发布 · 未收录归档</span>
              ) : null}
            </div>
            {work.engineFamily === "rpg_maker_2003_maniac" ? (
              <div className="mb-3.5 flex gap-2.5 rounded-lg border border-[#b47800]/35 bg-[#fff7df] px-3 py-2.5 text-sm text-[#684a00]" role="note">
                <AlertTriangle aria-hidden className="mt-0.5 shrink-0" size={16} />
                <span>该游戏使用 Maniac，可能无法用 EasyRPG 正常游玩。</span>
              </div>
            ) : null}
            {work.description ? (
              <p className="m-0 leading-[1.85] wrap-anywhere">
                {publicCopy(work.description)}
              </p>
            ) : (
              <p className="text-sm text-muted">暂无简介。</p>
            )}
            {work.tags.length ? (
              <div aria-label="标签" className="mt-4 flex flex-wrap gap-2">
                {work.tags.map((tag) => (
                  <Link
                    className="inline-flex min-h-7.5 items-center rounded-full border border-primary/30 px-2.75 py-1 text-sm font-medium text-[#1f6f67] hover:border-primary hover:bg-primary/10"
                    href={`/games?tag=${tag.id}`}
                    key={tag.id}
                  >
                    {tag.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </section>

          {media.length ? (
            <section aria-labelledby="gallery-title" className="scroll-mt-20 border-t border-border py-4.5" id="sec-gallery">
              <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                <h2 className="m-0 text-base font-bold" id="gallery-title">截图</h2>
                <span className="font-mono text-xs text-muted max-[560px]:text-left">{media.length} 张 · 点击放大</span>
              </div>
              <WorkMediaGallery items={media} title={title} />
            </section>
          ) : null}

          {work.characters.length ? (
            <section aria-labelledby="cast-title" className="scroll-mt-20 border-t border-border py-4.5" id="sec-cast">
              <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                <h2 className="m-0 text-base font-bold" id="cast-title">登场角色</h2>
                <span className="font-mono text-xs text-muted max-[560px]:text-left">{work.characters.length} 项</span>
              </div>
              <div aria-label="角色列表" className="flex gap-2.5 overflow-x-auto pb-1.5 [scroll-snap-type:x_proximity] scrollbar-thin">
                {work.characters.map((character, index) => (
                  <Link
                    className="group grid basis-29 shrink-0 content-start gap-1 text-foreground max-[560px]:basis-27"
                    href={`/games?character=${character.id}`}
                    key={`${character.id}:${index}`}
                  >
                    <CharacterPortrait
                      className="w-full text-2xl transition-shadow duration-150 group-hover:shadow-[0_3px_10px_rgb(23_33_43/14%)]"
                      displayName={character.displayName}
                      portrait={character.portrait}
                      size={116}
                      toneKey={index}
                    />
                    <span className="text-sm font-semibold wrap-anywhere">{character.displayName}</span>
                    <span className={`inline-flex justify-self-start rounded-full border border-border bg-card px-2 py-[0.05rem] font-mono text-xs text-muted ${character.roleKey === "main" ? "border-primary/40 bg-primary/10 text-[#1f6f67]" : ""}`}>
                      {CHARACTER_ROLE_LABELS[character.roleKey] ?? "其他"}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {relationCards.length ? (
            <section aria-labelledby="relations-title" className="scroll-mt-20 border-t border-border py-4.5" id="sec-relations">
              <span aria-hidden="true" className="sr-only" id="relations" />
              <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                <h2 className="m-0 text-base font-bold" id="relations-title">关联作品</h2>
                {relationCards.length ? (
                  <span className="font-mono text-xs text-muted max-[560px]:text-left">{relationCards.length} 项</span>
                ) : null}
              </div>
              {relationCards.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-4">
                  {relationCards.map((relation) => (
                    <Link className="group grid min-w-0 content-start gap-1.5" href={relation.href} key={relation.key}>
                      <span className="font-mono text-xs tracking-[0.04em] text-muted">{relation.type}</span>
                      <span className="relative block aspect-4/3 overflow-hidden rounded-lg border border-border bg-[#e7ebe6] group-hover:border-primary group-hover:shadow-[0_2px_8px_rgb(23_33_43/10%)]">
                        {relation.previewBlobSha256 ? (
                          <Image
                            alt=""
                            className="object-cover"
                            fill
                            sizes="(max-width: 560px) 78vw, 180px"
                            src={`/api/media/blobs/${relation.previewBlobSha256}`}
                            unoptimized
                          />
                        ) : (
                          <span className="grid h-full place-items-center bg-rm2k-green-1 font-serif text-2xl font-bold text-white" aria-hidden="true">
                            {relation.title.slice(0, 1)}
                          </span>
                        )}
                      </span>
                      <span className="text-sm font-semibold leading-[1.45] text-[#1f6f67] wrap-anywhere group-hover:underline">{relation.title}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">暂无公开关联作品。</p>
              )}
            </section>
          ) : null}

          <section aria-labelledby="comments-title" className="scroll-mt-20 border-t border-border py-4.5" id="sec-comments">
            <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
              <h2 className="m-0 text-base font-bold" id="comments-title">评论</h2>
              <span className="font-mono text-xs text-muted max-[560px]:text-left">按发帖时间排序</span>
            </div>
            <WorkCommunityPanel
              currentUserId={currentUser?.id ?? null}
              emojis={emojis}
              initialComments={comments.items}
              initialNextCursor={comments.nextCursor}
              workId={work.id}
            />
          </section>
          </>
        }
        sidebar={
          <WorkSidebar
            engagement={
              <WorkEngagementActions
                currentUserId={currentUser?.id ?? null}
                initialFavorited={community.favoritedByMe}
                workId={work.id}
              />
            }
            extras={
              <>
                {currentUser ? (
                  <div aria-label="条目补充操作" className="order-2 flex items-center gap-1 px-2 max-[980px]:w-full">
                    {showRelationEditor ? (
                      <Link
                        className="min-w-0 flex-1 shrink px-1 text-center text-sm font-medium text-[#1f6f67] hover:underline"
                        href={`/games/${work.id}/relations`}
                      >
                        编辑关联
                      </Link>
                    ) : null}
                    <CatalogAddDialog catalogs={userCatalogs} workId={work.id} />
                  </div>
                ) : null}

                {containingCatalogs.length ? (
                  <Card className="order-2 rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:w-full" id="catalog-card">
                    <p className="my-[0.65rem] mb-[0.35rem] mt-0 font-mono text-xs tracking-[0.08em] text-muted">收录了本条目的目录</p>
                    {containingCatalogs.map((catalog) => (
                      <div className="flex items-baseline gap-2.5 border-b border-dashed border-border py-1.75 last:border-b-0" key={catalog.id}>
                        <div className="min-w-0">
                          <Link className="text-sm font-semibold text-[#1f6f67] wrap-anywhere hover:underline" href={`/catalogs/${catalog.id}`}>{catalog.title}</Link>
                          <span className="mt-0.5 block text-xs text-muted">{catalog.ownerName}</span>
                        </div>
                        <span className="ml-auto shrink-0 font-mono text-xs text-muted">{formatNumber(catalog.itemCount)} 部</span>
                      </div>
                    ))}
                  </Card>
                ) : null}

                {externalLinks.length ? (
                  <Card className="order-2 rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:w-full" id="links-card">
                    <p className="my-[0.65rem] mb-[0.35rem] mt-0 font-mono text-xs tracking-[0.08em] text-muted">外部链接</p>
                    <div className="grid gap-0.5">
                      {externalLinks.map((link) => (
                        <a
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-[#1f6f67] hover:bg-foreground/5"
                          href={link.url}
                          key={link.id}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {link.linkType === "official" ? <Link2 aria-hidden size={14} /> : <ExternalLink aria-hidden size={14} />}
                          {link.label}
                        </a>
                      ))}
                    </div>
                  </Card>
                ) : null}
              </>
            }
            mobilePrimaryFirst
            notice={work.distribution === "external" ? (
              <div className="flex gap-2.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2.5" role="note">
                <AlertTriangle aria-hidden className="shrink-0 text-[#a7471e]" size={18} />
                <div>
                  <strong className="block text-sm text-[#a7471e]">该作品的文件由外部网站提供</strong>
                  <p className="m-0 mt-1 text-xs leading-[1.55] text-foreground">本站未收录游戏文件，不提供网页游玩与直链下载；请在外部页面自行确认来源与文件安全性。</p>
                </div>
              </div>
            ) : null}
            primary={
              <WorkActionBar
                archive={current ? {
                  id: current.id,
                  downloadHref: `/api/archive-versions/${current.id}/download?zip_builder=${downloadZipBuilderVersion}`,
                  totalFiles: current.totalFiles,
                  totalSizeBytes: current.totalSizeBytes,
                } : null}
                externalDownload={externalDownload ? { url: externalDownload.url } : null}
                isAuthenticated={Boolean(currentUser)}
                workId={work.id}
              />
            }
            secondary={<WorkSidebarInfo current={current} work={work} />}
            stats={
              <WorkCommunityStats
                commentCount={community.commentCount}
                playerCount={community.playerCount}
                viewCount={community.viewCount}
              />
            }
          />
        }
      />
    </WorkPageShell>
  );
}

function dedupeTranslations(items: GameTranslationRelation[]): GameTranslationRelation[] {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.workId)) return false;
    seen.add(item.workId);
    return true;
  });
}

function compareRelatedWorks(left: GameWorkRelation, right: GameWorkRelation): number {
  return left.title.localeCompare(right.title, "zh-CN") || left.workId - right.workId;
}

function compareTranslations(
  left: GameTranslationRelation,
  right: GameTranslationRelation,
): number {
  const roleOrder = Number(left.role === "translation") - Number(right.role === "translation");
  return roleOrder || left.title.localeCompare(right.title, "zh-CN") || left.workId - right.workId;
}
