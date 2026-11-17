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
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import {
  formatBytes,
  formatNullableDuration,
} from "@/lib/format";
import { importTaskStageLabel } from "@/lib/labels";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useLoaderData } from "react-router";

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
    [translate(runtime.uiLocale, "admin.nav.users"), summary.users.toLocaleString(runtime.uiLocale)],
    [translate(runtime.uiLocale, "admin.works.game"), summary.works.toLocaleString(runtime.uiLocale)],
    [translate(runtime.uiLocale, "admin.archives.version"), summary.archiveVersions.toLocaleString(runtime.uiLocale)],
    [translate(runtime.uiLocale, "admin.dashboard.objectStorage"), formatBytes(summary.blobs.sizeBytes)],
    [translate(runtime.uiLocale, "admin.dashboard.shared"), formatBytes(summary.corePacks.sizeBytes)],
    [translate(runtime.uiLocale, "admin.dashboard.importJobs"), summary.importJobs.toLocaleString(runtime.uiLocale)],
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
    locale: runtime.uiLocale,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "admin.characterIndex.console") }, error, locale);
};

export default function AdminPage() {
  const t = useMessages();
  const locale = useUiLocale();
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
        title={t("admin.dashboard.title")}
        subtitle={t("admin.dashboard.subtitle")}
      />

      <Pane heading={t("admin.dashboard.alerts")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            className="grid gap-1 rounded-md border border-border p-3 hover:border-primary/50"
            to="/admin/import-jobs"
          >
            <strong>{t("admin.dashboard.imports")}</strong>
            <span
              className={
                failedImports?.count
                  ? "text-sm text-red-700 dark:text-red-300"
                  : "text-sm text-muted"
              }
            >
              {t("admin.dashboard.importCounts", { pending: totalPending, failed: failedImports?.count ?? 0 })}
            </span>
          </Link>
          <Link
            className="grid gap-1 rounded-md border border-border p-3 hover:border-primary/50"
            to="/admin/maintenance"
          >
            <strong>{t("admin.dashboard.downloads")}</strong>
            <span
              className={
                observability.downloads.currentServerFailureBuildCount
                  ? "text-sm text-red-700 dark:text-red-300"
                  : "text-sm text-muted"
              }
            >
              {t("admin.dashboard.downloadCounts", {
                failed: observability.downloads.currentServerFailureBuildCount,
                interrupted: observability.downloads.interruptedCount,
                unknown: observability.downloads.unclassifiedFailureCount,
              })}
            </span>
          </Link>
        </div>
        {!failedImports?.count &&
        !totalPending &&
        !observability.downloads.currentServerFailureBuildCount ? (
          <EmptyState
            title={t("admin.dashboard.emptyAlerts")}
            variant="plain"
            className="mt-3"
          />
        ) : null}
      </Pane>

      <Pane heading={t("admin.dashboard.recent")}>
        {observability.imports.recent.length > 0 ? (
          <TableWrap compact label={t("admin.dashboard.recent")} minWidth={760}>
            <thead>
              <tr>
                <th>{t("admin.imports.task")}</th>
                <th>{t("admin.list.status")}</th>
                <th>{t("admin.dashboard.objects")}</th>
                <th>{t("admin.dashboard.duration")}</th>
              </tr>
            </thead>
            <tbody>
              {observability.imports.recent.slice(0, 10).map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link to={`/admin/import-jobs/${job.id}`}>
                      #{job.id} {job.sourceName ?? t("admin.imports.unknown")}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge kind="import-task" value={job.status} />
                    {job.failedStage ? (
                      <span className="admin-cell-meta">
                        {importTaskStageLabel(job.failedStage, locale)}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {t("admin.dashboard.fileObjects", { count: job.uploadedBlobCount })}
                    <span className="admin-cell-meta">
                      {formatBytes(
                        job.uploadedBlobSizeBytes +
                          job.uploadedCorePackSizeBytes,
                      )}
                    </span>
                  </td>
                  <td>
                    {t("admin.dashboard.checkDuration", { duration: formatNullableDuration(job.preflightDurationMs) })}
                    <span className="admin-cell-meta">
                      {t("admin.dashboard.commitDuration", { duration: formatNullableDuration(job.commitDurationMs) })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState title={t("admin.dashboard.emptyImports")} />
        )}
      </Pane>

      <section className="border-y border-border py-3" aria-label={t("admin.dashboard.summary")}>
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

      <Pane heading={t("admin.dashboard.governance")} compact>
        <div className="flex flex-wrap items-center gap-2">
          {hasPermission(adminUser, "sea.message.moderate_any") || hasPermission(adminUser, "sea.user.mute_any") ? (
            <Link className={buttonVariants({ variant: "outline" })} to="/admin/sea">{t("admin.dashboard.sea")}</Link>
          ) : null}
          {adminUser.isBootstrapAdmin ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/home-recommendations"
            >
              {t("admin.dashboard.recommendations")}
            </Link>
          ) : null}
          {adminUser.isBootstrapAdmin ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/permissions"
            >
              {t("admin.dashboard.roles")}
            </Link>
          ) : null}
          {canRunMaintenance ? (
            <>
              <Link
                className={buttonVariants({ variant: "outline" })}
                to="/admin/netplay-spaces"
              >
                {t("admin.works.space")}
              </Link>
              <Link
                className={buttonVariants({ variant: "outline" })}
                to="/admin/maintenance"
              >
                {t("admin.dashboard.maintenance")}
              </Link>
            </>
          ) : null}
          {canReadAudit ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/audit"
            >
              {t("admin.dashboard.audit")}
            </Link>
          ) : null}
          {hasPermission(adminUser, "emoji.defaults.manage") ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/emojis"
            >
              {t("admin.nav.defaultEmojis")}
            </Link>
          ) : null}
        </div>
      </Pane>
    </main>
  );
}
