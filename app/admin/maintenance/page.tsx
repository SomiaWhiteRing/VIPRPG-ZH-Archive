import { AdminOperationPanel } from "@/app/admin/admin-operation-panel";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { canAccessSuperAdminRole } from "@/lib/server/auth/roles";
import { getAdminObservability } from "@/lib/server/db/admin-observability";
import { runGcDryRun } from "@/lib/server/storage/admin-storage-checks";
import { formatNumber, formatBytes } from "@/lib/format";

export const dynamic = "force-dynamic";

const HEALTH_LINKS = [
  { href: "/api/health", label: "查看运行状态" },
  { href: "/api/health/db", label: "检查数据库连接" },
  { href: "/api/health/r2", label: "检查对象存储连接" },
  { href: "/api/admin/summary", label: "查看管理摘要" },
  { href: "/api/admin/observability", label: "查看观测数据" },
  { href: "/api/admin/consistency", label: "运行一致性检查" },
  { href: "/api/admin/gc/dry-run", label: "运行清理预演" },
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
    ["对象存储读取", formatNumber(observability.downloads.totalR2GetCount)],
    [
      "缓存减少读取",
      formatNumber(observability.downloads.estimatedR2GetSavedByCache),
    ],
    ["ZIP 下载流量", formatBytes(observability.downloads.totalBytesServed)],
  ];

  const gcMetrics: Array<[string, string]> = [
    [
      "可最终清理的归档快照",
      `${formatNumber(gcDryRun.archiveVersions.eligibleCount)} 个快照 / ${formatNumber(gcDryRun.archiveVersions.eligibleFileCount)} 个文件 / ${formatBytes(gcDryRun.archiveVersions.eligibleSizeBytes)}`,
    ],
    [
      "可清理文件对象",
      `${formatNumber(gcDryRun.blobs.eligibleCount)} / ${formatBytes(gcDryRun.blobs.eligibleSizeBytes)}`,
    ],
    [
      "仅回收站引用的文件对象",
      `${formatNumber(gcDryRun.blobs.deletedOnlyReferenceCount)} / ${formatBytes(gcDryRun.blobs.deletedOnlyReferenceSizeBytes)}`,
    ],
    [
      "可清理引擎公共文件",
      `${formatNumber(gcDryRun.corePacks.eligibleCount)} / ${formatBytes(gcDryRun.corePacks.eligibleSizeBytes)}`,
    ],
    [
      "仅回收站引用的引擎公共文件",
      `${formatNumber(gcDryRun.corePacks.deletedOnlyReferenceCount)} / ${formatBytes(gcDryRun.corePacks.deletedOnlyReferenceSizeBytes)}`,
    ],
  ];

  return (
    <main>
      <PageHeader
        eyebrow="Maintenance"
        title="维护与一致性"
        actions={<BackLink href="/admin" label="返回控制台" />}
      />

      <Pane heading="健康检查">
        <div className="actions">
          {HEALTH_LINKS.map((link) => (
            <a className="button" href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </Pane>

      <section className="section-grid" aria-label="观测摘要">
        <Pane heading="下载观测">
          <StatList
            items={downloadMetrics.map(([label, value]) => ({ label, value }))}
          />
        </Pane>

        <Pane heading="清理预演">
          <p className="muted-line">
            预演不会删除对象。回收站默认保留 {gcDryRun.graceDays} 天。
          </p>
          <StatList items={gcMetrics.map(([label, value]) => ({ label, value }))} />
        </Pane>
      </section>

      <Pane heading="危险区" tone="danger">
        <p>最终清理会永久删除对象，无法撤销。</p>
        <AdminOperationPanel canRunFinalCleanup={isSuperAdmin} />
      </Pane>
    </main>
  );
}
