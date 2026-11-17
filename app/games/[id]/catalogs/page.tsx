import { parseAccountPage } from "@/app/.server/auth/account-user";
import { paginateCatalogsContainingWork } from "@/app/.server/db/catalogs";
import { getGameWorkDetail } from "@/app/.server/db/game-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { runtimeContext } from "@/app/.server/router-context";
import { CatalogListRow } from "@/app/catalogs/catalog-list-row";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const workId = parsePositiveId(args.params.id ?? "", "work id");
  const work = await getGameWorkDetail(runtime, workId);
  if (!work) throwNotFound();
  const page = parseAccountPage(new URL(args.request.url).searchParams.get("page") ?? undefined);
  const result = await paginateCatalogsContainingWork(runtime, workId, page);
  return { workId, title: work.chineseTitle || work.originalTitle, result, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, "work.sidebar.catalogs");
  return pageMetaDescriptors({
    title: loaderData?.title ? [loaderData.title, title] : title,
    page: loaderData?.result.page,
  }, error, locale);
};

export default function WorkCatalogsPage() {
  const t = useMessages();
  const { workId, result } = useLoaderData<typeof loader>();
  return (
    <PageContainer>
      <PageHeader
        actions={<BackLink href={`/games/${workId}#catalog-card`} label={t("relation.backToWork")} />}
        title={t("work.sidebar.catalogs")}
      />
      {result.items.length ? (
        <ul className="divide-y divide-border border-b border-border">
          {result.items.map((catalog) => (
            <li key={catalog.id}><CatalogListRow catalog={catalog} /></li>
          ))}
        </ul>
      ) : <EmptyState title={t("work.catalogsEmpty")} />}
      <PaginationLinks
        basePath={`/games/${workId}/catalogs`}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </PageContainer>
  );
}
