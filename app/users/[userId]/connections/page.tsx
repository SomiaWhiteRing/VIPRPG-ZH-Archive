import { data, Link, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { listUserFollows } from "@/app/.server/db/user-follows";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { runtimeContext } from "@/app/.server/router-context";
import { Button } from "@/app/components/ui/button";
import { FriendList } from "@/app/components/profile/friend-list";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext), user = await requirePublicProfileSection(runtime, params.userId!, "friends");
  const query = new URL(request.url).searchParams, view = query.get("view") ?? "following";
  if (view !== "following" && view !== "followers") throw new Response("好友列表类型无效", { status: 400 });
  const viewer = await getCurrentUser(runtime);
  return data({ userId: user.id, displayName: user.displayName, isSelf: viewer?.id === user.id, view, hasCursor: !!query.get("cursor"),
    page: await listUserFollows(runtime, user.id, view, query.get("cursor")) }, { headers: { "Cache-Control": "private, no-store" } });
}
export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) => pageMetaDescriptors({ title: [loaderData?.displayName || "用户", loaderData?.view === "followers" ? "谁把 TA 加为好友" : "好友"] }, error);

export default function UserConnectionsPage() {
  const { userId, displayName, isSelf, view, page, hasCursor } = useLoaderData<typeof loader>();
  const base = `/users/${userId}/connections`;
  return <section aria-label="好友关系" className="grid gap-5">
    <nav aria-label="好友列表范围" className="flex flex-wrap gap-2">
      {(["following", "followers"] as const).map((value) => <Button asChild size="sm" variant={view === value ? "default" : "ghost"} key={value}><Link to={`${base}?view=${value}`} aria-current={view === value ? "page" : undefined}>{value === "following" ? (isSelf ? "我的好友" : `${displayName}的好友`) : (isSelf ? "谁加我为好友" : `谁加${displayName}为好友`)}</Link></Button>)}
    </nav>
    <FriendList users={page.items} />
    {(hasCursor || page.nextCursor) && <nav aria-label="好友列表分页" className="flex flex-wrap justify-between gap-3">
      {hasCursor ? <Button asChild variant="outline"><Link to={`${base}?view=${view}`}>返回最新</Link></Button> : <span />}
      {page.nextCursor && <Button asChild variant="outline"><Link to={`${base}?view=${view}&cursor=${encodeURIComponent(page.nextCursor)}`} prefetch="none">更多用户</Link></Button>}
    </nav>}
  </section>;
}

export { TimelineError as ErrorBoundary } from "@/app/components/timeline/timeline-error";
