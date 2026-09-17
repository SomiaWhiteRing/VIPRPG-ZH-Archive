import { requirePagePermission } from "@/app/.server/auth/authorize";
import { searchAdminImportJobs } from "@/app/.server/db/admin-observability";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { SelectField } from "@/app/components/ui/select";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { formatBytes, formatDate } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { IMPORT_TASK_STATUS_OPTIONS } from "@/lib/labels";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  ...IMPORT_TASK_STATUS_OPTIONS,
];

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  await requirePagePermission(
    runtime,
    "/admin/import-jobs",
    "system.dashboard.read",
  );
  const params = await searchParams;
  const page = positive(
    Array.isArray(params.page) ? params.page[0] : params.page,
  );
  const rawStatus = Array.isArray(params.status)
    ? params.status[0]
    : params.status;
  const status = STATUS_OPTIONS.some((item) => item.value === rawStatus)
    ? rawStatus
    : "all";
  const result = await searchAdminImportJobs(runtime, {
    page,
    pageSize: 50,
    status,
  });

  return { page, status, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: ["上传任务", "控制台"], page: loaderData?.page }, error);

export default function AdminImportJobsPage() {
  const { page, status, result } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        subtitle={`共 ${result.total.toLocaleString("zh-CN")} 个任务`}
        title="上传任务"
      />
      <form className="flex items-end gap-3" method="get">
        <SelectField
          aria-label="任务状态"
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
          <thead>
            <tr>
              <th>任务</th>
              <th>状态</th>
              <th>作品</th>
              <th>上传者</th>
              <th>文件</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((job) => (
              <tr key={job.id}>
                <td>
                  <Link to={`/admin/import-jobs/${job.id}`}>
                    #{job.id} {job.sourceName || "未知来源"}
                  </Link>
                </td>
                <td>
                  <StatusBadge kind="import-task" value={job.status} />
                </td>
                <td>
                  {job.workId ? (
                    <Link to={`/admin/works/${job.workId}`}>
                      {job.workTitle || `#${job.workId}`}
                    </Link>
                  ) : (
                    "尚未关联"
                  )}
                </td>
                <td>{job.uploaderName || "未知"}</td>
                <td>
                  {job.fileCount.toLocaleString("zh-CN")} ·{" "}
                  {formatBytes(job.sourceSizeBytes || 0)}
                </td>
                <td>{formatDate(job.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState title="没有符合条件的上传任务。" />
      )}
      <PaginationLinks
        basePath="/admin/import-jobs"
        page={page}
        pageSize={result.pageSize}
        params={{ status: status === "all" ? undefined : status }}
        total={result.total}
      />
    </main>
  );
}

function positive(value: string | undefined): number {
  const parsed = Number.parseInt(value || "1", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
