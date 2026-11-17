import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { listOwnUserFollows } from "@/app/.server/db/user-follows";
import { runtimeContext } from "@/app/.server/router-context";
import { FriendConnections } from "@/app/components/profile/friend-connections";
import { AccountPageHeader } from "@/app/me/account-page-header";
import type { FollowDirection } from "@/lib/dto/db/user-follows";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const url = new URL(request.url);
  const user = await requireAccountUser(runtime, `/me/connections${url.search}`);
  const view = url.searchParams.get("view") ?? "following";
  if (view !== "following" && view !== "followers") throw new Response(translate(runtime.uiLocale, "timeline.error.followType"), { status: 400 });
  return data({
    locale: runtime.uiLocale,
    displayName: user.displayName,
    view: view as FollowDirection,
    hasCursor: !!url.searchParams.get("cursor"),
    page: await listOwnUserFollows(runtime, user, view, url.searchParams.get("cursor")),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export function headers() { return { "Cache-Control": "private, no-store" }; }

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "friends.title"), translate(locale, "header.me")] }, error, locale);
};

export default function AccountConnectionsPage() {
  const t = useMessages();
  const { displayName, view, page, hasCursor } = useLoaderData<typeof loader>();
  return <div className="grid min-w-0 grid-cols-1 gap-5">
    <div><AccountPageHeader parentTitle={t("header.me")} title={t("friends.title")} /></div>
    <FriendConnections basePath="/me/connections" displayName={displayName} isSelf view={view} page={page} hasCursor={hasCursor} />
  </div>;
}
