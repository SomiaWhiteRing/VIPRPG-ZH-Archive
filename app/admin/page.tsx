import Link from "next/link";
import { getAdminSummary } from "@/lib/server/db/admin-summary";
import { getAdminObservability } from "@/lib/server/db/admin-observability";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { canAccessSuperAdminRole } from "@/lib/server/auth/roles";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const adminUser = await requireAdminPageUser("/admin");
  const [summary, observability] = await Promise.all([
    getAdminSummary(),
    getAdminObservability(),
  ]);
  const isSuperAdmin = canAccessSuperAdminRole(adminUser.role);

  const metrics = [
    ["用户", formatNumber(summary.users)],
    ["作品", formatNumber(summary.works)],
    ["发布版本", formatNumber(summary.releases)],
    ["归档快照", formatNumber(summary.archiveVersions)],
    ["Blob 数", formatNumber(summary.blobs.count)],
    ["Blob 容量", formatBytes(summary.blobs.sizeBytes)],
    ["Core pack 数", formatNumber(summary.corePacks.count)],
    ["Core pack 容量", formatBytes(summary.corePacks.sizeBytes)],
    ["导入任务", formatNumber(summary.importJobs)],
    ["下载构建记录", formatNumber(summary.downloadBuilds)],
  ];

  const importStatus = observability.imports.statusCounts;
  const failedImports = importStatus.find((row) => row.status === "failed");
  const pendingImports = importStatus.filter((row) =>
    ["created", "preflighted", "uploading"].includes(row.status),
  );
  const totalPending = pendingImports.reduce(
    (acc, row) => acc + row.count,
    0,
  );

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Console</p>
          <h1>管理控制台</h1>
          <p className="subtitle">
            {adminUser.displayName}，欢迎。这里是健康摘要、待办与各模块入口。
          </p>
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

      <section className="card" style={{ marginTop: 16 }}>
        <h2>待办与告警</h2>
        <ul className="plain-list">
          <li>
            <strong>导入任务</strong>
            <span className="muted-line">
              进行中 {formatNumber(totalPending)} ·{" "}
              失败 {formatNumber(failedImports?.count ?? 0)}
            </span>
          </li>
          <li>
            <strong>下载</strong>
            <span className="muted-line">
              累计 {formatNumber(observability.downloads.totalDownloadCount)} ·{" "}
              失败 {formatNumber(observability.downloads.failureCount)}
            </span>
          </li>
        </ul>
        <div className="actions">
          <Link className="button" href="/admin/maintenance">
            前往维护与一致性
          </Link>
          {isSuperAdmin ? (
            <Link className="button" href="/admin/audit">
              查看审计日志
            </Link>
          ) : null}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>内容管理</h2>
        <p className="muted-line">
          按数据模型分组进入各管理模块。
        </p>
        <div className="admin-quick-nav">
          <Link className="button primary" href="/admin/works">
            作品
          </Link>
          <Link className="button" href="/admin/archive-versions">
            归档版本
          </Link>
          <Link className="button" href="/admin/archive-versions/trash">
            归档回收站
          </Link>
          <Link className="button" href="/admin/creators">
            作者
          </Link>
          <Link className="button" href="/admin/characters">
            角色
          </Link>
          <Link className="button" href="/admin/tags">
            标签
          </Link>
          <Link className="button" href="/admin/series">
            系列
          </Link>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>用户与权限</h2>
        <p className="muted-line">
          管理用户层级、处理上传者申请、查看审计行为。
        </p>
        <div className="admin-quick-nav">
          <Link className="button primary" href="/admin/users">
            用户层级
          </Link>
          <Link className="button" href="/inbox">
            站内信
          </Link>
          {isSuperAdmin ? (
            <Link className="button" href="/admin/audit">
              审计日志
            </Link>
          ) : null}
        </div>
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
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {observability.imports.recent.slice(0, 10).map((job) => (
                  <tr key={job.id}>
                    <td>
                      #{job.id} {job.sourceName ?? "unknown"}
                      <span className="muted-line">
                        {job.archiveVersionId
                          ? `ArchiveVersion #${job.archiveVersionId}`
                          : "未提交"}
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
                          job.uploadedBlobSizeBytes +
                            job.uploadedCorePackSizeBytes,
                        )}
                      </span>
                    </td>
                    <td>
                      preflight {formatNullableDuration(job.preflightDurationMs)}
                      <span className="muted-line">
                        commit {formatNullableDuration(job.commitDurationMs)}
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
    </main>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
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
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
