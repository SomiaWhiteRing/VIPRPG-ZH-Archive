import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import {
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { loadGameLibrary } from "@/app/.server/game-library-page";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameLibrary } from "@/app/components/library/game-library";
import { AccountPageHeader } from "@/app/me/account-page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const url = new URL(args.request.url);
  const user = await requireAccountUser(
    runtime,
    `/me/history${url.search}`,
  );
  const data = await loadGameLibrary(runtime, searchParams, { userId: user.id, kind: "played", publicOnly: false });
  return { ...data, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "account.nav.history"), page: loaderData?.page }, error, locale);
};

export default function HistoryPage() {
  const t = useMessages();
  const data = useLoaderData<typeof loader>();
  return (
    <div>
      <AccountPageHeader
        title={t("account.nav.history")}
        subtitle={t("favorites.total", { count: data.total })}
      />
      <GameLibrary data={data} basePath="/me/history" emptyTitle={t("account.activity.noHistory")} />
    </div>
  );
}
