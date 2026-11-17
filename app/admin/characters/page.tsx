import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { searchCharactersForAdmin } from "@/app/.server/db/taxonomy-library";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  AdminListControls,
  parseAdminPage,
  searchParam,
} from "@/app/admin/admin-list-controls";
import { CharacterCreateButton } from "@/app/admin/characters/character-create-button";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import {
  CHARACTER_ADMIN_PERMISSIONS,
  CHARACTER_DETAIL_PERMISSIONS,
  CHARACTER_INDEX_PERMISSIONS,
  hasPermission,
} from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { formatDate } from "@/lib/format";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const adminUser = await requireAnyPagePermission(
    runtime,
    "/admin/characters",
    CHARACTER_ADMIN_PERMISSIONS,
  );
  const params = await searchParams;
  const query = searchParam(params.q);
  const sort = allowed(
    searchParam(params.sort),
    ["default", "name", "works"],
    "default",
  );
  const page = parseAdminPage(params.page);
  const result = await searchCharactersForAdmin(runtime, {
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
    locale: runtime.uiLocale,
    result,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.characterList.title"), translate(locale, "admin.characterIndex.console")], page: loaderData?.page }, error, locale);
};

export default function AdminCharactersPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const { adminUser, query, sort, page, result } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title={t("admin.characterList.title")}
        subtitle={t("admin.characterList.subtitle")}
        actions={
          <>
            {hasPermission(adminUser, "character.admin.read") ||
            CHARACTER_INDEX_PERMISSIONS.some((key) =>
              hasPermission(adminUser, key),
            ) ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to="/admin/characters/index"
              >
                {t("admin.characterIndex.title")}
              </Link>
            ) : null}
            {hasPermission(adminUser, "character.create") ? (
              <CharacterCreateButton />
            ) : null}
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/characters"
            >
              {t("admin.characterList.public")}
            </Link>
          </>
        }
      />
      <AdminListControls
        action="/admin/characters"
        noun={t("admin.characterIndex.character")}
        query={query}
        sort={sort}
        sortOptions={[
          { value: "default", label: t("admin.characterList.recent") },
          { value: "name", label: t("admin.characterList.name") },
          { value: "works", label: t("admin.characterList.workCount") },
        ]}
        pageSize={PAGE_SIZE}
        total={result.total}
      />
      {result.items.length > 0 ? (
        <TableWrap compact label={t("admin.characterList.table")} minWidth={900}>
          <thead>
            <tr>
              <th>{t("admin.characterIndex.character")}</th>
              <th>{t("character.works")}</th>
              <th>{t("admin.characterList.updated")}</th>
              <th className="admin-action-column">{t("admin.characterList.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((character) => (
              <tr key={character.id}>
                <td>
                  <strong className="admin-cell-title">{character.primaryName}</strong>
                  {character.originalName ? (
                    <span className="admin-cell-meta">
                      {character.originalName}
                    </span>
                  ) : null}
                </td>
                <td>{character.workCount.toLocaleString(locale)}</td>
                <td className="whitespace-nowrap text-xs text-muted tabular-nums">{formatDate(character.updatedAt, { locale })}</td>
                <td className="admin-action-column">
                  {CHARACTER_DETAIL_PERMISSIONS.some((key) =>
                    hasPermission(adminUser, key),
                  ) ? (
                    <Link
                      className={buttonVariants({ variant: "ghost", size: "sm" })}
                      to={`/admin/characters/${character.id}`}
                    >
                      {t("admin.characterList.manage")}
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
        <EmptyState title={t("admin.characterList.empty")} />
      )}
      <PaginationLinks
        basePath="/admin/characters"
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
