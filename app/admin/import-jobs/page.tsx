import Link from "next/link";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { SelectField } from "@/app/components/ui/select";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { searchAdminImportJobs } from "@/lib/server/db/admin-observability";
import { formatBytes, formatDate } from "@/lib/format";
import { IMPORT_TASK_STATUS_OPTIONS } from "@/lib/labels";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  ...IMPORT_TASK_STATUS_OPTIONS,
];

export default async function AdminImportJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; status?: string | string[] }>;
}) {
  await requirePagePermission("/admin/import-jobs", "system.dashboard.read");
  const params = await searchParams;
  const page = positive(Array.isArray(params.page) ? params.page[0] : params.page);
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = STATUS_OPTIONS.some((item) => item.value === rawStatus)
    ? rawStatus
    : "all";
  const result = await searchAdminImportJobs({ page, pageSize: 50, status });

  return (
    <main>
      <PageHeader
        compact
        subtitle={`共 ${result.total.toLocaleString("zh-CN")} 个任务`}
        title="上传任务"
      />
      <form className="flex items-end gap-3" method="get">
        <SelectField
          defaultValue={status}
          name="status"
          options={[...STATUS_OPTIONS]}
        />
        <Button type="submit" variant="outline">
          筛选
        </Button>
      </form>
      {result.items.length ? (
        <TableWrap compact label="上传任务" minWidth={900}>
          <thead><tr><th>任务</th><th>状态</th><th>作品</th><th>上传者</th><th>文件</th><th>更新时间</th></tr></thead>
          <tbody>
            {result.items.map((job) => (
              <tr key={job.id}>
                <td><Link href={`/admin/import-jobs/${job.id}`}>#{job.id} {job.sourceName || "未知来源"}</Link></td>
                <td><StatusBadge kind="import-task" value={job.status} /></td>
                <td>{job.workId ? <Link href={`/admin/works/${job.workId}`}>{job.workTitle || `#${job.workId}`}</Link> : "尚未关联"}</td>
                <td>{job.uploaderName || "未知"}</td>
                <td>{job.fileCount.toLocaleString("zh-CN")} · {formatBytes(job.sourceSizeBytes || 0)}</td>
                <td>{formatDate(job.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState title="没有符合条件的上传任务。" />}
      <PaginationLinks
        basePath="/admin/import-jobs"
        page={page}
        hasNext={page * result.pageSize < result.total}
        params={{ status: status === "all" ? undefined : status }}
      />
    </main>
  );
}

function positive(value: string | undefined): number {
  const parsed = Number.parseInt(value || "1", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
