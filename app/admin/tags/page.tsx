import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate, isMessageKey } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { requirePagePermission } from "@/app/.server/auth/authorize";
import { searchTagsForAdmin } from "@/app/.server/db/taxonomy-library";
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
import { namespaceLabel } from "@/lib/labels";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/tags",
    "tag.read_private",
  );
  const params = await searchParams;
  const query = searchParam(params.q);
  const namespace = allowed(
    searchParam(params.status),
    ["all", "genre", "theme", "character", "technical", "content", "other"],
    "all",
  );
  const sort = allowed(
    searchParam(params.sort),
    ["default", "name", "works"],
    "default",
  );
  const page = parseAdminPage(params.page);
  const result = await searchTagsForAdmin(runtime, {
    query,
    namespace,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  return {
    locale: runtime.uiLocale,
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    query,
    namespace,
    sort,
    page,
    result,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, "admin.tags.title");
  const consoleTitle = translate(locale, "admin.characterIndex.console");
  return pageMetaDescriptors({ title: [title, consoleTitle], page: loaderData?.page }, error, locale);
};

export default function AdminTagsPage() {
  const t = useMessages();
  const { adminUser, query, namespace, sort, page, result } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title={t("admin.tags.title")}
        subtitle={t("admin.tags.subtitle")}
        actions={
          <Link className={buttonVariants({ variant: "outline" })} to="/tags">
            {t("admin.creators.publicList")}
          </Link>
        }
      />
      <AdminListControls
        action="/admin/tags"
        noun={t("admin.tags.tag")}
        query={query}
        status={namespace}
        statusLabel={t("admin.tags.namespace")}
        statusOptions={[
          { value: "all", label: t("admin.tags.all") },
          { value: "genre", label: t("admin.tags.genre") },
          { value: "theme", label: t("admin.tags.theme") },
          { value: "character", label: t("admin.tags.character") },
          { value: "technical", label: t("admin.tags.technical") },
          { value: "content", label: t("admin.tags.content") },
          { value: "other", label: t("admin.tags.other") },
        ]}
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
        <TableWrap compact label={t("admin.tags.list")} minWidth={900}>
          <thead>
            <tr>
              <th>{t("admin.tags.tag")}</th>
              <th>{t("admin.tags.namespace")}</th>
              <th>{t("admin.creators.credits")}</th>
              <th className="admin-action-column">{t("admin.characterList.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((tag) => (
              <tr key={tag.name}>
                <td>
                  <strong className="admin-cell-title">{tag.name}</strong>
                </td>
                <td>{(() => {
                  const key = `admin.tags.${tag.namespace}`;
                  return isMessageKey(key) ? t(key) : namespaceLabel(tag.namespace);
                })()}</td>
                <td>{t("admin.creators.count", { count: tag.workCount })}</td>
                <td className="admin-action-column">
                  {hasPermission(adminUser, "tag.metadata.update_any") ? (
                    <Link
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                      to={`/admin/tags/edit?name=${encodeURIComponent(tag.name)}`}
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
        <EmptyState title={t("admin.tags.empty")} />
      )}
      <PaginationLinks
        basePath="/admin/tags"
        page={page}
        pageSize={PAGE_SIZE}
        total={result.total}
        params={{
          q: query || undefined,
          status: namespace === "all" ? undefined : namespace,
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
