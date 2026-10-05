import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { requirePublicUser } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { listUserFollows, readFollowSummary } from "@/app/.server/db/user-follows";
import { listTimeline } from "@/app/.server/db/timeline";
import { UserFollowControls } from "@/app/components/timeline/user-follow-controls";
import { AccountSection } from "@/app/components/profile/account-content";
import { FriendList } from "@/app/components/profile/friend-list";
import { TimelineWorkspace } from "@/app/components/timeline/timeline-workspace";
import { hasProfileOverviewSections } from "@/lib/user-profile";
import { DetailPageLayout } from "@/app/components/ui/detail-page-layout";
import { PageContainer } from "@/app/components/ui/page-container";
import type { LoaderFunctionArgs, MetaFunction, ShouldRevalidateFunction } from "react-router";
import { data, matchPath, Outlet, useLoaderData } from "react-router";
import { PublicProfileNavigation } from "./public-profile-navigation";

const overviewPath = { path: "/users/:userId", end: true };

// The parent route stays matched when changing profile sections.
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, defaultShouldRevalidate }) =>
  Boolean(matchPath(overviewPath, currentUrl.pathname)) !== Boolean(matchPath(overviewPath, nextUrl.pathname)) || defaultShouldRevalidate;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const user = await requirePublicUser(runtime, (await params).userId);

  const viewer = await getCurrentUser(runtime);
  const isOverview = Boolean(matchPath(overviewPath, args.url.pathname));
  const [followSummary, friends, timeline] = await Promise.all([
    readFollowSummary(runtime, user.id, viewer),
    isOverview && user.profileVisibility.friends ? listUserFollows(runtime, user.id, "following", null, 15) : null,
    isOverview ? listTimeline(runtime, { actorUserId: user.id, viewerId: viewer?.id, limit: hasProfileOverviewSections(user.profileVisibility) ? 5 : 10 }) : null,
  ]);
  return data({ user, viewerId: viewer?.id ?? null, followSummary, friends, timelineItems: timeline?.items ?? null, isOverview }, { headers: { "Cache-Control": "private, no-store" } });
}
export function headers() { return { "Cache-Control": "private, no-store" }; }

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: [loaderData?.user.displayName || "用户", "个人主页"] }, error);

export default function PublicUserLayout() {
  const { user, viewerId, followSummary, friends, timelineItems, isOverview } = useLoaderData<typeof loader>();
  const hasSidebar = isOverview && hasProfileOverviewSections(user.profileVisibility);
  const timelineSection = timelineItems !== null ? <AccountSection href={`/users/${user.id}/timeline`} title="时间线" divided={false}>
    <TimelineWorkspace page={{ items: timelineItems, nextCursor: null }} viewerId={viewerId} settings={null} basePath={`/users/${user.id}/timeline`} profile showAuthor={false} expandReplies={false} />
  </AccountSection> : null;
  const children = isOverview && !hasSidebar ? timelineSection : <Outlet />;
  const friendSection = friends ? <AccountSection href={`/users/${user.id}/connections?view=following`} title="好友" divided={!hasSidebar}>
    {friends.items.length > 0 ? <FriendList users={friends.items} /> : null}
  </AccountSection> : null;
  return (
    <PageContainer className={hasSidebar ? undefined : "w-full max-w-5xl px-4 sm:px-6"}>
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <header className="flex items-start gap-4">
          <UserAvatar
            avatarBlobSha256={user.avatarBlobSha256}
            className="size-20"
            displayName={user.displayName}
            size={80}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="m-0 min-w-0 truncate text-2xl font-extrabold" title={user.displayName}>
                {user.displayName}
              </h1>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted">
                UID：{user.id}
              </span>
              {viewerId !== null && viewerId !== user.id && followSummary?.isFollowing ? <span className="shrink-0 whitespace-nowrap text-sm text-accent">/是我的好友</span> : null}
            </div>
            {user.profileVisibility.bio ? (
              <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm text-muted">
                {user.bio || "这位用户还没有填写简介。"}
              </p>
            ) : null}
            <UserFollowControls key={`${user.id}:${viewerId}`} userId={user.id} displayName={user.displayName} viewerId={viewerId} summary={followSummary} />
          </div>
        </header>
        <PublicProfileNavigation userId={user.id} visibility={user.profileVisibility} />
        {hasSidebar ? <DetailPageLayout
          compactSidebar
          stretchSidebar
          sidebarLabel="个人时间线与好友概览"
          main={children}
          sidebar={<div className="hidden min-w-0 gap-7 min-[981px]:grid min-[981px]:h-full min-[981px]:content-start">
            {timelineSection}
            {friendSection}
          </div>}
        /> : <div className="grid min-w-0 grid-cols-1 gap-7">{children}{friendSection && <div className="hidden min-[981px]:block">{friendSection}</div>}</div>}
      </div>
    </PageContainer>
  );
}
