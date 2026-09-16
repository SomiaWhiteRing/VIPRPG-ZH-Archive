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
import { PageHeader } from "@/app/components/ui/page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { StatusBadge } from "@/app/components/ui/status-badge";
import {
  canAccessOwnWorks,
  canPublishWork,
  hasPermission,
} from "@/lib/authz/permissions";
import { formatDate } from "@/lib/format";
import { engineLabel, languageLabel } from "@/lib/labels";
import type { LoaderFunctionArgs } from "react-router";
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

export default function UploadsPage() {
  const { page, user, result } = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader
        actions={
          canPublishWork(user) ? (
            <Rm2kButton href="/upload">发布新作品</Rm2kButton>
          ) : undefined
        }
        subtitle={`共 ${result.total} 部作品`}
        title="我的上传"
      />
      {result.items.length ? (
        <ul className="divide-y divide-border border-y border-border">
          {result.items.map((work) => (
            <li
              className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              key={work.id}
            >
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
                  {work.distribution === "archive" ? "本站归档" : "外部下载"} ·{" "}
                  {engineLabel(work.engineFamily)} ·{" "}
                  {languageLabel(work.language)}
                  {work.latestPublishedAt
                    ? ` · 最近发布于 ${formatDate(work.latestPublishedAt)}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {hasPermission(user, "work.update_own") ? (
                  <Rm2kButton
                    className="min-h-9 px-3 text-xs"
                    href={`/me/uploads/${work.id}`}
                  >
                    编辑信息
                  </Rm2kButton>
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
