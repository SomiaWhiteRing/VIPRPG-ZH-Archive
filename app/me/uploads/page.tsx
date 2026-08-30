import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/app/components/ui/page-header";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { requireAccountUser, parseAccountPage } from "@/lib/server/auth/account-user";
import { canUpload } from "@/lib/server/db/users";
import { searchImportJobsForUser } from "@/lib/server/db/import-jobs";
import { formatBytes, formatDate } from "@/lib/format";
import { importTaskStageLabel } from "@/lib/labels";
import { AccountEmpty } from "../account-content";
import { UploadCancelButton } from "./upload-actions";

export const dynamic = "force-dynamic";

export default async function UploadsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(`/me/uploads${page > 1 ? `?page=${page}` : ""}`);
  if (!canUpload(user)) notFound();
  const result = await searchImportJobsForUser({ userId: user.id, page, pageSize: 20 });

  return (
    <div>
      <PageHeader
        actions={<Rm2kButton href="/upload">上传作品</Rm2kButton>}
        subtitle={`共 ${result.total} 个上传任务`}
        title="我的上传"
      />
      {result.items.length ? (
        <ul className="divide-y divide-border border-y border-border">
          {result.items.map((job) => (
            <li className="grid gap-3 py-4" key={job.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0"><strong className="block truncate">{job.sourceName || `上传任务 #${job.id}`}</strong><span className="font-mono text-xs text-muted">#{job.id}</span></div>
                <StatusBadge kind="import-task" value={job.status} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-muted">作品</dt><dd>{job.workId ? <Link href={`/games/${job.workId}`}>{job.workTitle || `#${job.workId}`}</Link> : "尚未关联"}</dd></div>
                <div><dt className="text-muted">文件</dt><dd>{job.fileCount}</dd></div>
                <div><dt className="text-muted">容量</dt><dd>{formatBytes(job.sourceSizeBytes || 0)}</dd></div>
                <div><dt className="text-muted">创建时间</dt><dd>{formatDate(job.createdAt)}</dd></div>
              </dl>
              {job.failedStage || job.errorMessage ? <p className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">{job.failedStage ? `${importTaskStageLabel(job.failedStage)}：` : ""}任务未完成，请重新选择文件后上传。</p> : null}
              {["created", "preflighted", "uploading"].includes(job.status) ? <UploadCancelButton jobId={job.id} /> : null}
              {job.status === "failed" || job.status === "canceled" ? <div><Rm2kButton className="min-h-9 px-2.5 text-xs" href="/upload">重新上传</Rm2kButton></div> : null}
            </li>
          ))}
        </ul>
      ) : <AccountEmpty>还没有上传任务。</AccountEmpty>}
      <PaginationLinks basePath="/me/uploads" page={page} hasNext={page * 20 < result.total} />
    </div>
  );
}
