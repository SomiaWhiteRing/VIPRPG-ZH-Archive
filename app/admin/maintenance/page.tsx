import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getAdminObservability } from "@/app/.server/db/admin-observability";
import { runtimeContext } from "@/app/.server/router-context";
import { runGcDryRun } from "@/app/.server/storage/admin-storage-checks";
import { AdminOperationPanel } from "@/app/admin/admin-operation-panel";
import { buttonVariants } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { formatBytes, formatDate, formatNullableDuration } from "@/lib/format";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useLoaderData } from "react-router";

const HEALTH_LINKS = [
  { href: "/api/health", label: "admin.maintenance.health" as const },
  { href: "/api/health/db", label: "admin.maintenance.db" as const },
  { href: "/api/health/r2", label: "admin.maintenance.r2" as const },
  { href: "/api/admin/summary", label: "admin.maintenance.summary" as const },
  { href: "/api/admin/observability", label: "admin.maintenance.observability" as const },
  { href: "/api/admin/consistency", label: "admin.maintenance.consistency" as const },
  { href: "/api/admin/gc/dry-run", label: "admin.maintenance.dryRun" as const },
];

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/maintenance",
    "system.maintenance.run",
  );
  const canRunFinalCleanup = hasPermission(adminUser, "storage.gc.sweep");

  const [observability, gcDryRun] = await Promise.all([
    getAdminObservability(runtime),
    runGcDryRun(runtime, { sampleLimit: 5 }),
  ]);

  const locale = runtime.uiLocale;
  const downloadMetrics: Array<[string, string]> = [
    [translate(locale, "admin.maintenance.full"), observability.downloads.fullDownloadCount.toLocaleString(locale)],
    [translate(locale, "admin.maintenance.range"), observability.downloads.rangeDownloadCount.toLocaleString(locale)],
    [translate(locale, "admin.maintenance.unclassifiedSuccess"), observability.downloads.unclassifiedDownloadCount.toLocaleString(locale)],
    [translate(locale, "admin.maintenance.cacheHit"), observability.downloads.cacheHitCount.toLocaleString(locale)],
    [translate(locale, "admin.maintenance.cacheMiss"), observability.downloads.cacheMissCount.toLocaleString(locale)],
    [translate(locale, "admin.maintenance.interrupted"), observability.downloads.interruptedCount.toLocaleString(locale)],
    [translate(locale, "admin.maintenance.serverError"), observability.downloads.serverFailureCount.toLocaleString(locale)],
    [translate(locale, "admin.maintenance.historicalError"), observability.downloads.unclassifiedFailureCount.toLocaleString(locale)],
    [translate(locale, "admin.maintenance.r2Reads"), observability.downloads.totalR2GetCount.toLocaleString(locale)],
    [
      translate(locale, "admin.maintenance.savedReads"),
      observability.downloads.estimatedR2GetSavedByCache.toLocaleString(locale),
    ],
    [translate(locale, "admin.maintenance.bytes"), formatBytes(observability.downloads.totalBytesServed)],
  ];

  const gcMetrics: Array<[string, string]> = [
    [
      translate(locale, "admin.maintenance.tools"),
      `${gcDryRun.toolArtifacts.eligibleCount.toLocaleString(locale)} / ${formatBytes(gcDryRun.toolArtifacts.eligibleSizeBytes)}`,
    ],
    [
      translate(locale, "admin.maintenance.archives"),
      translate(locale, "admin.maintenance.archiveSizes", { snapshots: gcDryRun.archiveVersions.eligibleCount, files: gcDryRun.archiveVersions.eligibleFileCount, size: formatBytes(gcDryRun.archiveVersions.eligibleSizeBytes) }),
    ],
    [
      translate(locale, "admin.maintenance.blobs"),
      `${gcDryRun.blobs.eligibleCount.toLocaleString(locale)} / ${formatBytes(gcDryRun.blobs.eligibleSizeBytes)}`,
    ],
    [
      translate(locale, "admin.maintenance.trashBlobs"),
      `${gcDryRun.blobs.deletedOnlyReferenceCount.toLocaleString(locale)} / ${formatBytes(gcDryRun.blobs.deletedOnlyReferenceSizeBytes)}`,
    ],
    [
      translate(locale, "admin.maintenance.packs"),
      `${gcDryRun.corePacks.eligibleCount.toLocaleString(locale)} / ${formatBytes(gcDryRun.corePacks.eligibleSizeBytes)}`,
    ],
    [
      translate(locale, "admin.maintenance.trashPacks"),
      `${gcDryRun.corePacks.deletedOnlyReferenceCount.toLocaleString(locale)} / ${formatBytes(gcDryRun.corePacks.deletedOnlyReferenceSizeBytes)}`,
    ],
  ];

  return {
    canRunFinalCleanup, gcDryRun, downloadMetrics, gcMetrics, locale,
    downloadFailures: observability.downloads.recentFailures,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.dashboard.maintenance"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function AdminMaintenancePage() {
  const t = useMessages();
  const locale = useUiLocale();
  const { canRunFinalCleanup, gcDryRun, downloadMetrics, gcMetrics, downloadFailures } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title={t("admin.dashboard.maintenance")}
        subtitle={t("admin.maintenance.subtitle")}
      />

      <Pane heading={t("admin.maintenance.readOnly")}>
        <div className="flex flex-wrap items-center gap-3">
          {HEALTH_LINKS.map((link) => (
            <a
              className={buttonVariants({ variant: "outline" })}
              href={link.href}
              key={link.href}
            >
              {t(link.label)}
            </a>
          ))}
        </div>
      </Pane>

      <section className="grid gap-3 md:grid-cols-2" aria-label={t("admin.maintenance.overview")}>
        <Pane heading={t("admin.dashboard.downloads")}>
          <p className="text-sm text-muted">
            {t("admin.maintenance.downloadNote")}
          </p>
          <StatList
            items={downloadMetrics.map(([label, value]) => ({ label, value }))}
          />
        </Pane>

        <Pane heading={t("admin.maintenance.preview")}>
          <p className="text-sm text-muted">
            {t("admin.maintenance.previewNote", { days: gcDryRun.graceDays })}
          </p>
          <StatList
            items={gcMetrics.map(([label, value]) => ({ label, value }))}
          />
        </Pane>
      </section>

      {downloadFailures.length > 0 ? (
        <Pane heading={t("admin.maintenance.recent")}>
          <p className="text-sm text-muted">
            {t("admin.maintenance.recentNote")}
          </p>
          <TableWrap compact label={t("admin.maintenance.recent")} minWidth={860}>
            <thead>
              <tr>
                <th>{t("admin.maintenance.version")}</th>
                <th>{t("admin.maintenance.failureCount")}</th>
                <th>{t("admin.maintenance.lastFailure")}</th>
                <th>{t("admin.maintenance.lastResult")}</th>
              </tr>
            </thead>
            <tbody>
              {downloadFailures.map((download) => (
                <tr key={download.id}>
                  <td>
                    <Link to={`/admin/archive-versions/${download.archiveVersionId}`}>
                      #{download.archiveVersionId} {download.workTitle}
                    </Link>
                    <div className="flex flex-wrap gap-x-2 text-sm text-muted">
                      <span>{download.archiveStatus === "deleted" ? t("admin.maintenance.deletedVersion") : download.isCurrent ? t("admin.archives.current") : t("admin.maintenance.oldVersion")}</span>
                      <span>{download.downloadProfile === "web-play" ? t("work.play") : t("admin.maintenance.zip")}</span>
                      <span>{t("admin.maintenance.record", { id: download.id })}</span>
                    </div>
                  </td>
                  <td>
                    {t("admin.maintenance.serverCount", { count: download.serverFailureCount })}
                    <div className="text-sm text-muted">
                      {t("admin.maintenance.otherCounts", { interrupted: download.interruptedCount, unknown: download.unclassifiedFailureCount })}
                    </div>
                  </td>
                  <td>
                    {download.lastFailureKind === "server" ? t("admin.maintenance.serverError") : download.lastFailureKind === "interrupted" ? t("admin.maintenance.interrupted") : t("admin.maintenance.unknownFailure")}
                    <div className="text-sm text-muted">
                      {download.lastFailureAt ? formatDate(download.lastFailureAt, { locale }) : t("admin.maintenance.noFailureAt")}
                      {download.lastFailureDurationMs !== null ? ` (${formatNullableDuration(download.lastFailureDurationMs)})` : ""}
                    </div>
                    <div className="max-w-sm break-words text-sm text-muted">
                      {download.lastErrorMessage ?? t("admin.maintenance.noReason")}
                    </div>
                  </td>
                  <td>
                    {download.status === "ready" ? t("admin.maintenance.success") : t("admin.maintenance.failed")}
                    <div className="text-sm text-muted">
                      {download.lastSuccessAt ? t("admin.maintenance.successAt", { date: formatDate(download.lastSuccessAt, { locale }) }) : download.downloadCount > 0 ? t("admin.maintenance.unknownSuccessAt") : t("admin.maintenance.noSuccess")}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Pane>
      ) : null}

      <Pane heading={t("admin.maintenance.operations")} tone="danger">
        <p className="text-sm">
          {t("admin.maintenance.permanent")}
        </p>
        <AdminOperationPanel canRunFinalCleanup={canRunFinalCleanup} />
      </Pane>
    </main>
  );
}
