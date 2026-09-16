import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getAdminImportJob } from "@/app/.server/db/admin-observability";
import { throwNotFound } from "@/app/.server/http/page-response";
import { BackLink } from "@/app/components/ui/back-link";
import { Notice } from "@/app/components/ui/notice";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { formatBytes, formatDate, formatNullableDuration } from "@/lib/format";
import { importTaskStageLabel } from "@/lib/labels";
import { Link } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const id = parseId((await params).importJobId);
  await requirePagePermission(
    runtime,
    `/admin/import-jobs/${id}`,
    "system.dashboard.read",
  );
  const job = await getAdminImportJob(runtime, id);
  if (!job) throwNotFound();

  return { job };
}

export default function AdminImportJobPage() {
  const { job } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        actions={<BackLink href="/admin/import-jobs" label="返回上传任务" />}
        compact
        subtitle={job.sourceName || "未知来源"}
        title={`上传任务 #${job.id}`}
      />
      <Pane heading="当前状态">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge kind="import-task" value={job.status} />
          {job.failedStage ? (
            <span className="text-sm text-muted">
              {importTaskStageLabel(job.failedStage)}
            </span>
          ) : null}
        </div>
        {job.errorMessage ? (
          <Notice tone="error" className="border p-3 text-sm">
            {job.errorMessage}
          </Notice>
        ) : null}
        <StatList
          columns={3}
          items={[
            { label: "创建", value: formatDate(job.createdAt) },
            { label: "更新", value: formatDate(job.updatedAt) },
            {
              label: "完成",
              value: job.completedAt ? formatDate(job.completedAt) : "—",
            },
            { label: "上传者", value: job.uploaderName || "未知" },
            {
              label: "作品",
              value: job.workId
                ? job.workTitle || `#${job.workId}`
                : "尚未关联",
            },
            {
              label: "归档版本",
              value: job.archiveVersionId ? `#${job.archiveVersionId}` : "—",
            },
          ]}
          variant="tiles"
        />
        <div className="flex flex-wrap gap-3 text-sm">
          {job.workId ? (
            <Link to={`/admin/works/${job.workId}`}>查看作品</Link>
          ) : null}
          {job.archiveVersionId ? (
            <Link to={`/admin/archive-versions/${job.archiveVersionId}`}>
              查看归档版本
            </Link>
          ) : null}
        </div>
      </Pane>
      <Pane heading="文件与存储">
        <StatList
          columns={3}
          items={[
            { label: "源文件", value: job.fileCount.toLocaleString("zh-CN") },
            { label: "源大小", value: formatBytes(job.sourceSizeBytes || 0) },
            {
              label: "排除",
              value: `${job.excludedFileCount.toLocaleString("zh-CN")} · ${formatBytes(job.excludedSizeBytes)}`,
            },
            {
              label: "缺少文件对象",
              value: job.missingBlobCount.toLocaleString("zh-CN"),
            },
            {
              label: "缺少公共包",
              value: job.missingCorePackCount.toLocaleString("zh-CN"),
            },
            {
              label: "对象写入",
              value: job.r2PutCount.toLocaleString("zh-CN"),
            },
            {
              label: "已上传文件对象",
              value: `${job.uploadedBlobCount.toLocaleString("zh-CN")} · ${formatBytes(job.uploadedBlobSizeBytes)}`,
            },
            {
              label: "已上传公共包",
              value: `${job.uploadedCorePackCount.toLocaleString("zh-CN")} · ${formatBytes(job.uploadedCorePackSizeBytes)}`,
            },
          ]}
          variant="tiles"
        />
      </Pane>
      <Pane heading="阶段耗时">
        <StatList
          columns={3}
          items={[
            {
              label: "预检",
              value: formatNullableDuration(job.preflightDurationMs),
            },
            {
              label: "上传",
              value: formatNullableDuration(job.uploadDurationMs),
            },
            {
              label: "提交",
              value: formatNullableDuration(job.commitDurationMs),
            },
          ]}
          variant="tiles"
        />
      </Pane>
      {job.excludedFileTypes.length ? (
        <Pane heading="排除文件">
          <TableWrap compact label="排除文件类型" minWidth={680}>
            <thead>
              <tr>
                <th>类型</th>
                <th>数量</th>
                <th>大小</th>
                <th>示例路径</th>
              </tr>
            </thead>
            <tbody>
              {job.excludedFileTypes.map((item) => (
                <tr key={item.fileType}>
                  <td>{item.fileType}</td>
                  <td>{item.fileCount}</td>
                  <td>{formatBytes(item.totalSizeBytes)}</td>
                  <td className="font-mono text-xs">
                    {item.examplePath || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Pane>
      ) : null}
    </main>
  );
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throwNotFound();
  return id;
}
