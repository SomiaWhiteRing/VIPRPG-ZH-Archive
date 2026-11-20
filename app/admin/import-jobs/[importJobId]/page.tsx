import { parsePageId, throwNotFound } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { type LoaderFunctionArgs, type MetaFunction, useLoaderData } from "react-router";


import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getAdminImportJob } from "@/app/.server/db/admin-observability";

import { BackLink } from "@/app/components/ui/back-link";
import { Notice } from "@/app/components/ui/notice";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { formatBytes, formatDate, formatNullableDuration } from "@/lib/format";
import { importTaskStageLabel } from "@/lib/labels";


export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const id = parsePageId((await params).importJobId);
  await requirePagePermission(
    runtime,
    `/admin/import-jobs/${id}`,
    "system.dashboard.read",
  );
  const job = await getAdminImportJob(runtime, id);
  if (!job) throwNotFound();

  return { job, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = loaderData ? translate(locale, "admin.imports.numbered", { id: loaderData.job.id }) : translate(locale, "admin.imports.title");
  return pageMetaDescriptors({ title: [title, translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function AdminImportJobPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const { job } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        actions={<BackLink href="/admin/import-jobs" label={t("admin.imports.back")} />}
        compact
        subtitle={job.sourceName || t("admin.imports.unknown")}
        title={t("admin.imports.numbered", { id: job.id })}
      />
      <Pane heading={t("admin.imports.current")}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge kind="import-task" value={job.status} />
          {job.failedStage ? (
            <span className="text-sm text-muted">
              {importTaskStageLabel(job.failedStage, locale)}
            </span>
          ) : null}
        </div>
        {job.errorMessage ? (
          <Notice tone="error" className="border p-3 text-sm">
            {job.errorMessage}
          </Notice>
        ) : null}
        <StatList
          columns={3}
          items={[
            { label: t("admin.imports.created"), value: formatDate(job.createdAt, { locale }) },
            { label: t("admin.imports.updated"), value: formatDate(job.updatedAt, { locale }) },
            {
              label: t("admin.imports.complete"),
              value: job.completedAt ? formatDate(job.completedAt, { locale }) : "—",
            },
            { label: t("work.sidebar.uploader"), value: job.uploaderName || t("play.diagnostic.unknown") },
            {
              label: t("admin.works.game"),
              value: job.workId
                ? job.workTitle || `#${job.workId}`
                : t("admin.imports.unlinked"),
            },
            {
              label: t("admin.imports.archive"),
              value: job.archiveVersionId ? `#${job.archiveVersionId}` : "—",
            },
          ]}
          variant="tiles"
        />
        <div className="flex flex-wrap gap-3 text-sm">
          {job.workId ? (
            <Link to={`/admin/works/${job.workId}`}>{t("upload.view")}</Link>
          ) : null}
          {job.archiveVersionId ? (
            <Link to={`/admin/archive-versions/${job.archiveVersionId}`}>
              {t("admin.imports.viewArchive")}
            </Link>
          ) : null}
        </div>
      </Pane>
      <Pane heading={t("admin.imports.storage")}>
        <StatList
          columns={3}
          items={[
            { label: t("admin.imports.sourceFiles"), value: job.fileCount.toLocaleString(locale) },
            { label: t("admin.imports.sourceSize"), value: formatBytes(job.sourceSizeBytes || 0) },
            {
              label: t("admin.imports.excluded"),
              value: `${job.excludedFileCount.toLocaleString(locale)} (${formatBytes(job.excludedSizeBytes)})`,
            },
            {
              label: t("admin.imports.missingBlob"),
              value: job.missingBlobCount.toLocaleString(locale),
            },
            {
              label: t("admin.imports.missingPack"),
              value: job.missingCorePackCount.toLocaleString(locale),
            },
            {
              label: t("admin.imports.writes"),
              value: job.r2PutCount.toLocaleString(locale),
            },
            {
              label: t("admin.imports.uploadedBlobs"),
              value: `${job.uploadedBlobCount.toLocaleString(locale)} (${formatBytes(job.uploadedBlobSizeBytes)})`,
            },
            {
              label: t("admin.imports.uploadedPacks"),
              value: `${job.uploadedCorePackCount.toLocaleString(locale)} (${formatBytes(job.uploadedCorePackSizeBytes)})`,
            },
          ]}
          variant="tiles"
        />
      </Pane>
      <Pane heading={t("admin.imports.durations")}>
        <StatList
          columns={3}
          items={[
            {
              label: t("admin.imports.preflight"),
              value: formatNullableDuration(job.preflightDurationMs),
            },
            {
              label: t("core.nav.upload"),
              value: formatNullableDuration(job.uploadDurationMs),
            },
            {
              label: t("admin.imports.commit"),
              value: formatNullableDuration(job.commitDurationMs),
            },
          ]}
          variant="tiles"
        />
      </Pane>
      {job.excludedFileTypes.length ? (
        <Pane heading={t("admin.imports.excludedFiles")}>
          <TableWrap compact label={t("admin.imports.excludedTypes")} minWidth={680}>
            <thead>
              <tr>
                <th>{t("upload.metadata.genre")}</th>
                <th>{t("admin.imports.count")}</th>
                <th>{t("admin.works.size")}</th>
                <th>{t("admin.imports.example")}</th>
              </tr>
            </thead>
            <tbody>
              {job.excludedFileTypes.map((item) => (
                <tr key={item.fileType}>
                  <td>{item.fileType}</td>
                  <td>{item.fileCount.toLocaleString(locale)}</td>
                  <td>{formatBytes(item.totalSizeBytes)}</td>
                  <td className="font-mono text-xs">
                    {item.examplePath || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Pane>
      ) : null}
    </main>
  );
}
