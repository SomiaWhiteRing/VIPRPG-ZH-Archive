import { requirePagePermission } from "@/app/.server/auth/authorize";
import { searchEditableWorksForAdmin } from "@/app/.server/db/game-library";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  AdminListControls,
  parseAdminPage,
  searchParam,
} from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { buttonVariants } from "@/app/components/ui/button";
import { ChipList } from "@/app/components/ui/chip-list";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { formatBytes } from "@/lib/format";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/works",
    "work.read_private",
  );
  const params = await searchParams;
  const query = searchParam(params.q);
  const status = allowed(
    searchParam(params.status),
    ["all", "published", "processing", "deleted"],
    "all",
  );
  const sort = allowed(
    searchParam(params.sort),
    ["default", "title", "release"],
    "default",
  );
  const page = parseAdminPage(params.page);
  const result = await searchEditableWorksForAdmin(runtime, {
    query,
    status,
    sort: sort === "default" ? "id" : sort,
    page,
    pageSize: PAGE_SIZE,
  });

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    query,
    status,
    sort,
    page,
    locale: runtime.uiLocale,
    result,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.works.title"), translate(locale, "admin.characterIndex.console")], page: loaderData?.page }, error, locale);
};

export default function AdminWorksPage() {
  const t = useMessages();
  const { adminUser, query, status, sort, page, result } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title={t("admin.works.title")}
        subtitle={t("admin.works.subtitle")}
      />
      <AdminListControls
        action="/admin/works"
        noun={t("admin.works.game")}
        query={query}
        sort={sort}
        sortOptions={[
          { value: "default", label: t("admin.works.recent") },
          { value: "title", label: t("admin.works.gameTitle") },
          { value: "release", label: t("upload.metadata.published") },
        ]}
        status={status}
        statusOptions={[
          { value: "all", label: t("admin.works.all") },
          { value: "published", label: t("upload.own.status.published") },
          { value: "processing", label: t("admin.works.processing") },
          { value: "deleted", label: t("upload.own.status.deleted") },
        ]}
        pageSize={PAGE_SIZE}
        total={result.total}
      />

      {result.items.length > 0 ? (
        <TableWrap compact label={t("admin.works.table")} minWidth={980}>
          <thead>
            <tr>
              <th>{t("admin.works.game")}</th>
              <th>{t("admin.list.status")}</th>
              <th>{t("admin.works.size")}</th>
              <th>{t("upload.metadata.tags")}</th>
              <th className="admin-action-column">{t("admin.characterList.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((work) => (
              <tr key={work.id}>
                <td>
                  <strong className="admin-cell-title">{work.chineseTitle || work.originalTitle}</strong>
                  {work.chineseTitle ? (
                    <span className="admin-cell-meta">
                      {work.originalTitle}
                    </span>
                  ) : null}
                </td>
                <td>
                  <StatusBadge kind="publication" value={work.status} />
                </td>
                <td>
                  {work.distribution === "external" ? (
                    <span>{t("upload.external")}</span>
                  ) : (
                    <>
                      {t("admin.works.snapshots", { count: work.archiveVersionCount })}
                      <span className="admin-cell-meta">
                        {formatBytes(work.totalSizeBytes)}
                      </span>
                    </>
                  )}
                </td>
                <td>
                  {work.tags.length > 0 ? (
                    <ChipList
                      compact
                      items={work.tags
                        .slice(0, 6)
                        .map((tag) => ({ label: tag.name }))}
                    />
                  ) : (
                    <span className="admin-cell-meta">{t("admin.works.missing")}</span>
                  )}
                </td>
                <td className="admin-action-column">
                  {(hasPermission(adminUser, "work.metadata.update_any") || hasPermission(adminUser, "work.distribution.update_any")) &&
                  (work.status !== "deleted" ||
                    hasPermission(adminUser, "work.status.update_any")) ? (
                    <Link
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                      to={`/admin/works/${work.id}`}
                    >
                      {t("admin.works.edit")}
                    </Link>
                  ) : (
                    <span className="admin-cell-meta">{t("admin.characterList.readOnly")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState title={t("admin.works.empty")} />
      )}
      <PaginationLinks
        basePath="/admin/works"
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
