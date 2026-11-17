import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { listCatalogs } from "@/app/.server/db/catalogs";
import { runtimeContext } from "@/app/.server/router-context";
import { CatalogListRow } from "@/app/catalogs/catalog-list-row";
import { CatalogCreateForm } from "@/app/catalogs/catalog-manager";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const catalogs = await listCatalogs(runtime);
  const user = await getCurrentUser(runtime);

  return { locale: runtime.uiLocale, catalogs, isLoggedIn: !!user };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "core.nav.catalogs") }, error, locale);
};

export default function CatalogsPage() {
  const t = useMessages();
  const { catalogs, isLoggedIn } = useLoaderData<typeof loader>();
  return (
    <PageContainer>
      <PageHeader
        compact
        title={t("core.nav.catalogs")}
        actions={
          isLoggedIn ? (
            <CatalogCreateForm />
          ) : (
            <Link to="/login?next=%2Fcatalogs">{t("catalog.loginCreate")}</Link>
          )
        }
      />
      {catalogs.length ? (
        <section
          aria-label={t("catalog.list")}
          className="mt-5 divide-y divide-border border-b border-border"
        >
          {catalogs.map((catalog) => (
            <CatalogListRow catalog={catalog} key={catalog.id} />
          ))}
        </section>
      ) : (
        <div className="mt-5">
          <EmptyState title={t("catalog.emptyPublic")} />
        </div>
      )}
    </PageContainer>
  );
}
