import { searchCatalogsForOwner } from "@/app/.server/db/catalogs";
import { searchUserWorks } from "@/app/.server/db/game-library";
import { searchUserComments } from "@/app/.server/db/work-community";
import { readShowcase } from "@/app/.server/db/showcase";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { Showcase } from "@/app/components/profile/showcase";
import { getForumRuntime } from "@/app/.server/forum/context";
import { publicUserDiscussions } from "@/app/.server/forum/user-discussions";
import { requirePublicUser } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  AccountEmpty,
  AccountSection,
  AccountWorkGrid,
} from "@/app/components/profile/account-content";
import { DiscussionList } from "@/app/components/profile/discussion-list";
import { RecentCommentList } from "@/app/components/profile/recent-comment-list";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const user = await requirePublicUser(runtime, (await params).userId);
  const base = `/users/${user.id}`;
  const visibility = user.profileVisibility;
  const showcaseEntries = visibility.showcase
    ? (await readShowcase(runtime, user.id)).entries.filter(
        (entry) => entry.target !== null,
      )
    : [];
  const viewer = await getCurrentUser(runtime);
  const [played, favorites, catalogs, comments, discussions] =
    await Promise.all([
      visibility.history
        ? searchUserWorks(runtime, {
            userId: user.id,
            kind: "played",
            pageSize: 4,
          })
        : null,
      visibility.favorites
        ? searchUserWorks(runtime, {
            userId: user.id,
            kind: "favorite",
            pageSize: 4,
          })
        : null,
      visibility.catalogs
        ? searchCatalogsForOwner(runtime, { userId: user.id, pageSize: 3 })
        : null,
      visibility.comments
        ? searchUserComments(runtime, {
            userId: user.id,
            publicOnly: true,
            pageSize: 3,
          })
        : null,
      visibility.discussions
        ? publicUserDiscussions(getForumRuntime(runtime), user.id, {
            pageSize: 3,
          })
        : null,
    ]);
  const hasVisibleSections =
    showcaseEntries.length > 0 ||
    visibility.history ||
    visibility.favorites ||
    visibility.catalogs ||
    visibility.comments ||
    visibility.discussions;

  return {
    displayName: user.displayName,
    showcaseEntries,
    canEditShowcase: viewer?.id === user.id,
    base,
    played,
    favorites,
    catalogs,
    comments,
    discussions,
    hasVisibleSections,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    { title: [loaderData?.displayName || "用户", "个人主页"] },
    error,
  );

export default function PublicUserPage() {
  const {
    base,
    showcaseEntries,
    canEditShowcase,
    played,
    favorites,
    catalogs,
    comments,
    discussions,
    hasVisibleSections,
  } = useLoaderData<typeof loader>();
  return (
    <div className="grid gap-7">
      <Showcase
        key={base}
        entries={showcaseEntries}
        editable={canEditShowcase}
      />
      {played ? (
        <AccountSection href={`${base}/history`} title="最近游玩">
          {played.items.length ? (
            <AccountWorkGrid items={played.items} showPlayedAt />
          ) : (
            <AccountEmpty>还没有公开游玩记录。</AccountEmpty>
          )}
        </AccountSection>
      ) : null}
      {favorites ? (
        <AccountSection href={`${base}/favorites`} title="最近收藏">
          {favorites.items.length ? (
            <AccountWorkGrid items={favorites.items} />
          ) : (
            <AccountEmpty>还没有公开收藏。</AccountEmpty>
          )}
        </AccountSection>
      ) : null}
      {catalogs ? (
        <AccountSection href={`${base}/catalogs`} title="公开目录">
          {catalogs.items.length ? (
            <CatalogSummaryList items={catalogs.items} preview />
          ) : (
            <AccountEmpty>还没有公开目录。</AccountEmpty>
          )}
        </AccountSection>
      ) : null}
      {comments ? (
        <AccountSection href={`${base}/comments`} title="最近评论">
          {comments.items.length ? (
            <RecentCommentList items={comments.items} />
          ) : (
            <AccountEmpty>还没有公开评论。</AccountEmpty>
          )}
        </AccountSection>
      ) : null}
      {discussions ? (
        <AccountSection href={`${base}/discussions`} title="最近讨论">
          <DiscussionList items={discussions.items} compact />
        </AccountSection>
      ) : null}
      {!hasVisibleSections ? (
        <AccountEmpty>这位用户没有公开其他内容。</AccountEmpty>
      ) : null}
    </div>
  );
}
