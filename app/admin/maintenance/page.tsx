import Link from "next/link";
import { AdminOperationPanel } from "@/app/admin/admin-operation-panel";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { canAccessSuperAdminRole } from "@/lib/server/auth/roles";
import { getAdminObservability } from "@/lib/server/db/admin-observability";
import { runGcDryRun } from "@/lib/server/storage/admin-storage-checks";

export const dynamic = "force-dynamic";

const HEALTH_LINKS = [
  { href: "/api/health", label: "运行时" },
  { href: "/api/health/db", label: "D1 binding" },
  { href: "/api/health/r2", label: "R2 binding" },
  { href: "/api/admin/summary", label: "摘要 API" },
  { href: "/api/admin/observability", label: "观测 API" },
  { href: "/api/admin/consistency", label: "一致性检查" },
  { href: "/api/admin/gc/dry-run", label: "清理预演" },
];

export default async function AdminMaintenancePage() {
  const adminUser = await requireAdminPageUser("/admin/maintenance");
  const isSuperAdmin = canAccessSuperAdminRole(adminUser.role);

  const [observability, gcDryRun] = await Promise.all([
    getAdminObservability(),
    runGcDryRun({ sampleLimit: 5 }),
  ]);

  const downloadMetrics: Array<[string, string]> = [
    ["总下载次数", formatNumber(observability.downloads.totalDownloadCount)],
    ["缓存命中", formatNumber(observability.downloads.cacheHitCount)],
    ["缓存未命中", formatNumber(observability.downloads.cacheMissCount)],
    ["下载失败", formatNumber(observability.downloads.failureCount)],
    ["实际 R2 读", formatNumber(observability.downloads.totalR2GetCount)],
    [
      "缓存节省 R2 读",
      formatNumber(observability.downloads.estimatedR2GetSavedByCache),
    ],
    ["总出站 ZIP", formatBytes(observability.downloads.totalBytesServed)],
  ];

  const gcMetrics: Array<[string, string]> = [
    [
      "可最终清理回收站",
      `${formatNumber(gcDryRun.archiveVersions.eligibleCount)} / ${formatNumber(gcDryRun.archiveVersions.eligibleFileCount)} 文件 / ${formatBytes(gcDryRun.archiveVersions.eligibleSizeBytes)}`,
    ],
    [
      "可清理 blob",
      `${formatNumber(gcDryRun.blobs.eligibleCount)} / ${formatBytes(gcDryRun.blobs.eligibleSizeBytes)}`,
    ],
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
          <p className="eyebrow">Maintenance</p>
          <h1>维护与一致性</h1>
          <p className="subtitle">
            健康检查、观测摘要、一致性检查、清理预演与最终清理。危险操作集中在本页底部的危险区。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button" href="/admin">
            返回控制台
          </Link>
        </div>
      </header>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>健康检查</h2>
        <p className="muted-line">
          直接打开下面的接口可以查看绑定状态与原始观测数据。这些接口要求管理员会话。
        </p>
        <div className="actions">
          {HEALTH_LINKS.map((link) => (
            <a className="button" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <section className="section-grid" aria-label="观测摘要" style={{ marginTop: 16 }}>
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
          <h2>清理预演</h2>
          <p className="muted-line">
            清理预演只列出候选，不删除 R2 对象；最终清理需要在下方危险区输入确认。
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

      <section className="danger-zone" aria-label="危险操作">
        <h2>危险区</h2>
        <p>
          以下操作会触发一致性检查、清理预演与对 R2 的真实清理。
          {isSuperAdmin
            ? "你拥有超管权限，可执行最终清理。"
            : "你不是超管，最终清理被禁用，但可以运行预演。"}
        </p>
        <AdminOperationPanel canRunFinalCleanup={isSuperAdmin} />
      </section>
    </main>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
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
