import { parsePageId, throwNotFound } from "@/app/.server/http/page-response";
import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getArchiveVersionForAdminEdit } from "@/app/.server/db/game-library";

import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { SelectField } from "@/app/components/ui/select";
import { StatList } from "@/app/components/ui/stat-list";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { formatBytes, formatDate } from "@/lib/format";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { type LoaderFunctionArgs, type MetaFunction, useLoaderData } from "react-router";

import { RedirectForm } from "@/app/components/ui/redirect-form";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const archiveVersionId = parsePageId((await params).archiveVersionId);
  const adminUser = await requirePagePermission(
    runtime,
    `/admin/archive-versions/${archiveVersionId}`,
    "archive_version.update",
  );
  const archiveVersion = await getArchiveVersionForAdminEdit(
    runtime,
    archiveVersionId,
  );
  if (!archiveVersion) throwNotFound();

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    archiveVersion,
    locale: runtime.uiLocale,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const archive = loaderData?.archiveVersion;
  return pageMetaDescriptors(
    {
      title: [
        archive?.workTitle || translate(locale, "admin.works.game"),
        archive ? translate(locale, "admin.archiveDetail.numbered", { id: archive.id }) : translate(locale, "admin.archiveDetail.detail"),
        translate(locale, "admin.characterIndex.console"),
      ],
    },
    error,
    locale,
  );
};

export default function AdminArchiveVersionEditPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const { adminUser, archiveVersion } = useLoaderData<typeof loader>();
  return (
    <main key={archiveVersion.id}>
      <PageHeader
        compact
        eyebrow={t("admin.archiveDetail.editSnapshot")}
        title={t("admin.archiveDetail.numbered", { id: archiveVersion.id })}
        subtitle={t("admin.archiveDetail.game", { title: archiveVersion.workTitle })}
        actions={
          <>
            <BackLink href="/admin/archive-versions" label={t("admin.archives.back")} />
            {hasPermission(adminUser, "work.metadata.update_any") || hasPermission(adminUser, "work.distribution.update_any") ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to={`/admin/works/${archiveVersion.workId}`}
              >
                {t("admin.archiveDetail.editGame")}
              </Link>
            ) : null}
            <Link
              className={buttonVariants({ variant: "outline" })}
              to={`/games/${archiveVersion.workId}`}
            >
              {t("admin.archiveDetail.publicPage")}
            </Link>
          </>
        }
      />
      <RedirectForm
        action={`/api/admin/archive-versions/${archiveVersion.id}/update`}
        preserveLanguage
        className="grid gap-4"
        method="post"
      >
        <input
          name="archive_version_id"
          type="hidden"
          value={archiveVersion.id}
        />
        <Pane heading={t("admin.archiveDetail.snapshot")}>
          <SectionHeading title={t("admin.archiveDetail.scope")} />
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              controlId="admin-archive-versions-archiveVersionId--field-1"
              label={t("admin.list.status")}
            >
              <SelectField
                id="admin-archive-versions-archiveVersionId--field-1"
                aria-label={t("admin.list.status")}
                defaultValue={archiveVersion.status}
                name="status"
                options={[
                  { value: "published", label: t("upload.own.status.published") },
                  { value: "hidden", label: t("upload.own.status.hidden") },
                ]}
              />
            </FormField>
            <FormField
              controlId="admin-archive-versions-archiveVersionId--field-2"
              label={t("admin.archiveDetail.sourceName")}
            >
              <Input
                id="admin-archive-versions-archiveVersionId--field-2"
                defaultValue={archiveVersion.sourceName ?? ""}
                name="source_name"
              />
            </FormField>
            <FormField
              controlId="admin-archive-versions-archiveVersionId--field-3"
              label={t("admin.archiveDetail.sourceUrl")}
            >
              <Input
                id="admin-archive-versions-archiveVersionId--field-3"
                defaultValue={archiveVersion.sourceUrl ?? ""}
                name="source_url"
                type="url"
              />
            </FormField>
          </div>
        </Pane>
        <StickySaveBar>
          <Button type="submit">{t("admin.archiveDetail.save")}</Button>
          {hasPermission(adminUser, "archive_version.set_current") &&
          archiveVersion.status === "published" &&
          !archiveVersion.isCurrent ? (
            <Button
              form="set-current-archive-version"
              type="submit"
              variant="outline"
            >
              {t("admin.archives.setCurrent")}
            </Button>
          ) : null}
        </StickySaveBar>
      </RedirectForm>
      {hasPermission(adminUser, "archive_version.set_current") &&
      archiveVersion.status === "published" &&
      !archiveVersion.isCurrent ? (
        <RedirectForm
          action={`/api/admin/archive-versions/${archiveVersion.id}/current`}
          preserveLanguage
          id="set-current-archive-version"
          method="post"
        />
      ) : null}
      <section className="grid gap-4 md:grid-cols-3">
        <Pane heading={t("admin.list.status")}>
          <StatList
            items={[
              {
                label: t("admin.list.status"),
                value: (
                  <StatusBadge kind="archive" value={archiveVersion.status} />
                ),
              },
              {
                label: t("admin.archiveDetail.currentSnapshot"),
                value: t(archiveVersion.isCurrent ? "admin.archiveDetail.yes" : "admin.archiveDetail.no"),
              },
              { label: t("work.sidebar.uploader"), value: archiveVersion.uploaderName ?? t("play.diagnostic.unknown") },
              {
                label: t("admin.archiveDetail.publishedAt"),
                value: archiveVersion.publishedAt
                  ? formatDate(archiveVersion.publishedAt, { locale })
                  : t("admin.archiveDetail.unpublished"),
              },
            ]}
          />
        </Pane>
        <Pane heading={t("admin.works.size")}>
          <StatList
            items={[
              {
                label: t("admin.archiveDetail.fileCount"),
                value: archiveVersion.totalFiles.toLocaleString(locale),
              },
              {
                label: t("admin.archives.capacity"),
                value: formatBytes(archiveVersion.totalSizeBytes),
              },
              {
                label: t("admin.archiveDetail.reads"),
                value: archiveVersion.estimatedR2GetCount.toLocaleString(locale),
              },
              {
                label: t("admin.archiveDetail.created"),
                value: formatDate(archiveVersion.createdAt, { locale }),
              },
            ]}
          />
        </Pane>
        <Pane heading={t("admin.archiveDetail.manifest")}>
          <StatList
            items={[
              {
                label: "SHA-256",
                value: (
                  <span className="font-mono text-sm">
                    {archiveVersion.manifestSha256}
                  </span>
                ),
              },
              { label: t("admin.archiveDetail.policy"), value: archiveVersion.filePolicyVersion },
              { label: t("admin.archiveDetail.packer"), value: archiveVersion.packerVersion },
            ]}
          />
        </Pane>
      </section>
    </main>
  );
}
