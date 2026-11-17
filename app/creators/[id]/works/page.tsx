import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { browsePublicCreatorWorks } from "@/app/.server/db/creator-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { CreatorWorkList } from "@/app/creators/creator-work-list";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const id = parsePositiveId(args.params.id ?? "", "creator id");
  const result = await browsePublicCreatorWorks(runtime, id, {
    page: Number(new URL(args.request.url).searchParams.get("page") || "1"),
    pageSize: 20,
  });
  if (!result) throwNotFound();
  return { ...result, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [loaderData?.creator.name || translate(locale, "work.credit.author"), translate(locale, "creator.credits")], page: loaderData?.page }, error, locale);
};

export default function CreatorWorksPage() {
  const t = useMessages();
  const { creator, items, page, pageSize, total } = useLoaderData<typeof loader>();
  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-5 sm:py-8">
      <PageHeader
        actions={<BackLink href={`/creators/${creator.id}#sec-works`} label={t("creator.back")} />}
        subtitle={creator.name}
        title={t("creator.credits")}
      />
      {items.length ? (
        <CreatorWorkList works={items} creatorName={creator.name} standalone />
      ) : <EmptyState title={t("creator.emptyCredits")} />}
      <PaginationLinks
        basePath={`/creators/${creator.id}/works`}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </main>
  );
}
