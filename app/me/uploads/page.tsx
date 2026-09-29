import {
  parseAccountPage,
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { searchUploadedWorks } from "@/app/.server/db/game-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { Button } from "@/app/components/ui/button";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import {
  canAccessOwnWorks,
  canPublishWork,
  hasPermission,
} from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { formatDate, parseTimestamp } from "@/lib/format";
import { engineLabel, languageLabel } from "@/lib/labels";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(
    runtime,
    `/me/uploads${page > 1 ? `?page=${page}` : ""}`,
  );
  if (!canAccessOwnWorks(user)) throwNotFound();
  const result = await searchUploadedWorks(runtime, {
    userId: user.id,
    page,
    pageSize: 20,
  });

  return {
    page,
    user: pickPageFields(user, ["id", "status", "permissionKeys"]),
    result,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "我的上传", page: loaderData?.page }, error);

export default function UploadsPage() {
  const { page, user, result } = useLoaderData<typeof loader>();
  return (
    <div>
      <AccountPageHeader
        actions={
          canPublishWork(user) ? (
            <Rm2kButton href="/upload">发布新作品</Rm2kButton>
          ) : undefined
        }
        subtitle={`共 ${result.total} 部作品`}
        title="我的上传"
      />
      {result.items.length ? (
        <ul className="divide-y divide-border border-b border-border">
          {result.items.map((work) => (
            <li
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
              key={work.id}
            >
              <Link
                aria-label={`查看作品：${work.chineseTitle || work.originalTitle}`}
                className="row-span-2 block aspect-4/3 w-26 self-start overflow-hidden rounded-md border border-border bg-muted/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:row-span-1 sm:w-32"
                to={`/games/${work.id}`}
              >
                <WorkThumbnail
                  blobSha256={work.coverBlobSha256}
                  width={128}
                  height={96}
                  fallback="暂无封面"
                  fallbackClassName="flex h-full items-center justify-center px-1 text-center font-mono text-xs text-muted"
                />
              </Link>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="truncate font-semibold"
                    to={`/games/${work.id}`}
                  >
                    {work.chineseTitle || work.originalTitle}
                  </Link>
                  <StatusBadge kind="publication" value={work.status} />
                </div>
                {work.chineseTitle ? (
                  <p className="mt-1 truncate text-sm text-muted">
                    {work.originalTitle}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-muted">
                  {engineLabel(work.engineFamily)} ·{" "}
                  {languageLabel(work.language)}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {work.publishedAt
                    ? `发布于 ${formatDate(work.publishedAt)}`
                    : ""}
                  {!work.publishedAt ||
                  parseTimestamp(work.updatedAt).getTime() !==
                    parseTimestamp(work.publishedAt).getTime()
                    ? `${work.publishedAt ? " · " : ""}最近更新：${formatDate(work.updatedAt)}`
                    : ""}
                </p>
              </div>
              <div className="col-start-2 flex flex-wrap gap-2 sm:col-start-3">
                {hasPermission(user, "work.update_own") ? (
                  <Button
                    asChild
                    variant="default"
                    size="sm"
                    className="px-3 text-xs"
                  >
                    <Link to={`/me/uploads/${work.id}`}>编辑信息</Link>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <AccountEmpty>还没有上传作品。</AccountEmpty>
      )}
      <PaginationLinks
        basePath="/me/uploads"
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
