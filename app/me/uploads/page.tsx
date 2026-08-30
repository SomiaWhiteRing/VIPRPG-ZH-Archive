import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/app/components/ui/page-header";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { requireAccountUser, parseAccountPage } from "@/lib/server/auth/account-user";
import { canUpload } from "@/lib/server/db/users";
import { searchUploadedWorks } from "@/lib/server/db/game-library";
import { engineLabel, languageLabel } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { AccountEmpty } from "../account-content";

export const dynamic = "force-dynamic";

export default async function UploadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(
    `/me/uploads${page > 1 ? `?page=${page}` : ""}`,
  );
  if (!canUpload(user)) notFound();
  const result = await searchUploadedWorks({ userId: user.id, page, pageSize: 20 });

  return (
    <div>
      <PageHeader
        actions={<Rm2kButton href="/upload">上传新作品</Rm2kButton>}
        subtitle={`共 ${result.total} 部作品`}
        title="我的上传"
      />
      {result.items.length ? (
        <ul className="divide-y divide-border border-y border-border">
          {result.items.map((work) => (
            <li className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={work.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link className="truncate font-semibold" href={`/games/${work.id}`}>
                    {work.chineseTitle || work.originalTitle}
                  </Link>
                  <StatusBadge kind="publication" value={work.status} />
                </div>
                {work.chineseTitle ? <p className="mt-1 truncate text-sm text-muted">{work.originalTitle}</p> : null}
                <p className="mt-1 text-sm text-muted">
                  {work.distribution === "archive" ? "本站归档" : "外部下载"} · {engineLabel(work.engineFamily)} · {languageLabel(work.language)}
                  {work.latestPublishedAt ? ` · 最近发布于 ${formatDate(work.latestPublishedAt)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Rm2kButton
                  className="min-h-9 px-3 text-xs"
                  href={work.distribution === "archive" ? `/upload/${work.id}` : `/me/uploads/${work.id}`}
                >
                  编辑信息
                </Rm2kButton>
              </div>
            </li>
          ))}
        </ul>
      ) : <AccountEmpty>还没有上传作品。</AccountEmpty>}
      <PaginationLinks basePath="/me/uploads" page={page} hasNext={page * 20 < result.total} />
    </div>
  );
}
