import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { listUserFollows } from "@/app/.server/db/user-follows";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { runtimeContext } from "@/app/.server/router-context";
import { FriendConnections } from "@/app/components/profile/friend-connections";
import type { FollowDirection } from "@/lib/dto/db/user-follows";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext), user = await requirePublicProfileSection(runtime, params.userId!, "friends");
  const query = new URL(request.url).searchParams, view = query.get("view") ?? "following";
  if (view !== "following" && view !== "followers") throw new Response("好友列表类型无效", { status: 400 });
  const viewer = await getCurrentUser(runtime);
  return data({ userId: user.id, displayName: user.displayName, isSelf: viewer?.id === user.id, view: view as FollowDirection, hasCursor: !!query.get("cursor"),
    page: await listUserFollows(runtime, user.id, view, query.get("cursor")) }, { headers: { "Cache-Control": "private, no-store" } });
}
export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) => pageMetaDescriptors({ title: [loaderData?.displayName || "用户", loaderData?.view === "followers" ? "谁把 TA 加为好友" : "好友"] }, error);

export default function UserConnectionsPage() {
  const { userId, displayName, isSelf, view, page, hasCursor } = useLoaderData<typeof loader>();
  return <FriendConnections basePath={`/users/${userId}/connections`} displayName={displayName} isSelf={isSelf} view={view} page={page} hasCursor={hasCursor} />;
}

export { TimelineError as ErrorBoundary } from "@/app/components/timeline/timeline-error";
