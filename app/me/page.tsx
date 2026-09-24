import { requireAccountUser } from "@/app/.server/auth/account-user";
import { searchCatalogsForOwner } from "@/app/.server/db/catalogs";
import {
  searchUploadedWorks,
  searchUserWorks,
} from "@/app/.server/db/game-library";
import { searchUserComments } from "@/app/.server/db/work-community";
import { getForumRuntime } from "@/app/.server/forum/context";
import { ownUserDiscussions } from "@/app/.server/forum/user-discussions";
import { pickPageFields } from "@/app/.server/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import {
  AccountEmpty,
  AccountSection,
  AccountWorkGrid,
} from "@/app/components/profile/account-content";
import { DiscussionList } from "@/app/components/profile/discussion-list";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import {
  canAccessOwnWorks,
  canPublishWork,
  hasPermission,
} from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { RecentCommentList } from "@/app/components/profile/recent-comment-list";
import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const user = await requireAccountUser(runtime, "/me");
  const showUploads = canAccessOwnWorks(user);
  const [played, favorites, catalogs, comments, uploads, discussions] =
    await Promise.all([
      searchUserWorks(runtime, {
        userId: user.id,
        kind: "played",
        pageSize: 4,
      }),
      searchUserWorks(runtime, {
        userId: user.id,
        kind: "favorite",
        pageSize: 4,
      }),
      searchCatalogsForOwner(runtime, { userId: user.id, pageSize: 3 }),
      searchUserComments(runtime, { userId: user.id, pageSize: 3 }),
      showUploads
        ? searchUploadedWorks(runtime, { userId: user.id, pageSize: 3 })
        : Promise.resolve(null),
      ownUserDiscussions(getForumRuntime(runtime), user, { pageSize: 3 }),
    ]);

  return {
    user: pickPageFields(user, [
      "profileVisibility",
      "avatarBlobSha256",
      "displayName",
      "bio",
      "id",
      "status",
      "permissionKeys",
    ]),
    played,
    favorites,
    catalogs,
    comments,
    uploads,
    discussions,
  };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "个人中心" }, error);

export default function MePage() {
  const {
    user,
    played,
    favorites,
    catalogs,
    comments,
    uploads,
    discussions,
  } = useLoaderData<typeof loader>();
  return (
    <div className="grid gap-7">
      <PageHeader
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to={`/users/${user.id}`}>查看访客页</Link>
          </Button>
        }
        compact
        title="个人中心"
      />
      <AccountSection
        href="/me/profile"
        status={
          !user.profileVisibility.bio ? (
            <Badge variant="outline">简介未在个人主页展示</Badge>
          ) : undefined
        }
        title="资料摘要"
      >
        <div className="flex items-center gap-4">
          <UserAvatar
            avatarBlobSha256={user.avatarBlobSha256}
            className="size-16"
            displayName={user.displayName}
            size={64}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <strong className="min-w-0 truncate text-lg">
                {user.displayName}
              </strong>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted">
                UID：{user.id}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted">
              {user.bio || "还没有填写简介。"}
            </p>
          </div>
        </div>
      </AccountSection>
      <AccountSection
        href="/me/history"
        status={
          !user.profileVisibility.history ? (
            <Badge variant="outline">未在个人主页展示</Badge>
          ) : undefined
        }
        title="最近游玩"
      >
        {played.items.length ? (
          <AccountWorkGrid items={played.items} showPlayedAt />
        ) : (
          <AccountEmpty>
            暂无游玩记录
          </AccountEmpty>
        )}
      </AccountSection>
      <AccountSection
        href="/me/favorites"
        status={
          !user.profileVisibility.favorites ? (
            <Badge variant="outline">未在个人主页展示</Badge>
          ) : undefined
        }
        title="最近收藏"
      >
        {favorites.items.length ? (
          <AccountWorkGrid items={favorites.items} />
        ) : (
          <AccountEmpty>
            暂无收藏
          </AccountEmpty>
        )}
      </AccountSection>
      <AccountSection
        href="/me/catalogs"
        status={
          !user.profileVisibility.catalogs ? (
            <Badge variant="outline">未在个人主页展示</Badge>
          ) : undefined
        }
        title="我的目录"
      >
        {catalogs.items.length ? (
          <CatalogSummaryList items={catalogs.items} preview />
        ) : (
          <AccountEmpty>暂无目录</AccountEmpty>
        )}
      </AccountSection>
      <AccountSection
        href="/me/comments"
        status={
          !user.profileVisibility.comments ? (
            <Badge variant="outline">未在个人主页展示</Badge>
          ) : undefined
        }
        title="我的评论"
      >
        {comments.items.length ? (
          <RecentCommentList items={comments.items} />
        ) : (
          <AccountEmpty>浏览作品或作者资料并留下第一条评论。</AccountEmpty>
        )}
      </AccountSection>
      <AccountSection
        href="/me/discussions"
        status={
          !user.profileVisibility.discussions ? (
            <Badge variant="outline">未在个人主页展示</Badge>
          ) : undefined
        }
        title="最近讨论"
      >
        <DiscussionList items={discussions.items} compact />
      </AccountSection>
      {uploads ? (
        <AccountSection href="/me/uploads" title="最近上传">
          {uploads.items.length ? (
            <ul className="divide-y divide-border border-y border-border">
              {uploads.items.map((work, index) => (
                <li
                  className={`flex items-center justify-between gap-3 py-3 ${index >= 2 ? "hidden sm:flex" : ""}`}
                  key={work.id}
                >
                  <div className="min-w-0">
                    <Link
                      className="block truncate font-semibold"
                      to={
                        hasPermission(user, "work.update_own")
                          ? `/me/uploads/${work.id}`
                          : `/games/${work.id}`
                      }
                    >
                      {work.chineseTitle || work.originalTitle}
                    </Link>
                    <span className="text-sm text-muted">
                      {work.distribution === "archive"
                        ? "本站归档"
                        : "外部下载"}
                    </span>
                  </div>
                  <StatusBadge kind="publication" value={work.status} />
                </li>
              ))}
            </ul>
          ) : (
            <AccountEmpty>
              {canPublishWork(user) ? (
                <>
                  暂无上传 · <Link to="/upload">发布作品</Link>
                </>
              ) : (
                "还没有负责维护的作品。"
              )}
            </AccountEmpty>
          )}
        </AccountSection>
      ) : null}
    </div>
  );
}
