import { Card } from "@/app/components/ui/card";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import { getRelationEditorCapabilities } from "@/lib/authz/permissions";
import { formatBytes, formatNumber } from "@/lib/format";
import {
  creatorRoleLabel,
  engineLabel,
  languageLabel,
  relationLabel,
} from "@/lib/labels";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { listCatalogs, listCatalogsContainingWork } from "@/lib/server/db/catalogs";
import {
  getGameWorkDetail,
  type GameTranslationRelation,
} from "@/lib/server/db/game-library";
import {
  getWorkCommunitySummary,
  listPickerEmojis,
  listRootComments,
} from "@/lib/server/db/work-community";
import { parsePositiveId } from "@/lib/server/http/request";
import { publicCopy } from "@/lib/public-copy";
import { AlertTriangle, ArrowLeft, ExternalLink, Link2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RelationEditor } from "./relation-editor";
import { WorkActionBar } from "./work-action-bar";
import { WorkCommunityPanel } from "./work-community-panel";
import { WorkEngagementActions } from "./work-engagement-actions";
import { WorkMediaGallery } from "./work-media-gallery";

export const dynamic = "force-dynamic";

const CHARACTER_ROLE_LABELS: Record<string, string> = {
  main: "主角",
  supporting: "配角",
  cameo: "客串",
  mentioned: "提及",
  other: "其他",
};
const CHARACTER_TONES = ["bg-[#7d5ba6]", "bg-[#3d6fb4]", "bg-[#3f8f6a]", "bg-[#c0584f]"];

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
  ]);
  const relationCards = [
    ...relatedTranslations.map((item) => ({
      key: `translation-${item.workId}`,
      href: `/games/${item.workId}`,
      type: `${item.role === "original" ? "原版" : "译版"} · ${languageLabel(item.language)}`,
      title: item.title,
      previewBlobSha256: item.previewBlobSha256 ?? null,
    })),
    ...work.relations.map((item) => ({
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
    relationCapabilities.canUpdateTranslation ||
    relationCapabilities.canDeleteRelation ||
    relationCapabilities.canDeleteTranslation;
  const externalLinks = work.externalLinks.filter(
    (link) => link.linkType !== "download_page",
  );

  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] pb-11 text-foreground max-[560px]:w-[calc(100%-1.5rem)]">
      <header className="pt-4">
        <Link className="inline-flex min-h-8 items-center gap-1.5 text-[13px] text-muted hover:text-[#1f6f67]" href="/games">
          <ArrowLeft aria-hidden size={15} />
          游戏库
        </Link>
        <h1 className="mt-2 font-serif text-[30px] font-bold leading-tight max-[560px]:text-2xl">
          {title}
          {work.chineseTitle ? (
            <span className="ml-2 font-mono text-[15px] font-normal text-muted" lang="ja">
              {work.originalTitle}
            </span>
          ) : null}
        </h1>
        {work.aliases.length ? (
          <p className="mt-[0.4rem] text-[13px] text-muted">
            又名：<span className="font-mono text-foreground">{work.aliases.join(" · ")}</span>
          </p>
        ) : null}
        <div aria-label="元信息" className="mt-[0.7rem] flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-[1.6rem] items-center gap-[0.3rem] rounded-full border border-rm2k-green-2 bg-rm2k-green-2 px-[0.6rem] py-[0.15rem] font-mono text-[11px] tracking-[0.04em] text-white">
            {engineLabel(work.engineFamily)}
          </span>
          <span className="inline-flex min-h-[1.6rem] items-center gap-[0.3rem] rounded-full border border-primary/40 bg-card px-[0.6rem] py-[0.15rem] font-mono text-[11px] tracking-[0.04em] text-[#1f6f67]">
            {languageLabel(work.language)}
          </span>
        </div>

        <nav aria-label="页面分区" className="mt-4 overflow-x-auto border-b border-border">
          <ul className="m-0 flex min-w-max list-none gap-0.5 p-0">
            <AnchorItem active href="#sec-intro" label="概览" />
            {media.length ? (
              <AnchorItem count={media.length} href="#sec-gallery" label="截图" />
            ) : null}
            {work.characters.length ? (
              <AnchorItem count={work.characters.length} href="#sec-cast" label="角色" />
            ) : null}
            {relationCards.length ? (
              <AnchorItem count={relationCards.length} href="#sec-relations" label="关联" />
            ) : null}
            <AnchorItem count={community.commentCount} href="#sec-comments" label="评论" />
          </ul>
        </nav>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_348px] items-start gap-[clamp(24px,3vw,40px)] pt-1 max-[980px]:flex max-[980px]:flex-col">
        <div className="min-w-0 max-[980px]:order-1 max-[980px]:w-full">
          <section aria-labelledby="intro-title" className="scroll-mt-20 py-4.5" id="sec-intro">
            <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
              <h2 className="m-0 text-[15.5px] font-bold" id="intro-title">简介</h2>
              {work.distribution === "external" ? (
                <span className="font-mono text-[11px] text-muted max-[560px]:text-left">外部发布 · 未收录归档</span>
              ) : null}
            </div>
            {work.engineFamily === "rpg_maker_2003_maniac" ? (
              <div className="mb-3.5 flex gap-2.5 rounded-lg border border-[#b47800]/35 bg-[#fff7df] px-3 py-2.5 text-[13px] text-[#684a00]" role="note">
                <AlertTriangle aria-hidden className="mt-0.5 shrink-0" size={16} />
                <span>该游戏使用 Maniac，可能无法用 EasyRPG 正常游玩。</span>
              </div>
            ) : null}
            {work.description ? (
              <p className="m-0 leading-[1.85] wrap-anywhere">
                {publicCopy(work.description)}
              </p>
            ) : (
              <p className="text-[13px] text-muted">暂无简介。</p>
            )}
            {work.tags.length ? (
              <div aria-label="标签" className="mt-4 flex flex-wrap gap-2">
                {work.tags.map((tag) => (
                  <Link
                    className="inline-flex min-h-7.5 items-center rounded-full border border-primary/30 px-2.75 py-1 text-[13px] font-medium text-[#1f6f67] hover:border-primary hover:bg-primary/10"
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
                <h2 className="m-0 text-[15.5px] font-bold" id="gallery-title">截图</h2>
                <span className="font-mono text-[11px] text-muted max-[560px]:text-left">{media.length} 张 · 点击放大</span>
              </div>
              <WorkMediaGallery items={media} title={title} />
            </section>
          ) : null}

          {work.characters.length ? (
            <section aria-labelledby="cast-title" className="scroll-mt-20 border-t border-border py-4.5" id="sec-cast">
              <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                <h2 className="m-0 text-[15.5px] font-bold" id="cast-title">登场角色</h2>
                <span className="font-mono text-[11px] text-muted max-[560px]:text-left">{work.characters.length} 名 · 均无剧透</span>
              </div>
              <div aria-label="角色列表" className="flex gap-2.5 overflow-x-auto pb-1.5 [scroll-snap-type:x_proximity] scrollbar-thin">
                {work.characters.map((character, index) => (
                  <Link
                    className="group grid basis-29 shrink-0 content-start gap-1 text-foreground max-[560px]:basis-27"
                    href={`/games?character=${character.id}`}
                    key={character.id}
                  >
                    <span
                      className={`grid aspect-square place-items-center rounded-lg border border-foreground/15 font-serif text-[26px] font-bold text-white [text-shadow:0_1px_0_rgb(0_0_0/30%)] transition-shadow duration-150 group-hover:shadow-[0_3px_10px_rgb(23_33_43/14%)] ${characterTone(index)}`}
                      aria-hidden="true"
                    >
                      {character.primaryName.slice(0, 1)}
                    </span>
                    <span className="text-sm font-semibold wrap-anywhere">{character.primaryName}</span>
                    {character.originalName && character.originalName !== character.primaryName ? (
                      <span className="font-mono text-[11px] text-muted wrap-anywhere">{character.originalName}</span>
                    ) : null}
                    <span className={`inline-flex justify-self-start rounded-full border border-border bg-card px-2 py-[0.05rem] font-mono text-[10.5px] text-muted ${character.roleKey === "main" ? "border-primary/40 bg-primary/10 text-[#1f6f67]" : ""}`}>
                      {CHARACTER_ROLE_LABELS[character.roleKey] ?? "其他"}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {relationCards.length || showRelationEditor ? (
            <section aria-labelledby="relations-title" className="scroll-mt-20 border-t border-border py-4.5" id="sec-relations">
              <span aria-hidden="true" className="sr-only" id="relations" />
              <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
                <h2 className="m-0 text-[15.5px] font-bold" id="relations-title">关联作品</h2>
                {relationCards.length ? (
                  <span className="font-mono text-[11px] text-muted max-[560px]:text-left">{relationCards.length} 项</span>
                ) : null}
              </div>
              {relationCards.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-4">
                  {relationCards.map((relation) => (
                    <Link className="group grid min-w-0 content-start gap-1.5" href={relation.href} key={relation.key}>
                      <span className="font-mono text-[11px] tracking-[0.04em] text-muted">{relation.type}</span>
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
                          <span className="grid h-full place-items-center bg-rm2k-green-1 font-serif text-[26px] font-bold text-white" aria-hidden="true">
                            {relation.title.slice(0, 1)}
                          </span>
                        )}
                      </span>
                      <span className="text-[13.5px] font-semibold leading-[1.45] text-[#1f6f67] wrap-anywhere group-hover:underline">{relation.title}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-muted">暂无公开关联作品。</p>
              )}
              {showRelationEditor ? (
                <div className="mt-4 pt-4">
                  <RelationEditor
                    {...relationCapabilities}
                    currentUserId={currentUser?.id ?? null}
                    language={work.language}
                    parallelTranslations={work.parallelTranslations}
                    relations={work.relations}
                    translations={work.translations}
                    workId={work.id}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="comments-title" className="scroll-mt-20 border-t border-border py-4.5" id="sec-comments">
            <div className="mb-3.5 flex items-baseline justify-between gap-4 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-1">
              <h2 className="m-0 text-[15.5px] font-bold" id="comments-title">评论</h2>
              <span className="font-mono text-[11px] text-muted max-[560px]:text-left">按发帖时间排序</span>
            </div>
            <WorkCommunityPanel
              currentUserId={currentUser?.id ?? null}
              emojis={emojis}
              initialComments={comments.items}
              initialNextCursor={comments.nextCursor}
              workId={work.id}
            />
          </section>
        </div>

        <aside aria-label="档案与获取" className="grid content-start gap-3.5 max-[980px]:contents">
          <Card className="sticky top-18.5 z-5 rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-[0_8px_22px_rgb(23_33_43/10%)] max-[980px]:static max-[980px]:-order-1 max-[980px]:w-full max-[980px]:shadow-none" id="action-card">
            <div className="grid gap-3.5">
              <WorkActionBar
                archive={
                  current
                    ? {
                        id: current.id,
                        downloadHref: `/api/archive-versions/${current.id}/download?zip_builder=${downloadZipBuilderVersion}`,
                        totalFiles: current.totalFiles,
                        totalSizeBytes: current.totalSizeBytes,
                      }
                    : null
                }
                externalDownload={externalDownload ? { url: externalDownload.url } : null}
                isAuthenticated={Boolean(currentUser)}
                workId={work.id}
              />
              {work.distribution === "external" ? (
                <div className="flex gap-2.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2.5" role="note">
                  <AlertTriangle aria-hidden className="shrink-0 text-[#a7471e]" size={18} />
                  <div>
                    <strong className="block text-[13px] text-[#a7471e]">该作品的文件由外部网站提供</strong>
                    <p className="m-0 mt-1 text-xs leading-[1.55] text-foreground">本站未收录游戏文件，不提供网页游玩与直链下载；请在外部页面自行确认来源与文件安全性。</p>
                  </div>
                </div>
              ) : null}
              <hr className="h-px border-0 bg-border" />
              <WorkEngagementActions
                catalogs={userCatalogs}
                currentUserId={currentUser?.id ?? null}
                initialWishlisted={community.wishlistedByMe}
                workId={work.id}
              />
              <hr className="h-px border-0 bg-border" />
              <div aria-label="热度统计" className="flex flex-wrap gap-3.5 text-xs text-muted">
                <span><strong className="font-mono font-semibold text-foreground">{formatNumber(community.viewCount)}</strong> 浏览</span>
                <span><strong className="font-mono font-semibold text-foreground">{formatNumber(community.playerCount)}</strong> 位玩家</span>
                <span><strong className="font-mono font-semibold text-foreground">{formatNumber(community.commentCount)}</strong> 条评论</span>
              </div>
            </div>
          </Card>

          <Card className="rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:order-2 max-[980px]:w-full" id="infobox-card">
            <dl className="m-0">
              <InfoRow label="引擎">{engineLabel(work.engineFamily)}</InfoRow>
              <InfoRow label="语言">{languageLabel(work.language)}</InfoRow>
              <InfoRow label="首发" mono>{formatDateish(work.originalReleaseDate, work.originalReleasePrecision)}</InfoRow>
              <InfoRow label="类型">{work.isOriginal ? "本站原创" : "社区收录"}</InfoRow>
              <InfoRow label="分发">
                <span className={`inline-flex min-h-[1.6rem] items-center gap-[0.3rem] rounded-full border bg-card px-[0.6rem] py-[0.15rem] font-mono text-[11px] tracking-[0.04em] ${work.distribution === "external" ? "border-accent/45 text-[#a7471e]" : "border-primary/40 text-[#1f6f67]"}`}>
                  {distributionLabel(work.distribution)}
                </span>
              </InfoRow>
            </dl>

            {current ? (
              <>
                <p className="my-[0.65rem] mb-[0.35rem] font-mono text-[11px] tracking-[0.08em] text-muted">当前快照</p>
                <dl className="m-0">
                  <InfoRow label="文件" mono>{formatNumber(current.totalFiles)} 个</InfoRow>
                  <InfoRow label="体积" mono>{formatBytes(current.totalSizeBytes)}</InfoRow>
                  {current.uploaderName ? <InfoRow label="上传">{current.uploaderName}</InfoRow> : null}
                  {current.publishedAt ? <InfoRow label="收录" mono>{current.publishedAt.slice(0, 10)}</InfoRow> : null}
                </dl>
              </>
            ) : null}

            <p className="my-[0.65rem] mb-[0.35rem] font-mono text-[11px] tracking-[0.08em] text-muted">制作名单</p>
            <dl className="m-0">
              {work.creators.length ? work.creators.map((creator) => (
                <InfoRow key={`${creator.id}-${creator.roleKey}`} label={creator.roleLabel || creatorRoleLabel(creator.roleKey)}>
                  <Link className="font-medium text-[#1f6f67] hover:underline" href={`/creators/${creator.id}`}>{creator.name}</Link>
                </InfoRow>
              )) : <InfoRow label="记录">暂无</InfoRow>}
            </dl>
          </Card>

          {containingCatalogs.length ? (
            <Card className="rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:order-2 max-[980px]:w-full" id="catalog-card">
              <p className="my-[0.65rem] mb-[0.35rem] mt-0 font-mono text-[11px] tracking-[0.08em] text-muted">收录了本条目的目录</p>
              {containingCatalogs.map((catalog) => (
                <div className="flex items-baseline gap-2.5 border-b border-dashed border-border py-1.75 last:border-b-0" key={catalog.id}>
                  <div className="min-w-0">
                    <Link className="text-[13px] font-semibold text-[#1f6f67] wrap-anywhere hover:underline" href={`/catalogs/${catalog.id}`}>{catalog.title}</Link>
                    <span className="mt-0.5 block text-[11px] text-muted">{catalog.ownerName}</span>
                  </div>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{formatNumber(catalog.itemCount)} 部</span>
                </div>
              ))}
            </Card>
          ) : null}

          {externalLinks.length ? (
            <Card className="rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:order-2 max-[980px]:w-full" id="links-card">
              <p className="my-[0.65rem] mb-[0.35rem] mt-0 font-mono text-[11px] tracking-[0.08em] text-muted">外部链接</p>
              <div className="grid gap-0.5">
                {externalLinks.map((link) => (
                  <a
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-[#1f6f67] hover:bg-foreground/5"
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
        </aside>
      </div>
    </main>
  );
}

function AnchorItem({
  active = false,
  count,
  href,
  label,
}: {
  active?: boolean;
  count?: number;
  href: string;
  label: string;
}) {
  return (
    <li>
      <Link
        className={`inline-flex min-h-10.5 items-center gap-1.5 border-b-2 border-transparent px-3.25 text-sm whitespace-nowrap text-muted hover:border-border hover:text-foreground ${active ? "border-primary font-semibold text-[#1f6f67]" : ""}`}
        href={href}
      >
        {label}
        {count !== undefined ? <span className="font-mono text-[11px] text-muted">{count}</span> : null}
      </Link>
    </li>
  );
}

function InfoRow({
  children,
  label,
  mono = false,
}: {
  children: ReactNode;
  label: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-dashed border-border py-1.75 text-[13px] last:border-b-0">
      <dt className="w-17 shrink-0 text-xs text-muted">{label}</dt>
      <dd className={`m-0 min-w-0 wrap-anywhere ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
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

function characterTone(index: number): string {
  return CHARACTER_TONES[index % CHARACTER_TONES.length];
}

function distributionLabel(value: string): string {
  return value === "archive" ? "本站归档" : value === "external" ? "外部发布" : "来源待整理";
}

function formatDateish(value: string | null, precision: string): string {
  return !value || precision === "unknown" ? "日期未知" : value;
}
