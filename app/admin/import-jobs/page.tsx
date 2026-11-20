import { requirePagePermission } from "@/app/.server/auth/authorize";
import { searchAdminImportJobs } from "@/app/.server/db/admin-observability";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { AdminListControls } from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { formatBytes, formatDate } from "@/lib/format";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { IMPORT_TASK_STATUS_OPTIONS, importTaskStatusLabel } from "@/lib/labels";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useLoaderData } from "react-router";

const STATUSES = ["all", ...IMPORT_TASK_STATUS_OPTIONS.map(({ value }) => value)] as const;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  await requirePagePermission(
    runtime,
    "/admin/import-jobs",
    "system.dashboard.read",
  );
  const params = await searchParams;
  const page = positive(
    Array.isArray(params.page) ? params.page[0] : params.page,
  );
  const rawStatus = Array.isArray(params.status)
    ? params.status[0]
    : params.status;
  const status = STATUSES.some((value) => value === rawStatus)
    ? rawStatus
    : "all";
  const result = await searchAdminImportJobs(runtime, {
    page,
    pageSize: 50,
    status,
  });

  return { page, status, result, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.imports.title"), translate(locale, "admin.characterIndex.console")], page: loaderData?.page }, error, locale);
};

export default function AdminImportJobsPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const { page, status, result } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        subtitle={t("admin.imports.subtitle")}
        title={t("admin.imports.title")}
      />
      <AdminListControls action="/admin/import-jobs" noun={t("admin.imports.task")} status={status}
        statusLabel={t("admin.imports.status")} statusOptions={STATUSES.map((value) => ({ value, label: value === "all" ? t("admin.works.all") : importTaskStatusLabel(value, locale) }))} total={result.total} pageSize={result.pageSize} />
      {result.items.length ? (
        <TableWrap compact label={t("admin.imports.title")} minWidth={900}>
          <thead>
            <tr>
              <th>{t("admin.imports.task")}</th>
              <th>{t("admin.list.status")}</th>
              <th>{t("admin.works.game")}</th>
              <th>{t("work.sidebar.uploader")}</th>
              <th>{t("admin.imports.files")}</th>
              <th>{t("admin.characterList.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((job) => (
              <tr key={job.id}>
                <td>
                  <Link className="admin-cell-title" to={`/admin/import-jobs/${job.id}`}>
                    #{job.id} {job.sourceName || t("admin.imports.unknown")}
                  </Link>
                </td>
                <td>
                  <StatusBadge kind="import-task" value={job.status} />
                </td>
                <td>
                  {job.workId ? (
                    <Link to={`/admin/works/${job.workId}`}>
                      {job.workTitle || `#${job.workId}`}
                    </Link>
                  ) : (
                    t("admin.imports.unlinked")
                  )}
                </td>
                <td>{job.uploaderName || t("play.diagnostic.unknown")}</td>
                <td>
                  {job.fileCount.toLocaleString(locale)} ({formatBytes(job.sourceSizeBytes || 0)})
                </td>
                <td className="whitespace-nowrap text-xs text-muted tabular-nums">{formatDate(job.updatedAt, { locale })}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState title={t("admin.imports.empty")} />
      )}
      <PaginationLinks
        basePath="/admin/import-jobs"
        page={page}
        pageSize={result.pageSize}
        params={{ status: status === "all" ? undefined : status }}
        total={result.total}
      />
    </main>
  );
}

function positive(value: string | undefined): number {
  const parsed = Number.parseInt(value || "1", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}
