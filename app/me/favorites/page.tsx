import { requireAccountUser } from "@/app/.server/auth/account-user";
import { listUnavailableFavorites } from "@/app/.server/db/user-work-tags";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";
import { loadGameLibrary } from "@/app/.server/game-library-page";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { FavoriteLibrary } from "@/app/me/favorite-library";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
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
    ...await loadGameLibrary(runtime, searchParams, { userId: user.id, kind: "favorite", publicOnly: false }), currentUserId: user.id,
    locale: runtime.uiLocale,
    unavailable,
    unavailablePrevious: unavailable.page > 1 ? unavailablePageUrl(unavailable.page - 1) : null,
    unavailableNext: unavailable.page * unavailable.pageSize < unavailable.total ? unavailablePageUrl(unavailable.page + 1) : null,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "favorites.mine"), page: loaderData?.page }, error, locale);
};

export default function FavoritesPage() {
  const t = useMessages();
  const { data, refresh } = useRouteRefresh(useLoaderData<typeof loader>());
  return (
    <div>
      <AccountPageHeader title={t("timeline.feed.kind.favorite")} subtitle={data.unavailable.total > 0
        ? t("favorites.accessible", { count: data.total, unavailable: data.unavailable.total })
        : t("favorites.total", { count: data.total })} />
      <FavoriteLibrary data={data} currentUserId={data.currentUserId} unavailableCount={data.unavailable.total} onSaved={refresh} />
      {data.unavailable.total > 0 ? (
        <section className="mt-6" aria-labelledby="unavailable-favorites-title">
          <h2 id="unavailable-favorites-title" className="text-lg font-semibold">{t("favorites.unavailable", { count: data.unavailable.total })}</h2>
          <p className="text-sm text-muted">{t("favorites.help")}</p>
          <ul className="grid gap-2">
            {data.unavailable.items.map(({ workId }) => {
              const title = t("favorites.work", { id: workId });
              return (
                <li key={workId} className="flex items-center justify-between gap-3">
                  <span>{title}</span>
                  <WorkFavoriteButton onSaved={refresh} appearance="remove" currentUserId={data.currentUserId} initialFavorited workId={workId} workTitle={title} />
                </li>
              );
            })}
          </ul>
          <nav aria-label={t("favorites.pages")} className="mt-3 flex gap-4">
            {data.unavailablePrevious ? <Link to={data.unavailablePrevious}>{t("pagination.previous")}</Link> : null}
            {data.unavailableNext ? <Link to={data.unavailableNext}>{t("pagination.next")}</Link> : null}
          </nav>
        </section>
      ) : null}
    </div>
  );
}
