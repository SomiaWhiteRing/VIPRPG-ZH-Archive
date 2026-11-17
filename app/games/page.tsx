import { loadGameLibrary } from "@/app/.server/game-library-page";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameLibrary } from "@/app/components/library/game-library";
import { PageContainer } from "@/app/components/ui/page-container";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { gameListCanonicalPath, isFilteredGameList } from "@/lib/crawl-policy";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";

export async function loader(args: LoaderFunctionArgs) {
  const url = new URL(args.request.url);
  if (url.searchParams.get("tag")?.trim() || url.searchParams.has("tag_source")) {
    throw redirect(`/tags${url.search}`);
  }
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);
  return { ...await loadGameLibrary(runtime, searchParams), locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const params = new URLSearchParams(location.search);
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return [
    ...pageMetaDescriptors({ title: translate(locale, "core.nav.games"), page: loaderData?.page,
      alternates: { canonical: isFilteredGameList(params) ? "/games" : gameListCanonicalPath(params) } }, error, locale),
    ...(isFilteredGameList(params) ? [{ name: "robots", content: "noindex, follow" }] : []),
  ];
};

export default function GamesPage() {
  const data = useLoaderData<typeof loader>();
  const t = useMessages();
  return (
    <PageContainer>
      <GameLibrary data={data} basePath="/games" title={t("archive.games.all")} />
    </PageContainer>
  );
}
