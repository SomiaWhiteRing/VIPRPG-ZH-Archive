import { loadGameLibrary } from "@/app/.server/game-library-page";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { listFavoriteWorkIds } from "@/app/.server/db/user-work-tags";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameLibrary } from "@/app/components/library/game-library";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);
  const user = await requirePublicProfileSection(runtime, params.userId, "favorites");
  const data = await loadGameLibrary(runtime, searchParams, { userId: user.id, kind: "favorite" });
  const viewer = await getCurrentUser(runtime);
  const favoriteWorkIds = viewer ? await listFavoriteWorkIds(runtime, viewer.id, data.works.map((work) => work.id)) : [];
  return { ...data, displayName: user.displayName, base: `/users/${user.id}/favorites`, currentUserId: viewer?.id ?? null, favoriteWorkIds };
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
      renderWorkActions={(work) => (
        <WorkFavoriteButton
          appearance="compact"
          currentUserId={data.currentUserId}
          initialFavorited={data.favoriteWorkIds.includes(work.id)}
          workId={work.id}
          workTitle={work.chineseTitle || work.originalTitle}
        />
      )}
    />
  );
}
