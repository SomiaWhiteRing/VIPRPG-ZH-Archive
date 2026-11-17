import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { requirePagePermission } from "@/app/.server/auth/authorize";
import { searchCreatorsForAdmin } from "@/app/.server/db/creator-library";
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
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { formatDate } from "@/lib/format";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/creators",
    "creator.read_private",
  );
  const params = await searchParams;
  const query = searchParam(params.q);
  const sort = allowed(
    searchParam(params.sort),
    ["default", "name", "works"],
    "default",
  );
  const page = parseAdminPage(params.page);
  const result = await searchCreatorsForAdmin(runtime, {
    query,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    query,
    sort,
    page,
    result,
    locale: runtime.uiLocale,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.creators.title"), translate(locale, "admin.characterIndex.console")], page: loaderData?.page }, error, locale);
};

export default function AdminCreatorsPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const { adminUser, query, sort, page, result } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title={t("admin.creators.title")}
        subtitle={t("admin.creators.subtitle")}
        actions={
          <Link
            className={buttonVariants({ variant: "outline" })}
            to="/creators"
          >
            {t("admin.creators.publicList")}
          </Link>
        }
      />
      <AdminListControls
        action="/admin/creators"
        noun={t("admin.creators.creator")}
        query={query}
        sort={sort}
        sortOptions={[
          { value: "default", label: t("admin.creators.updated") },
          { value: "name", label: t("creator.name") },
          { value: "works", label: t("admin.creators.workCount") },
        ]}
        pageSize={PAGE_SIZE}
        total={result.total}
      />
      {result.items.length > 0 ? (
        <TableWrap compact label={t("creator.list")} minWidth={900}>
          <thead>
            <tr>
              <th>{t("admin.creators.creator")}</th>
              <th>{t("admin.creators.credits")}</th>
              <th>{t("admin.creators.links")}</th>
              <th className="admin-action-column">{t("admin.characterList.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((creator) => (
              <tr key={creator.id}>
                <td>
                  <strong className="admin-cell-title">{creator.name}</strong>
                </td>
                <td>
                  {t("admin.creators.count", { count: creator.workCreditCount })}
                  {creator.latestWorkCreditAt ? (
                    <span className="admin-cell-meta">
                      {t("admin.creators.latest", { date: formatDate(creator.latestWorkCreditAt, { locale }) })}
                    </span>
                  ) : null}
                </td>
                <td>
                  {creator.links.length ? creator.links.map((link, index) => (
                    <a
                      key={index}
                      className="block"
                      href={link.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {link.label}
                    </a>
                  )) : (
                    <span className="admin-cell-meta">{t("admin.creators.noLinks")}</span>
                  )}
                </td>
                <td className="admin-action-column">
                  {hasPermission(adminUser, "creator.metadata.update_any") ? (
                    <Link
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                      to={`/admin/creators/${creator.id}`}
                    >
                      {t("core.action.edit")}
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
        <EmptyState title={t("admin.creators.empty")} />
      )}
      <PaginationLinks
        basePath="/admin/creators"
        page={page}
        pageSize={PAGE_SIZE}
        total={result.total}
        params={{
          q: query || undefined,
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
