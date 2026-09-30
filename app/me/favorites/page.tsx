import { requireAccountUser } from "@/app/.server/auth/account-user";
import { listUnavailableFavorites } from "@/app/.server/db/user-work-tags";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";
import { loadGameLibrary } from "@/app/.server/game-library-page";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { FavoriteLibrary } from "@/app/me/favorite-library";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useRouteRefresh } from "@/app/components/use-route-refresh";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);
  const url = new URL(args.request.url);
  const user = await requireAccountUser(runtime, `/me/favorites${url.search}`);
  const unavailable = await listUnavailableFavorites(runtime, user.id, Number(url.searchParams.get("unavailablePage") ?? 1));
  const unavailablePageUrl = (page: number) => {
    const params = new URLSearchParams(url.search);
    params.set("unavailablePage", String(page));
    return `/me/favorites?${params}`;
  };
  return {
    ...await loadGameLibrary(runtime, searchParams, { userId: user.id, kind: "favorite" }), currentUserId: user.id,
    unavailable,
    unavailablePrevious: unavailable.page > 1 ? unavailablePageUrl(unavailable.page - 1) : null,
    unavailableNext: unavailable.page * unavailable.pageSize < unavailable.total ? unavailablePageUrl(unavailable.page + 1) : null,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "我的收藏", page: loaderData?.page }, error);

export default function FavoritesPage() {
  const { data, refresh } = useRouteRefresh(useLoaderData<typeof loader>());
  return (
    <div>
      <AccountPageHeader title="收藏" subtitle={data.unavailable.total > 0 ? `${data.total} 部可访问作品，${data.unavailable.total} 部暂不可访问` : `共 ${data.total} 部作品`} />
      <FavoriteLibrary data={data} currentUserId={data.currentUserId} unavailableCount={data.unavailable.total} onSaved={refresh} />
      {data.unavailable.total > 0 ? (
        <section className="mt-6" aria-labelledby="unavailable-favorites-title">
          <h2 id="unavailable-favorites-title" className="text-lg font-semibold">暂不可访问的收藏（{data.unavailable.total}）</h2>
          <p className="text-sm text-muted">这些作品暂不可访问。你可以保留收藏，或取消收藏并移除相应标签和吐槽。</p>
          <ul className="grid gap-2">
            {data.unavailable.items.map(({ workId }) => (
              <li key={workId} className="flex items-center justify-between gap-3">
                <span>暂不可访问的作品 #{workId}</span>
                <WorkFavoriteButton onSaved={refresh} appearance="remove" currentUserId={data.currentUserId} initialFavorited workId={workId} workTitle={`暂不可访问的作品 #${workId}`} />
              </li>
            ))}
          </ul>
          <nav aria-label="暂不可访问的收藏分页" className="mt-3 flex gap-4">
            {data.unavailablePrevious ? <Link to={data.unavailablePrevious}>上一页</Link> : null}
            {data.unavailableNext ? <Link to={data.unavailableNext}>下一页</Link> : null}
          </nav>
        </section>
      ) : null}
    </div>
  );
}
