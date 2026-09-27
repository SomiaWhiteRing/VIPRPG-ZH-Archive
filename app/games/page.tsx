import { loadGameLibrary } from "@/app/.server/game-library-page";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameLibrary } from "@/app/components/library/game-library";
import { PageContainer } from "@/app/components/ui/page-container";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const url = new URL(args.request.url);
  if (url.searchParams.get("tag")?.trim() || url.searchParams.has("tag_source")) {
    throw redirect(`/tags${url.search}`);
  }
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);
  return loadGameLibrary(runtime, searchParams);
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "作品库", page: loaderData?.page }, error);

export default function GamesPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <PageContainer>
      <GameLibrary data={data} basePath="/games" title="全部游戏" />
    </PageContainer>
  );
}
