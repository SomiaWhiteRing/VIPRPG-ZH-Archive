import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { requirePagePermission } from "@/app/.server/auth/authorize";
import { listArchiveVersionsForAdmin } from "@/app/.server/db/archive-maintenance";
import { pickPageFields } from "@/app/.server/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { ArchiveVersionTable } from "@/app/admin/archive-versions/archive-version-table";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/archive-versions/trash",
    "archive_version.restore",
  );
  const archiveVersions = await listArchiveVersionsForAdmin(
    runtime,
    150,
    "trash",
    adminUser,
  );

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    archiveVersions,
    locale: runtime.uiLocale,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.archives.trashTitle"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function AdminArchiveVersionTrashPage() {
  const t = useMessages();
  const { adminUser, archiveVersions } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        title={t("admin.archives.trashTitle")}
        subtitle={t("admin.archives.trashSubtitle")}
        actions={
          <BackLink href="/admin/archive-versions" label={t("admin.archives.back")} />
        }
      />

      <ArchiveVersionTable
        actor={adminUser}
        archiveVersions={archiveVersions}
        mode="trash"
      />
    </main>
  );
}
