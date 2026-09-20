import { loadGameLibrary } from "@/app/.server/game-library-page";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameLibrary } from "@/app/components/library/game-library";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);
  const user = await requirePublicProfileSection(runtime, params.userId, "favorites");
  const data = await loadGameLibrary(runtime, searchParams, { userId: user.id, kind: "favorite" });
  return { ...data, displayName: user.displayName, base: `/users/${user.id}/favorites` };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    { title: [loaderData?.displayName || "用户", "收藏"], page: loaderData?.page },
    error,
  );

export default function PublicFavorites() {
  const data = useLoaderData<typeof loader>();
  return (
    <GameLibrary
      data={data}
      basePath={data.base}
      emptyTitle={data.hasFilters ? "没有找到匹配的收藏作品。" : "还没有公开收藏。"}
    />
  );
}
