import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import {
  parseAccountPage,
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { searchCatalogsForOwner } from "@/app/.server/db/catalogs";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { CatalogCreateForm } from "@/app/catalogs/catalog-manager";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import { AccountPageHeader } from "@/app/me/account-page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(
    runtime,
    `/me/catalogs${page > 1 ? `?page=${page}` : ""}`,
  );
  const result = await searchCatalogsForOwner(runtime, {
    userId: user.id,
    page,
    pageSize: 20,
  });

  return { locale: runtime.uiLocale, page, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "account.nav.catalogs"), page: loaderData?.page }, error, locale);
};

export default function MyCatalogsPage() {
  const t = useMessages();
  const { page, result } = useLoaderData<typeof loader>();
  return (
    <div className="grid gap-6">
      <AccountPageHeader
        actions={<CatalogCreateForm />}
        title={t("account.nav.catalogs")}
        subtitle={t("account.activity.catalogs", { count: result.total })}
      />
      {result.items.length ? (
        <CatalogSummaryList items={result.items} showDescription />
      ) : (
        <AccountEmpty>{t("account.activity.noCatalogs")}</AccountEmpty>
      )}
      <PaginationLinks
        basePath="/me/catalogs"
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
