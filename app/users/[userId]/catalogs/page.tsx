import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { parseAccountPage } from "@/app/.server/auth/account-user";
import { searchCatalogsForOwner } from "@/app/.server/db/catalogs";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);
  const user = await requirePublicProfileSection(
    runtime,
    (await params).userId,
    "catalogs",
  );
  const page = parseAccountPage((await searchParams).page);
  const result = await searchCatalogsForOwner(runtime, {
    userId: user.id,
    page,
    pageSize: 20,
  });
  const base = `/users/${user.id}/catalogs`;
  return { locale: runtime.uiLocale, displayName: user.displayName, page, result, base };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, "publicProfile.catalogs");
  const name = loaderData?.displayName;
  return pageMetaDescriptors({ title: name ? [name, title] : title, page: loaderData?.page }, error, locale);
};

export default function PublicCatalogs() {
  const t = useMessages();
  const { page, result, base } = useLoaderData<typeof loader>();
  return (
    <section aria-label={t("timeline.feed.kind.catalog")}>
      {result.items.length ? (
        <CatalogSummaryList items={result.items} />
      ) : (
        <AccountEmpty>{t("publicProfile.noCatalogs")}</AccountEmpty>
      )}
      <PaginationLinks
        basePath={base}
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </section>
  );
}
