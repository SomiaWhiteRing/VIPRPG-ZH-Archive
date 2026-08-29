import { buttonVariants } from "@/app/components/ui/button";
import { AdminOperationPanel } from "@/app/admin/admin-operation-panel";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { hasPermission } from "@/lib/authz/permissions";
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
  const adminUser = await requirePagePermission("/admin/maintenance", "system.maintenance.run");
  const canRunFinalCleanup = hasPermission(adminUser, "storage.gc.sweep");

  const [observability, gcDryRun] = await Promise.all([getAdminObservability(), runGcDryRun({ sampleLimit: 5 })]);

  const downloadMetrics: Array<[string, string]> = [
    ["总下载次数", formatNumber(observability.downloads.totalDownloadCount)],
    ["缓存命中", formatNumber(observability.downloads.cacheHitCount)],
    ["缓存未命中", formatNumber(observability.downloads.cacheMissCount)],
    ["下载失败", formatNumber(observability.downloads.failureCount)],
    ["对象存储读取", formatNumber(observability.downloads.totalR2GetCount)],
    ["缓存减少读取", formatNumber(observability.downloads.estimatedR2GetSavedByCache)],
    ["ZIP 下载流量", formatBytes(observability.downloads.totalBytesServed)],
  ];

  const gcMetrics: Array<[string, string]> = [
    [
      "可最终清理的文件版本",
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
      <PageHeader compact title="维护与一致性" subtitle="先检查当前状态和清理范围，再执行会修改数据的操作。" />

      <Pane heading="只读诊断">
        <div className="flex flex-wrap items-center gap-3">
          {HEALTH_LINKS.map((link) => (
            <a className={buttonVariants({ variant: "outline" })} href={link.href} key={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </Pane>

      <section className="grid gap-3 md:grid-cols-2" aria-label="观测摘要">
        <Pane heading="下载观测">
          <StatList items={downloadMetrics.map(([label, value]) => ({ label, value }))} />
        </Pane>

        <Pane heading="清理预演">
          <p className="text-sm text-muted">预演不会删除对象。回收站默认保留 {gcDryRun.graceDays} 天。</p>
          <StatList items={gcMetrics.map(([label, value]) => ({ label, value }))} />
        </Pane>
      </section>

      <Pane heading="执行维护" tone="danger">
        <p className="text-sm">最终清理会永久删除已进入清理范围的文件引用和对象，无法撤销。</p>
        <AdminOperationPanel canRunFinalCleanup={canRunFinalCleanup} />
      </Pane>
    </main>
  );
}
