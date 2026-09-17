import { getCurrentUser } from "@/app/.server/auth/current-user";
import { getPublicCreatorDetail } from "@/app/.server/db/creator-library";
import {
  listPickerEmojis,
  listRootComments,
} from "@/app/.server/db/work-community";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { CommentPanel } from "@/app/components/comments/comment-panel";
import { Badge } from "@/app/components/ui/badge";
import { Card } from "@/app/components/ui/card";
import { CreatorPortrait } from "@/app/components/ui/creator-portrait";
import {
  DetailPageLayout,
  DetailPageShell,
} from "@/app/components/ui/detail-page-layout";
import { EmptyState } from "@/app/components/ui/empty-state";
import { InfoRow } from "@/app/components/ui/info-row";
import { SectionNavigation } from "@/app/components/ui/section-navigation";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import type { CreatorWorkCredit } from "@/lib/dto/db/creator-library";
import { formatNumber } from "@/lib/format";
import { creatorRoleLabel } from "@/lib/labels";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const id = parsePositiveId((await params).id, "creator id");
  const currentUser = await getCurrentUser(runtime);
  const creator = await getPublicCreatorDetail(runtime, id);
  if (!creator) throwNotFound();

  const [comments, emojis] = await Promise.all([
    listRootComments(
      runtime,
      { kind: "creator", id },
      currentUser?.id ?? null,
      null,
    ),
    listPickerEmojis(runtime),
  ]);
  const works = groupWorkCredits(creator.workCredits);

  return {
    currentUser: pickPageFields(currentUser, ["id"]),
    creator,
    comments,
    emojis,
    works,
  };
}

export default function CreatorDetailPage() {
  const { currentUser, creator, comments, emojis, works } =
    useLoaderData<typeof loader>();
  return (
    <DetailPageShell>
      <header className="pt-4">
        <Link
          className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted hover:text-[#1f6f67]"
          to="/creators"
        >
          <ArrowLeft aria-hidden size={15} />
          作者列表
        </Link>
        <h1 className="mt-2 font-serif text-3xl font-bold leading-tight max-[560px]:text-2xl">
          {creator.name}
        </h1>
        <SectionNavigation
          items={[
            { href: "#sec-intro", label: "概览", active: true },
            { href: "#sec-works", label: "参与作品", count: works.length },
            { href: "#sec-comments", label: "评论" },
          ]}
        />
      </header>

      <DetailPageLayout
        compactSidebar
        sidebarPosition="left"
        sidebarLabel="作者资料"
        main={
          <>
            <section
              aria-labelledby="intro-title"
              className="scroll-mt-20 py-4.5"
              id="sec-intro"
            >
              <h2 className="mb-3.5 text-base font-bold" id="intro-title">
                简介
              </h2>
              {creator.bio ? (
                <p className="m-0 whitespace-pre-wrap leading-[1.85] wrap-anywhere">
                  {creator.bio}
                </p>
              ) : (
                <p className="m-0 text-sm text-muted">暂无简介。</p>
              )}
            </section>

            <section
              aria-labelledby="works-title"
              className="scroll-mt-20 border-t border-border py-4.5"
              id="sec-works"
            >
              <div className="mb-3.5 flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-base font-bold" id="works-title">
                  参与作品
                </h2>
                <span className="font-mono text-xs text-muted">
                  {formatNumber(works.length)} 部
                </span>
              </div>
              {works.length ? (
                <ul className="m-0 divide-y divide-border border-y border-border p-0">
                  {works.map((work) => (
                    <li
                      className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 py-4 max-[480px]:grid-cols-[5rem_minmax(0,1fr)]"
                      key={work.workId}
                    >
                      <Link
                        className="relative aspect-4/3 overflow-hidden rounded-md border border-border bg-muted/15"
                        to={`/games/${work.workId}`}
                      >
                        <WorkThumbnail
                          blobSha256={work.previewBlobSha256}
                          alt=""
                          sizes="112px"
                          imageClassName="object-cover"
                          fallbackClassName="grid h-full place-items-center bg-rm2k-green-1 font-serif text-2xl font-bold text-white"
                          fallback="作"
                        />
                      </Link>
                      <div className="min-w-0 self-center">
                        <Link
                          className="font-bold text-[#1f6f67] wrap-anywhere hover:underline"
                          to={`/games/${work.workId}`}
                        >
                          {work.workTitle}
                        </Link>
                        {work.workTitle !== work.workOriginalTitle ? (
                          <span className="block text-sm text-muted wrap-anywhere">
                            {work.workOriginalTitle}
                          </span>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {work.credits.map((credit) => (
                            <Badge
                              variant="credit"
                              key={`${credit.roleKey}-${credit.displayName}`}
                            >
                              {credit.roleLabel ||
                                creatorRoleLabel(credit.roleKey)}
                            </Badge>
                          ))}
                        </div>
                        {work.credits.some(
                          (credit) => credit.displayName !== creator.name,
                        ) ? (
                          <p className="m-0 mt-1.5 text-sm text-muted">
                            本作署名：
                            {unique(
                              work.credits.map((credit) => credit.displayName),
                            ).join(" · ")}
                          </p>
                        ) : null}
                        {work.credits.some((credit) => credit.notes) ? (
                          <p className="m-0 mt-1 text-sm text-muted">
                            {unique(
                              work.credits.flatMap((credit) =>
                                credit.notes ? [credit.notes] : [],
                              ),
                            ).join(" · ")}
                          </p>
                        ) : null}
                        <span className="mt-1 block font-mono text-xs text-muted">
                          {work.originalReleaseDate ?? "日期未知"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="暂无参与作品。" variant="plain" />
              )}
            </section>

            <section
              aria-labelledby="comments-title"
              className="scroll-mt-20 border-t border-border py-4.5"
              id="sec-comments"
            >
              <div className="mb-3.5 flex items-baseline justify-between gap-4">
                <h2 className="m-0 text-base font-bold" id="comments-title">
                  评论
                </h2>
                <span className="font-mono text-xs text-muted">
                  按发帖时间排序
                </span>
              </div>
              <CommentPanel
                currentUserId={currentUser?.id ?? null}
                emojis={emojis}
                initialComments={comments.items}
                initialNextCursor={comments.nextCursor}
                placeholder="写下你对这位作者或其作品的看法……"
                target={{ kind: "creator", id: creator.id }}
              />
            </section>
          </>
        }
        sidebar={
          <Card className="rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:w-full">
            <CreatorPortrait
              avatarBlobSha256={creator.avatarBlobSha256}
              className="mx-auto size-52 max-w-full"
              name={creator.name}
            />
            <h2 className="mt-4 text-center font-serif text-xl font-bold">
              {creator.name}
            </h2>
            <dl className="mt-4">
              <InfoRow label="作品">{formatNumber(works.length)} 部</InfoRow>
              <InfoRow label="最近参与">
                {creator.latestWorkCreditAt?.slice(0, 10) ?? "暂无"}
              </InfoRow>
              {creator.aliases.length ? (
                <InfoRow label="别名">{creator.aliases.join("、")}</InfoRow>
              ) : null}
            </dl>
            {creator.websiteUrl ? (
              <a
                className="mt-3 inline-flex min-h-8 items-center gap-1.5 text-sm font-medium text-[#1f6f67] hover:underline"
                href={creator.websiteUrl}
                rel="noreferrer"
                target="_blank"
              >
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

function groupWorkCredits(credits: CreatorWorkCredit[]) {
  const grouped = new Map<
    number,
    CreatorWorkCredit & { credits: CreatorWorkCredit[] }
  >();
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
