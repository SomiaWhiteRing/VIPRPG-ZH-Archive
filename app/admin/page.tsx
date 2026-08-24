import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { getAdminSummary } from "@/lib/server/db/admin-summary";
import { getAdminObservability } from "@/lib/server/db/admin-observability";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { hasPermission } from "@/lib/authz/permissions";
import { formatNumber, formatNullableDuration, formatBytes } from "@/lib/format";
import { importTaskStageLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const adminUser = await requirePagePermission("/admin", "system.dashboard.read");
  const [summary, observability] = await Promise.all([getAdminSummary(), getAdminObservability()]);
  const canReadAudit = hasPermission(adminUser, "audit.read");
  const canRunMaintenance = hasPermission(adminUser, "system.maintenance.run");

  const metrics = [
    ["用户", formatNumber(summary.users)],
    ["作品", formatNumber(summary.works)],
    ["发布版本", formatNumber(summary.releases)],
    ["文件版本", formatNumber(summary.archiveVersions)],
    ["文件对象数", formatNumber(summary.blobs.count)],
    ["文件对象容量", formatBytes(summary.blobs.sizeBytes)],
    ["引擎公共文件数", formatNumber(summary.corePacks.count)],
    ["引擎公共文件容量", formatBytes(summary.corePacks.sizeBytes)],
    ["导入任务", formatNumber(summary.importJobs)],
    ["下载构建记录", formatNumber(summary.downloadBuilds)],
  ];

  const importStatus = observability.imports.statusCounts;
  const failedImports = importStatus.find((row) => row.status === "failed");
  const pendingImports = importStatus.filter((row) => ["created", "preflighted", "uploading"].includes(row.status));
  const totalPending = pendingImports.reduce((acc, row) => acc + row.count, 0);

  return (
    <main>
      <PageHeader eyebrow="Admin Console" title="管理控制台" />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="存储摘要">
        {metrics.map(([label, value]) => (
          <article className="min-h-24 rounded-lg border border-border bg-card p-4 shadow-sm" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <Pane heading="待办与告警">
        <ul className="mt-3 grid gap-3">
          <li>
            <strong>导入任务</strong>
            <span className="text-sm text-muted">
              进行中 {formatNumber(totalPending)} · 失败 {formatNumber(failedImports?.count ?? 0)}
            </span>
          </li>
          <li>
            <strong>下载</strong>
            <span className="text-sm text-muted">
              累计 {formatNumber(observability.downloads.totalDownloadCount)} · 失败{" "}
              {formatNumber(observability.downloads.failureCount)}
            </span>
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          {adminUser.isBootstrapAdmin ? (
            <Link className={buttonVariants({ variant: "outline" })} href="/admin/permissions">
              角色与权限
            </Link>
          ) : null}
          {canRunMaintenance ? (
            <Link className={buttonVariants({ variant: "outline" })} href="/admin/maintenance">
              维护与一致性
            </Link>
          ) : null}
          {canReadAudit ? (
            <Link className={buttonVariants({ variant: "outline" })} href="/admin/audit">
              查看审计日志
            </Link>
          ) : null}
        </div>
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
                    #{job.id} {job.sourceName ?? "未知来源"}
                    <span className="text-sm text-muted">
                      {job.archiveVersionId ? `文件版本 #${job.archiveVersionId}` : "未提交"}
                    </span>
                  </td>
                  <td>
                    <StatusBadge kind="import-task" value={job.status} />
                    {job.failedStage ? (
                      <span className="text-sm text-muted">{importTaskStageLabel(job.failedStage)}</span>
                    ) : null}
                  </td>
                  <td>
                    {formatNumber(job.uploadedBlobCount)} 个文件对象 / {formatNumber(job.uploadedCorePackCount)}{" "}
                    个引擎公共文件
                    <span className="text-sm text-muted">
                      {formatBytes(job.uploadedBlobSizeBytes + job.uploadedCorePackSizeBytes)}
                    </span>
                  </td>
                  <td>
                    上传前检查 {formatNullableDuration(job.preflightDurationMs)}
                    <span className="text-sm text-muted">提交入库 {formatNullableDuration(job.commitDurationMs)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState title="暂无导入任务。" />
        )}
      </Pane>
    </main>
  );
}
