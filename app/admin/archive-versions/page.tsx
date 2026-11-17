import { requirePagePermission } from "@/app/.server/auth/authorize";
import { searchArchiveVersionsForAdmin } from "@/app/.server/db/archive-maintenance";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  AdminListControls,
  parseAdminPage,
  searchParam,
} from "@/app/admin/admin-list-controls";
import { ArchiveVersionTable } from "@/app/admin/archive-versions/archive-version-table";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { buttonVariants } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { useLoaderData } from "react-router";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/archive-versions",
    "archive_version.read_private",
  );
  const params = await searchParams;
  const query = searchParam(params.q);
  const status = allowed(
    searchParam(params.status),
    ["all", "published", "processing", "hidden"],
    "all",
  );
  const sort = allowed(
    searchParam(params.sort),
    ["default", "size"],
    "default",
  );
  const page = parseAdminPage(params.page);
  const result = await searchArchiveVersionsForAdmin(runtime, {
    actor: adminUser,
    filter: "active",
    query,
    status,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });
  const canAccessTrash = hasPermission(adminUser, "archive_version.restore");

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    query,
    status,
    sort,
    page,
    locale: runtime.uiLocale,
    result,
    canAccessTrash,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.archives.title"), translate(locale, "admin.characterIndex.console")], page: loaderData?.page }, error, locale);
};

export default function AdminArchiveVersionsPage() {
  const t = useMessages();
  const { adminUser, query, status, sort, page, result, canAccessTrash } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title={t("admin.archives.title")}
        subtitle={
          canAccessTrash
            ? t("admin.archives.cleanupNote")
            : t("admin.archives.restoreNote")
        }
        actions={
          canAccessTrash ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/archive-versions/trash"
            >
              {t("admin.archives.viewTrash")}
            </Link>
          ) : null
        }
      />
      <AdminListControls
        action="/admin/archive-versions"
        noun={t("admin.archives.version")}
        query={query}
        sort={sort}
        sortOptions={[
          { value: "default", label: t("admin.works.recent") },
          { value: "size", label: t("admin.archives.capacity") },
        ]}
        status={status}
        statusOptions={[
          { value: "all", label: t("admin.works.all") },
          { value: "published", label: t("upload.own.status.published") },
          { value: "processing", label: t("admin.works.processing") },
          { value: "hidden", label: t("upload.own.status.hidden") },
        ]}
        pageSize={PAGE_SIZE}
        total={result.total}
      />
      <ArchiveVersionTable
        actor={adminUser}
        archiveVersions={result.items}
        mode="active"
      />
      <PaginationLinks
        basePath="/admin/archive-versions"
        page={page}
        pageSize={PAGE_SIZE}
        total={result.total}
        params={{
          q: query || undefined,
          status: status === "all" ? undefined : status,
          sort: sort === "default" ? undefined : sort,
        }}
      />
    </main>
  );
}

function allowed<T extends string>(
  value: string,
  values: readonly T[],
  fallback: T,
): T {
  return values.includes(value as T) ? (value as T) : fallback;
}
