import { translate } from "@/lib/i18n/core";
import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { listUserFollows } from "@/app/.server/db/user-follows";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { runtimeContext } from "@/app/.server/router-context";
import { FriendConnections } from "@/app/components/profile/friend-connections";
import type { FollowDirection } from "@/lib/dto/db/user-follows";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext), user = await requirePublicProfileSection(runtime, params.userId!, "friends");
  const query = new URL(request.url).searchParams, view = query.get("view") ?? "following";
  if (view !== "following" && view !== "followers") {
    throw data({ messageKey: "timeline.error.followType" }, { status: 400 });
  }
  const viewer = await getCurrentUser(runtime);
  return data({ locale: runtime.uiLocale, userId: user.id, displayName: user.displayName, isSelf: viewer?.id === user.id, view: view as FollowDirection, hasCursor: !!query.get("cursor"),
    page: await listUserFollows(runtime, user.id, view, query.get("cursor")) }, { headers: { "Cache-Control": "private, no-store" } });
}
export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, loaderData?.view === "followers" ? "friends.followers" : "friends.title");
  return pageMetaDescriptors({ title: loaderData?.displayName ? [loaderData.displayName, title] : title }, error, locale);
};

export default function UserConnectionsPage() {
  const { userId, displayName, isSelf, view, page, hasCursor } = useLoaderData<typeof loader>();
  return <FriendConnections basePath={`/users/${userId}/connections`} displayName={displayName} isSelf={isSelf} view={view} page={page} hasCursor={hasCursor} />;
}

export { TimelineError as ErrorBoundary } from "@/app/components/timeline/timeline-error";
