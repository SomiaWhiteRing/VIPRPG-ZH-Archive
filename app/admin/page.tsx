import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getAdminObservability } from "@/app/.server/db/admin-observability";
import { getAdminSummary } from "@/app/.server/db/admin-summary";
import { pickPageFields } from "@/app/.server/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { hasPermission } from "@/lib/authz/permissions";
import {
  formatBytes,
  formatNullableDuration,
  formatNumber,
} from "@/lib/format";
import { importTaskStageLabel } from "@/lib/labels";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin",
    "system.dashboard.read",
  );
  const [summary, observability] = await Promise.all([
    getAdminSummary(runtime),
    getAdminObservability(runtime),
  ]);
  const canReadAudit = hasPermission(adminUser, "audit.read");
  const canRunMaintenance = hasPermission(adminUser, "system.maintenance.run");

  const metrics = [
    ["用户", formatNumber(summary.users)],
    ["作品", formatNumber(summary.works)],
    ["文件版本", formatNumber(summary.archiveVersions)],
    ["对象存储", formatBytes(summary.blobs.sizeBytes)],
    ["公共文件", formatBytes(summary.corePacks.sizeBytes)],
    ["导入任务", formatNumber(summary.importJobs)],
  ];

  const importStatus = observability.imports.statusCounts;
  const failedImports = importStatus.find((row) => row.status === "failed");
  const pendingImports = importStatus.filter((row) =>
    [
      "created",
      "preflighted",
      "uploading_source",
      "awaiting_metadata",
      "uploading_metadata",
      "committing",
    ].includes(row.status),
  );
  const totalPending = pendingImports.reduce((acc, row) => acc + row.count, 0);

  return {
    adminUser: pickPageFields(adminUser, [
      "isBootstrapAdmin",
      "id",
      "status",
      "permissionKeys",
    ]),
    observability,
    canReadAudit,
    canRunMaintenance,
    metrics,
    failedImports,
    totalPending,
  };
}

export default function AdminPage() {
  const {
    adminUser,
    observability,
    canReadAudit,
    canRunMaintenance,
    metrics,
    failedImports,
    totalPending,
  } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title="管理控制台"
        subtitle="处理异常、检查近期任务并进入站点治理。"
      />

      <Pane heading="待办与告警">
        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            className="grid gap-1 rounded-md border border-border p-3 hover:border-primary/50"
            to="/admin/import-jobs"
          >
            <strong>导入与版本</strong>
            <span
              className={
                failedImports?.count
                  ? "text-sm text-red-700"
                  : "text-sm text-muted"
              }
            >
              进行中 {formatNumber(totalPending)} · 失败{" "}
              {formatNumber(failedImports?.count ?? 0)}
            </span>
          </Link>
          <Link
            className="grid gap-1 rounded-md border border-border p-3 hover:border-primary/50"
            to="/admin/maintenance"
          >
            <strong>下载构建</strong>
            <span
              className={
                observability.downloads.failureCount
                  ? "text-sm text-red-700"
                  : "text-sm text-muted"
              }
            >
              失败 {formatNumber(observability.downloads.failureCount)} · 累计{" "}
              {formatNumber(observability.downloads.totalDownloadCount)}
            </span>
          </Link>
        </div>
        {!failedImports?.count &&
        !totalPending &&
        !observability.downloads.failureCount ? (
          <EmptyState
            title="当前没有待处理的任务或失败记录。"
            variant="plain"
            className="mt-3"
          />
        ) : null}
      </Pane>

      <Pane heading="近期导入">
        {observability.imports.recent.length > 0 ? (
          <TableWrap compact label="近期导入" minWidth={760}>
            <thead>
              <tr>
                <th>任务</th>
                <th>状态</th>
                <th>新增对象</th>
                <th>耗时</th>
              </tr>
            </thead>
            <tbody>
              {observability.imports.recent.slice(0, 10).map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link to={`/admin/import-jobs/${job.id}`}>
                      #{job.id} {job.sourceName ?? "未知来源"}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge kind="import-task" value={job.status} />
                    {job.failedStage ? (
                      <span className="text-sm text-muted">
                        {importTaskStageLabel(job.failedStage)}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {formatNumber(job.uploadedBlobCount)} 个文件对象
                    <span className="text-sm text-muted">
                      {formatBytes(
                        job.uploadedBlobSizeBytes +
                          job.uploadedCorePackSizeBytes,
                      )}
                    </span>
                  </td>
                  <td>
                    检查 {formatNullableDuration(job.preflightDurationMs)}
                    <span className="text-sm text-muted">
                      入库 {formatNullableDuration(job.commitDurationMs)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState title="暂无导入任务。" />
        )}
      </Pane>

      <section className="border-y border-border py-3" aria-label="关键摘要">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="m-0 mt-1 font-mono text-sm font-semibold">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <Pane heading="系统治理" compact>
        <div className="flex flex-wrap items-center gap-2">
          {adminUser.isBootstrapAdmin ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/permissions"
            >
              角色与权限
            </Link>
          ) : null}
          {canRunMaintenance ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/maintenance"
            >
              维护与一致性
            </Link>
          ) : null}
          {canReadAudit ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/audit"
            >
              查看审计日志
            </Link>
          ) : null}
          {hasPermission(adminUser, "custom_emoji.manage") ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/emojis"
            >
              站点表情
            </Link>
          ) : null}
        </div>
      </Pane>
    </main>
  );
}
