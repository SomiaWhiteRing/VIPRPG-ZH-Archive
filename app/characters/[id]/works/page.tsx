import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { parseWorkCreditSort } from "@/lib/params";
import { WorkCreditSortTabs } from "@/app/components/work/work-credit-sort-tabs";
import { browsePublicCharacterWorks } from "@/app/.server/db/character-detail";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { runtimeContext } from "@/app/.server/router-context";
import { CharacterWorkList } from "@/app/characters/character-work-list";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const id = parsePositiveId(args.params.id ?? "", "character id");
  const { searchParams } = new URL(args.request.url);
  const sort = parseWorkCreditSort(searchParams.get("sort"));
  const result = await browsePublicCharacterWorks(runtime, id, {
    page: Number(searchParams.get("page") || "1"),
    pageSize: 20,
    sort,
  });
  if (!result) throwNotFound();
  return { ...result, sort, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [loaderData?.character.primaryName || translate(locale, "core.nav.characters"), translate(locale, "character.works")], page: loaderData?.page }, error, locale);
};

export default function CharacterWorksPage() {
  const t = useMessages();
  const { character, items, page, pageSize, sort, total } = useLoaderData<typeof loader>();
  const basePath = `/characters/${character.id}/works`;
  return (
    <PageContainer>
      <PageHeader
        actions={<BackLink href={`/characters/${character.id}#sec-works`} label={t("character.back")} />}
        subtitle={character.primaryName}
        title={t("character.works")}
      />
      <WorkCreditSortTabs basePath={basePath} sort={sort} />
      {items.length ? (
        <CharacterWorkList works={items} characterName={character.primaryName} standalone />
      ) : <EmptyState title={t("character.emptyWorks")} />}
      <PaginationLinks
        basePath={basePath}
        params={{ sort: sort === "release" ? sort : undefined }}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </PageContainer>
  );
}
