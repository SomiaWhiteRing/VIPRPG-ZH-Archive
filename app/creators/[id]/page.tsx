import { AUTO_LINK_PATTERN, autoLink } from "@/lib/auto-links";
import { Fragment } from "react";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { browsePublicCreatorWorks } from "@/app/.server/db/creator-library";
import { listRootComments } from "@/app/.server/db/work-community";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { CommentPanel } from "@/app/components/comments/comment-panel";
import { BackLink } from "@/app/components/ui/back-link";
import { Card } from "@/app/components/ui/card";
import { CreatorPortrait } from "@/app/components/ui/creator-portrait";
import {
  DetailPageLayout,
  DetailPageShell,
} from "@/app/components/ui/detail-page-layout";
import { EmptyState } from "@/app/components/ui/empty-state";
import { InfoRow } from "@/app/components/ui/info-row";
import { SectionNavigation } from "@/app/components/ui/section-navigation";
import { CreatorWorkList } from "@/app/creators/creator-work-list";
import { canEditPublicCreator } from "@/lib/authz/creator-permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { formatNumber } from "@/lib/format";
import { ExternalLink } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const id = parsePositiveId((await params).id, "creator id");
  const currentUser = await getCurrentUser(runtime);
  const result = await browsePublicCreatorWorks(runtime, id, { page: 1, pageSize: 5 });
  if (!result) throwNotFound();
  const { creator, items: works } = result;

  const comments = await listRootComments(
    runtime,
    { kind: "creator", id },
    currentUser?.id ?? null,
    null,
  );

  return {
    currentUser: pickPageFields(currentUser, ["id"]),
    canEdit: canEditPublicCreator(currentUser),
    creator,
    comments,
    works,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: loaderData?.creator.name || "作者详情" }, error);

export default function CreatorDetailPage() {
  const { currentUser, creator, comments, works, canEdit } =
    useLoaderData<typeof loader>();
  return (
    <DetailPageShell>
      <header className="pt-4">
        <BackLink href="/creators" label="作者列表" variant="text" />
        <h1 className="mt-2 font-serif text-3xl font-bold leading-tight max-[560px]:text-2xl">
          {creator.name}
        </h1>
        <SectionNavigation
          items={[
            { href: "#sec-intro", label: "概览", active: true },
            { href: "#sec-works", label: "参与作品", count: creator.workCreditCount },
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
                  {creator.bio
                    .split(new RegExp(`(${AUTO_LINK_PATTERN.source})`, "g"))
                    .map((part, index) => {
                      const link = autoLink(part);
                      return link ? (
                        <Fragment key={index}>
                          <a className="text-secondary underline underline-offset-2" href={link.href}
                            rel="noreferrer" target="_blank">{link.text}</a>
                          {link.suffix}
                        </Fragment>
                      ) : part;
                    })}
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
                {works.length ? (
                  <Link
                    aria-label="查看全部参与作品"
                    className="text-sm font-medium text-secondary hover:underline"
                    to={`/creators/${creator.id}/works`}
                  >
                    更多
                  </Link>
                ) : null}
              </div>
              {works.length ? (
                <CreatorWorkList works={works} creatorName={creator.name} />
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
                initialComments={comments.items}
                initialNextCursor={comments.nextCursor}
                placeholder="写下你对这位作者或其作品的看法……"
                target={{ kind: "creator", id: creator.id }}
              />
            </section>
          </>
        }
        sidebar={
          <>
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
              <InfoRow label="作品">{formatNumber(creator.workCreditCount)} 部</InfoRow>
              <InfoRow label="最近参与">
                {creator.latestWorkCreditAt?.slice(0, 10) ?? "暂无"}
              </InfoRow>
              {creator.aliases.length ? (
                <InfoRow label="别名">{creator.aliases.join("、")}</InfoRow>
              ) : null}
            </dl>
            {creator.links.map((link, index) => (
              <a
                key={index}
                className="mt-3 flex min-h-8 items-center gap-1.5 text-sm font-medium text-secondary hover:underline"
                href={link.url}
                rel="noreferrer"
                target="_blank"
              >
                <span className="wrap-anywhere">{link.label}</span>
                <ExternalLink aria-hidden size={14} className="shrink-0" />
              </a>
            ))}
          </Card>
          {canEdit || !currentUser ? (
            <div className="flex items-center gap-1 px-2 max-[980px]:w-full" aria-label="作者资料操作">
              <Link className="min-w-0 flex-1 shrink px-1 text-center text-sm font-medium text-secondary hover:underline"
                to={currentUser ? `/creators/${creator.id}/edit` : `/login?next=${encodeURIComponent(`/creators/${creator.id}/edit`)}`}>
                {currentUser ? "编辑资料" : "登录后编辑"}
              </Link>
            </div>
          ) : null}
          </>
        }
      />
    </DetailPageShell>
  );
}
