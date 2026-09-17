import { searchCatalogsForOwner } from "@/app/.server/db/catalogs";
import { searchUserWorks } from "@/app/.server/db/game-library";
import { searchUserComments } from "@/app/.server/db/work-community";
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
import { commentTargetHref } from "@/lib/comment-target";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { formatDate } from "@/lib/format";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const user = await requirePublicUser(runtime, (await params).userId);
  const base = `/users/${user.id}`;
  const visibility = user.profileVisibility;
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
    visibility.history ||
    visibility.favorites ||
    visibility.catalogs ||
    visibility.comments ||
    visibility.discussions;

  return {
    displayName: user.displayName,
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
  pageMetaDescriptors({ title: [loaderData?.displayName || "用户", "个人主页"] }, error);

export default function PublicUserPage() {
  const {
    base,
    played,
    favorites,
    catalogs,
    comments,
    discussions,
    hasVisibleSections,
  } = useLoaderData<typeof loader>();
  return (
    <div className="grid gap-7">
      {played ? (
        <AccountSection href={`${base}/history`} title="最近游玩">
          {played.items.length ? (
            <AccountWorkGrid items={played.items} />
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
            <ul className="divide-y divide-border border-y border-border">
              {catalogs.items.map((catalog, index) => (
                <li
                  className={`py-3 ${index >= 2 ? "hidden sm:block" : ""}`}
                  key={catalog.id}
                >
                  <Link
                    className="font-semibold"
                    to={`/catalogs/${catalog.id}`}
                  >
                    {catalog.title}
                  </Link>
                  <p className="mt-1 text-sm text-muted">
                    {catalog.itemCount} 部作品 · {formatDate(catalog.updatedAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <AccountEmpty>还没有公开目录。</AccountEmpty>
          )}
        </AccountSection>
      ) : null}
      {comments ? (
        <AccountSection href={`${base}/comments`} title="最近评论">
          {comments.items.length ? (
            <ul className="divide-y divide-border border-y border-border">
              {comments.items.map((comment, index) => (
                <li
                  className={`py-3 ${index >= 2 ? "hidden sm:block" : ""}`}
                  key={comment.id}
                >
                  <Link
                    className="font-semibold"
                    to={`${commentTargetHref(comment.target)}#comment-${comment.id}`}
                  >
                    {comment.targetTitle}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">
                    {comment.body}
                  </p>
                </li>
              ))}
            </ul>
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
