import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { loadGameLibrary } from "@/app/.server/game-library-page";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameLibrary } from "@/app/components/library/game-library";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);
  const user = await requirePublicProfileSection(
    runtime,
    (await params).userId,
    "history",
  );
  const data = await loadGameLibrary(runtime, searchParams, { userId: user.id, kind: "played" });
  const base = `/users/${user.id}/history`;
  return { locale: runtime.uiLocale, ...data, displayName: user.displayName, base };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, "account.nav.history");
  const name = loaderData?.displayName;
  return pageMetaDescriptors({ title: name ? [name, title] : title, page: loaderData?.page }, error, locale);
};

export default function PublicHistory() {
  const t = useMessages();
  const data = useLoaderData<typeof loader>();
  return (
    <section aria-label={t("publicProfile.history")}>
      <GameLibrary data={data} basePath={data.base} emptyTitle={t("publicProfile.noHistory")} />
    </section>
  );
}
