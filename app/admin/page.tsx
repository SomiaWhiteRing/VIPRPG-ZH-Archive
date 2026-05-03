import { getAdminSummary } from "@/lib/server/db/admin-summary";
import { getAdminObservability } from "@/lib/server/db/admin-observability";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { canAccessSuperAdminRole } from "@/lib/server/auth/roles";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { runGcDryRun } from "@/lib/server/storage/admin-storage-checks";
import { AdminOperationPanel } from "@/app/admin/admin-operation-panel";
import Link from "next/link";

export const dynamic = "force-dynamic";

const links = [
  {
    href: "/api/admin/summary",
    label: "摘要 API",
  },
  {
    href: "/api/admin/observability",
    label: "观测 API",
  },
  {
    href: "/api/admin/consistency",
    label: "一致性检查",
  },
  {
    href: "/api/admin/gc/dry-run",
    label: "清理预演",
  },
  {
    href: "/api/health/db",
    label: "D1 检查",
  },
  {
    href: "/api/health/r2",
    label: "R2 检查",
  },
];

export default async function AdminPage() {
  const adminUser = await requireAdminPageUser("/admin");
  const [summary, observability, gcDryRun, unreadInboxCount] = await Promise.all([
    getAdminSummary(),
    getAdminObservability(),
    runGcDryRun({ sampleLimit: 5 }),
    countUnreadInboxItemsForUser(adminUser),
  ]);
  const isSuperAdmin = canAccessSuperAdminRole(adminUser.role);

  const metrics = [
    ["用户", summary.users.toLocaleString("zh-CN")],
    ["作品", summary.works.toLocaleString("zh-CN")],
    ["发布版本", summary.releases.toLocaleString("zh-CN")],
    ["归档快照", summary.archiveVersions.toLocaleString("zh-CN")],
    ["Blob 数", summary.blobs.count.toLocaleString("zh-CN")],
    ["Blob 容量", formatBytes(summary.blobs.sizeBytes)],
    ["Core pack 数", summary.corePacks.count.toLocaleString("zh-CN")],
    ["Core pack 容量", formatBytes(summary.corePacks.sizeBytes)],
    ["导入任务", summary.importJobs.toLocaleString("zh-CN")],
    ["下载构建记录", summary.downloadBuilds.toLocaleString("zh-CN")],
  ];
  const downloadMetrics = [
    ["总下载次数", formatNumber(observability.downloads.totalDownloadCount)],
    ["缓存命中", formatNumber(observability.downloads.cacheHitCount)],
    ["缓存未命中", formatNumber(observability.downloads.cacheMissCount)],
    ["下载失败", formatNumber(observability.downloads.failureCount)],
    ["实际 R2 读", formatNumber(observability.downloads.totalR2GetCount)],
    ["缓存节省 R2 读", formatNumber(observability.downloads.estimatedR2GetSavedByCache)],
    ["总出站 ZIP", formatBytes(observability.downloads.totalBytesServed)],
  ];
  const importMetrics = [
    ["导入状态", formatStatusCounts(observability.imports.statusCounts)],
    ["源文件容量", formatBytes(observability.imports.totalSourceSizeBytes)],
    ["归档容量", formatBytes(observability.imports.totalAcceptedSizeBytes)],
    ["排除容量", formatBytes(observability.imports.totalExcludedSizeBytes)],
    [
      "新增 blob",
      `${formatNumber(observability.imports.totalUploadedBlobCount)} / ${formatBytes(observability.imports.totalUploadedBlobSizeBytes)}`,
    ],
    [
      "新增 core pack",
      `${formatNumber(observability.imports.totalUploadedCorePackCount)} / ${formatBytes(observability.imports.totalUploadedCorePackSizeBytes)}`,
    ],
    ["Manifest 写入", formatBytes(observability.imports.totalManifestSizeBytes)],
    ["R2 Put", formatNumber(observability.imports.totalR2PutCount)],
    [
      "预检均耗时",
      formatDuration(Math.round(observability.imports.averagePreflightDurationMs)),
    ],
    [
      "提交均耗时",
      formatDuration(Math.round(observability.imports.averageCommitDurationMs)),
    ],
    [
      "缺失 blob",
      `${formatNumber(observability.imports.totalMissingBlobCount)} / ${formatBytes(observability.imports.totalMissingBlobSizeBytes)}`,
    ],
    [
      "缺失 core pack",
      `${formatNumber(observability.imports.totalMissingCorePackCount)} / ${formatBytes(observability.imports.totalMissingCorePackSizeBytes)}`,
    ],
  ];
  const gcMetrics = [
    [
      "可最终清理回收站",
      `${formatNumber(gcDryRun.archiveVersions.eligibleCount)} / ${formatNumber(gcDryRun.archiveVersions.eligibleFileCount)} 文件 / ${formatBytes(gcDryRun.archiveVersions.eligibleSizeBytes)}`,
    ],
    ["可清理 blob", `${formatNumber(gcDryRun.blobs.eligibleCount)} / ${formatBytes(gcDryRun.blobs.eligibleSizeBytes)}`],
    [
      "仅回收站引用 blob",
      `${formatNumber(gcDryRun.blobs.deletedOnlyReferenceCount)} / ${formatBytes(gcDryRun.blobs.deletedOnlyReferenceSizeBytes)}`,
    ],
    [
      "可清理 core pack",
      `${formatNumber(gcDryRun.corePacks.eligibleCount)} / ${formatBytes(gcDryRun.corePacks.eligibleSizeBytes)}`,
    ],
    [
      "仅回收站引用 core pack",
      `${formatNumber(gcDryRun.corePacks.deletedOnlyReferenceCount)} / ${formatBytes(gcDryRun.corePacks.deletedOnlyReferenceSizeBytes)}`,
    ],
  ];

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Prototype</p>
          <h1>最小可用存储模型</h1>
          <p className="subtitle">
            当前管理员：{adminUser.displayName}。页面展示 canonical storage
            计数、作品领域模型计数，并提供用户层级与站内信入口。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin/users">
            用户层级
          </Link>
          <Link className="button" href="/admin/archive-versions">
            归档维护
          </Link>
          <Link className="button" href="/admin/archive-versions/trash">
            归档回收站
          </Link>
          <Link className="button" href="/admin/works">
            作品资料
          </Link>
          <Link className="button" href="/admin/creators">
            作者资料
          </Link>
          {isSuperAdmin ? (
            <Link className="button" href="/admin/audit">
              审计日志
            </Link>
          ) : null}
          <Link className="button" href="/inbox">
            站内信
            {unreadInboxCount > 0 ? (
              <span className="notification-badge">
                {formatUnreadCount(unreadInboxCount)}
              </span>
            ) : null}
          </Link>
          <Link className="button" href="/">
            返回首页
          </Link>
        </div>
      </header>

      <section className="metric-grid" aria-label="存储摘要">
        {metrics.map(([label, value]) => (
          <article className="metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="section-grid" aria-label="Phase F 观测摘要">
        <section className="card">
          <h2>下载观测</h2>
          <dl className="detail-list">
            {downloadMetrics.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card">
          <h2>导入观测</h2>
          <dl className="detail-list">
            {importMetrics.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card">
          <h2>清理预演</h2>
          <p className="muted-line">
            这里展示清理预演候选，不删除 R2 对象；最终清理需要在运维检查中输入确认。
            回收站默认保留 {gcDryRun.graceDays} 天。
          </p>
          <dl className="detail-list">
            {gcMetrics.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </section>

      <AdminOperationPanel canRunFinalCleanup={isSuperAdmin} />

      <section className="card" style={{ marginTop: 16 }}>
        <h2>近期下载</h2>
        {observability.downloads.recent.length > 0 ? (
          <div className="table-wrap compact-table-wrap">
            <table className="data-table admin-ops-table">
              <thead>
                <tr>
                  <th>归档</th>
                  <th>次数</th>
                  <th>缓存</th>
                  <th>R2 读</th>
                  <th>最近状态</th>
                </tr>
              </thead>
              <tbody>
                {observability.downloads.recent.map((download) => (
                  <tr key={download.id}>
                    <td>
                      {download.workTitle}
                      <span className="muted-line">{download.archiveLabel}</span>
                    </td>
                    <td>{formatNumber(download.downloadCount)}</td>
                    <td>
                      {formatNumber(download.cacheHitCount)} hit /{" "}
                      {formatNumber(download.cacheMissCount)} miss
                      {download.failureCount > 0 ? (
                        <span className="muted-line">
                          {formatNumber(download.failureCount)} fail
                        </span>
                      ) : null}
                    </td>
                    <td>{formatNumber(download.totalR2GetCount)}</td>
                    <td>
                      {download.lastCacheStatus ?? "n/a"}
                      {download.lastDurationMs === null ? null : (
                        <span className="muted-line">
                          {formatDuration(download.lastDurationMs)}
                        </span>
                      )}
                      {download.lastErrorMessage ? (
                        <span className="muted-line">{download.lastErrorMessage}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-line">还没有下载观测记录。</p>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>近期导入</h2>
        {observability.imports.recent.length > 0 ? (
          <div className="table-wrap compact-table-wrap">
            <table className="data-table admin-ops-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>状态</th>
                  <th>新增对象</th>
                  <th>R2 Put</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {observability.imports.recent.map((job) => (
                  <tr key={job.id}>
                    <td>
                      #{job.id} {job.sourceName ?? "unknown"}
                      <span className="muted-line">
                        {job.archiveVersionId ? `ArchiveVersion #${job.archiveVersionId}` : "未提交"}
                      </span>
                    </td>
                    <td>
                      {job.status}
                      {job.failedStage ? (
                        <span className="muted-line">{job.failedStage}</span>
                      ) : null}
                    </td>
                    <td>
                      {formatNumber(job.uploadedBlobCount)} blob /{" "}
                      {formatNumber(job.uploadedCorePackCount)} pack
                      <span className="muted-line">
                        {formatBytes(
                          job.uploadedBlobSizeBytes + job.uploadedCorePackSizeBytes,
                        )}
                      </span>
                    </td>
                    <td>{formatNumber(job.r2PutCount)}</td>
                    <td>
                      preflight {formatNullableDuration(job.preflightDurationMs)}
                      <span className="muted-line">
                        upload {formatDuration(job.uploadDurationMs)} / commit{" "}
                        {formatNullableDuration(job.commitDurationMs)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-line">还没有导入任务。</p>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>高成本归档</h2>
        <div className="table-wrap compact-table-wrap">
          <table className="data-table admin-ops-table">
            <thead>
              <tr>
                <th>归档</th>
                <th>文件</th>
                <th>容量</th>
                <th>预计 R2 读</th>
              </tr>
            </thead>
            <tbody>
              {observability.downloads.expensiveArchives.map((archive) => (
                <tr key={archive.archiveVersionId}>
                  <td>
                    #{archive.archiveVersionId} {archive.workTitle}
                    <span className="muted-line">{archive.archiveLabel}</span>
                  </td>
                  <td>{formatNumber(archive.totalFiles)}</td>
                  <td>{formatBytes(archive.totalSizeBytes)}</td>
                  <td>{formatNumber(archive.estimatedR2GetCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>原型 API</h2>
        <p>
          这些接口用于验证绑定、查看观测数据、执行一致性检查和生成 GC
          演练报告。所有管理接口都要求管理员会话。
        </p>
        <div className="actions">
          {links.map((link) => (
            <a className="button" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </div>
        <pre className="code-block">{`GET /api/admin/observability
GET /api/admin/consistency
GET /api/admin/gc/dry-run
POST /api/admin/gc/sweep
POST /api/admin/archive-versions/{archiveVersionId}/delete
POST /api/admin/archive-versions/{archiveVersionId}/restore
PUT /api/blobs/{sha256}
PUT /api/core-packs/{sha256}
POST /api/imports/preflight`}</pre>
      </section>
    </main>
  );
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatStatusCounts(statusCounts: Array<{ status: string; count: number }>): string {
  if (statusCounts.length === 0) {
    return "0";
  }

  return statusCounts
    .map((item) => `${item.status} ${formatNumber(item.count)}`)
    .join(" / ");
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }

  return `${(ms / 1000).toFixed(1)} s`;
}

function formatNullableDuration(ms: number | null): string {
  return ms === null ? "n/a" : formatDuration(ms);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
