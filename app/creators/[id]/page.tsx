import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Card } from "@/app/components/ui/card";
import { CreatorPortrait } from "@/app/components/ui/creator-portrait";
import { DetailPageLayout, DetailPageShell } from "@/app/components/ui/detail-page-layout";
import { CommentPanel } from "@/app/games/[id]/work-community-panel";
import { formatNumber } from "@/lib/format";
import { creatorRoleLabel } from "@/lib/labels";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { getPublicCreatorDetail, type CreatorWorkCredit } from "@/lib/server/db/creator-library";
import { listPickerEmojis, listRootComments } from "@/lib/server/db/work-community";
import { parsePositiveId } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export default async function CreatorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parsePositiveId((await params).id, "creator id");
  const currentUser = await getCurrentUserFromCookies();
  const creator = await getPublicCreatorDetail(id);
  if (!creator) notFound();

  const [comments, emojis] = await Promise.all([
    listRootComments({ kind: "creator", id }, currentUser?.id ?? null, null),
    listPickerEmojis(),
  ]);
  const works = groupWorkCredits(creator.workCredits);

  return (
    <DetailPageShell>
      <header className="pt-4">
        <Link className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted hover:text-[#1f6f67]" href="/creators">
          <ArrowLeft aria-hidden size={15} />
          作者列表
        </Link>
        <h1 className="mt-2 font-serif text-3xl font-bold leading-tight max-[560px]:text-2xl">{creator.name}</h1>
        {creator.disambiguation ? <p className="text-sm text-muted">{creator.disambiguation}</p> : null}
        {creator.aliases.length ? (
          <p className="mt-1.5 text-sm text-muted">别名：<span className="font-mono text-foreground">{creator.aliases.join(" · ")}</span></p>
        ) : null}
        <nav aria-label="页面分区" className="mt-4 overflow-x-auto border-b border-border">
          <ul className="m-0 flex min-w-max list-none gap-0.5 p-0">
            <CreatorTab active href="#sec-intro" label="概览" />
            <CreatorTab count={works.length} href="#sec-works" label="参与作品" />
            <CreatorTab href="#sec-comments" label="评论" />
          </ul>
        </nav>
      </header>

      <DetailPageLayout
        compactSidebar
        sidebarLabel="作者资料"
        main={
          <>
            <section aria-labelledby="intro-title" className="scroll-mt-20 py-4.5" id="sec-intro">
              <h2 className="mb-3.5 text-base font-bold" id="intro-title">简介</h2>
              {creator.bio ? (
                <p className="m-0 whitespace-pre-wrap leading-[1.85] wrap-anywhere">{creator.bio}</p>
              ) : (
                <p className="m-0 text-sm text-muted">暂无简介。</p>
              )}
            </section>

            <section aria-labelledby="works-title" className="scroll-mt-20 border-t border-border py-4.5" id="sec-works">
              <div className="mb-3.5 flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-base font-bold" id="works-title">参与作品</h2>
                <span className="font-mono text-xs text-muted">{formatNumber(works.length)} 部</span>
              </div>
              {works.length ? (
                <ul className="m-0 divide-y divide-border border-y border-border p-0">
                  {works.map((work) => (
                    <li className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 py-4 max-[480px]:grid-cols-[5rem_minmax(0,1fr)]" key={work.workId}>
                      <Link className="relative aspect-4/3 overflow-hidden rounded-md border border-border bg-muted/15" href={`/games/${work.workId}`}>
                        {work.previewBlobSha256 ? (
                          <Image alt="" className="object-cover" fill sizes="112px" src={`/api/media/blobs/${work.previewBlobSha256}`} unoptimized />
                        ) : (
                          <span aria-hidden className="grid h-full place-items-center bg-rm2k-green-1 font-serif text-2xl font-bold text-white">作</span>
                        )}
                      </Link>
                      <div className="min-w-0 self-center">
                        <Link className="font-bold text-[#1f6f67] wrap-anywhere hover:underline" href={`/games/${work.workId}`}>{work.workTitle}</Link>
                        {work.workTitle !== work.workOriginalTitle ? <span className="block text-sm text-muted wrap-anywhere">{work.workOriginalTitle}</span> : null}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {work.credits.map((credit) => (
                            <span className="inline-flex rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-[#1f6f67]" key={`${credit.roleKey}-${credit.displayName}`}>
                              {credit.roleLabel || creatorRoleLabel(credit.roleKey)}
                            </span>
                          ))}
                        </div>
                        {work.credits.some((credit) => credit.displayName !== creator.name) ? (
                          <p className="m-0 mt-1.5 text-sm text-muted">本作署名：{unique(work.credits.map((credit) => credit.displayName)).join(" · ")}</p>
                        ) : null}
                        {work.credits.some((credit) => credit.notes) ? (
                          <p className="m-0 mt-1 text-sm text-muted">{unique(work.credits.flatMap((credit) => credit.notes ? [credit.notes] : [])).join(" · ")}</p>
                        ) : null}
                        <span className="mt-1 block font-mono text-xs text-muted">{work.originalReleaseDate ?? "日期未知"}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-sm text-muted">暂无参与作品。</p>
              )}
            </section>

            <section aria-labelledby="comments-title" className="scroll-mt-20 border-t border-border py-4.5" id="sec-comments">
              <div className="mb-3.5 flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-base font-bold" id="comments-title">评论</h2>
                <span className="font-mono text-xs text-muted">按发帖时间排序</span>
              </div>
              <CommentPanel
                currentUserId={currentUser?.id ?? null}
                emojis={emojis}
                initialComments={comments.items}
                initialNextCursor={comments.nextCursor}
                placeholder="写下你对这位作者或其作品的看法……"
                target={{ kind: "creator", id }}
              />
            </section>
          </>
        }
        sidebar={
          <Card className="rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:w-full">
            <CreatorPortrait avatarBlobSha256={creator.avatarBlobSha256} className="mx-auto size-52 max-w-full" name={creator.name} />
            <h2 className="mt-4 text-center font-serif text-xl font-bold">{creator.name}</h2>
            <dl className="mt-4">
              <CreatorInfoRow label="作品">{formatNumber(works.length)} 部</CreatorInfoRow>
              <CreatorInfoRow label="最近参与">{creator.latestWorkCreditAt?.slice(0, 10) ?? "暂无"}</CreatorInfoRow>
              {creator.aliases.length ? <CreatorInfoRow label="别名">{creator.aliases.join("、")}</CreatorInfoRow> : null}
            </dl>
            {creator.websiteUrl ? (
              <a className="mt-3 inline-flex min-h-8 items-center gap-1.5 text-sm font-medium text-[#1f6f67] hover:underline" href={creator.websiteUrl} rel="noreferrer" target="_blank">
                个人主页
                <ExternalLink aria-hidden size={14} />
              </a>
            ) : null}
          </Card>
        }
      />
    </DetailPageShell>
  );
}

function CreatorTab({ active = false, count, href, label }: { active?: boolean; count?: number; href: string; label: string }) {
  return (
    <li>
      <Link aria-current={active ? "page" : undefined} className={`inline-flex min-h-10.5 items-center gap-1.5 border-b-2 border-transparent px-3.25 text-sm whitespace-nowrap text-muted hover:border-border hover:text-foreground ${active ? "border-primary font-semibold text-[#1f6f67]" : ""}`} href={href}>
        {label}
        {count !== undefined ? <span className="font-mono text-xs text-muted">{count}</span> : null}
      </Link>
    </li>
  );
}

function CreatorInfoRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-dashed border-border py-1.75 text-sm last:border-b-0">
      <dt className="w-17 shrink-0 text-xs text-muted">{label}</dt>
      <dd className="m-0 min-w-0 wrap-anywhere">{children}</dd>
    </div>
  );
}

function groupWorkCredits(credits: CreatorWorkCredit[]) {
  const grouped = new Map<number, CreatorWorkCredit & { credits: CreatorWorkCredit[] }>();
  for (const credit of credits) {
    const current = grouped.get(credit.workId);
    if (current) current.credits.push(credit);
    else grouped.set(credit.workId, { ...credit, credits: [credit] });
  }
  return [...grouped.values()];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
