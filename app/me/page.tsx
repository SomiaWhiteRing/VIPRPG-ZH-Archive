import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { searchCatalogsForOwner } from "@/app/.server/db/catalogs";
import {
  searchUploadedWorks,
  searchUserWorks,
} from "@/app/.server/db/game-library";
import { searchUserComments } from "@/app/.server/db/work-community";
import { listOwnUserFollows } from "@/app/.server/db/user-follows";
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
import { FriendSection } from "@/app/components/profile/friend-section";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import {
  canAccessOwnWorks,
  canPublishWork,
  hasPermission,
} from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { RecentCommentList } from "@/app/components/profile/recent-comment-list";
import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const user = await requireAccountUser(runtime, "/me");
  const showUploads = canAccessOwnWorks(user);
  const [played, favorites, catalogs, comments, uploads, discussions, friends] =
    await Promise.all([
      searchUserWorks(runtime, {
        userId: user.id,
        kind: "played",
        publicOnly: false,
        pageSize: 4,
      }),
      searchUserWorks(runtime, {
        userId: user.id,
        kind: "favorite",
        publicOnly: false,
        pageSize: 4,
      }),
      searchCatalogsForOwner(runtime, { userId: user.id, pageSize: 3 }),
      searchUserComments(runtime, { userId: user.id, pageSize: 3 }),
      showUploads
        ? searchUploadedWorks(runtime, { userId: user.id, pageSize: 3 })
        : Promise.resolve(null),
      ownUserDiscussions(getForumRuntime(runtime), user, { pageSize: 3, locale: runtime.uiLocale }),
      listOwnUserFollows(runtime, user, "following", null, 15),
    ]);

  return {
    locale: runtime.uiLocale,
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
    friends,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "header.me") }, error, locale);
};

export default function MePage() {
  const t = useMessages();
  const {
    user,
    played,
    favorites,
    catalogs,
    comments,
    uploads,
    discussions,
    friends,
  } = useLoaderData<typeof loader>();
  return (
    <div className="grid min-w-0 grid-cols-1 gap-7">
      <AccountPageHeader
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to={`/users/${user.id}`}>{t("account.overview.visitor")}</Link>
          </Button>
        }
        title={t("header.me")}
      />
      <AccountSection
        href="/me/profile"
        divided={false}
        status={
          !user.profileVisibility.bio ? (
            <Badge variant="outline">{t("account.overview.bioPrivate")}</Badge>
          ) : undefined
        }
        title={t("account.overview.summary")}
        linkText={t("account.overview.edit")}
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
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap wrap-anywhere text-sm text-muted">
              {user.bio || t("account.overview.noBio")}
            </p>
          </div>
        </div>
      </AccountSection>
      <AccountSection
        href="/me/history"
        status={
          !user.profileVisibility.history ? (
            <Badge variant="outline">{t("account.overview.private")}</Badge>
          ) : undefined
        }
        title={t("publicProfile.history")}
      >
        {played.items.length ? (
          <AccountWorkGrid items={played.items} showPlayedAt />
        ) : (
          <AccountEmpty>
            {t("account.overview.noHistory")}
          </AccountEmpty>
        )}
      </AccountSection>
      <AccountSection
        href="/me/favorites"
        status={
          !user.profileVisibility.favorites ? (
            <Badge variant="outline">{t("account.overview.private")}</Badge>
          ) : undefined
        }
        title={t("publicProfile.favorites")}
      >
        {favorites.items.length ? (
          <AccountWorkGrid items={favorites.items} />
        ) : (
          <AccountEmpty>
            {t("account.overview.noFavorites")}
          </AccountEmpty>
        )}
      </AccountSection>
      <AccountSection
        href="/me/catalogs"
        status={
          !user.profileVisibility.catalogs ? (
            <Badge variant="outline">{t("account.overview.private")}</Badge>
          ) : undefined
        }
        title={t("account.nav.catalogs")}
      >
        {catalogs.items.length ? (
          <CatalogSummaryList items={catalogs.items} preview />
        ) : (
          <AccountEmpty>{t("account.activity.noCatalogs")}</AccountEmpty>
        )}
      </AccountSection>
      <AccountSection
        href="/me/comments"
        status={
          !user.profileVisibility.comments ? (
            <Badge variant="outline">{t("account.overview.private")}</Badge>
          ) : undefined
        }
        title={t("account.nav.comments")}
      >
        {comments.items.length ? (
          <RecentCommentList items={comments.items} />
        ) : (
          <AccountEmpty>{t("account.overview.firstComment")}</AccountEmpty>
        )}
      </AccountSection>
      <AccountSection
        href="/me/discussions"
        status={
          !user.profileVisibility.discussions ? (
            <Badge variant="outline">{t("account.overview.private")}</Badge>
          ) : undefined
        }
        title={t("publicProfile.discussions")}
      >
        <DiscussionList items={discussions.items} compact />
      </AccountSection>
      {uploads ? (
        <AccountSection href="/me/uploads" title={t("account.overview.uploads")}>
          {uploads.items.length ? (
            <ul className="divide-y divide-border border-t border-border">
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
                  </div>
                  <StatusBadge kind="publication" value={work.status} />
                </li>
              ))}
            </ul>
          ) : (
            <AccountEmpty>
              {canPublishWork(user) ? (
                <span className="inline-flex flex-wrap justify-center gap-x-2">
                  <span>{t("account.overview.noUploads")}</span>
                  <Link to="/upload">{t("account.overview.publish")}</Link>
                </span>
              ) : (
                t("account.overview.noMaintained")
              )}
            </AccountEmpty>
          )}
        </AccountSection>
      ) : null}
      <FriendSection
        href="/me/connections?view=following"
        users={friends.items}
        status={!user.profileVisibility.friends ? <Badge variant="outline">{t("account.overview.private")}</Badge> : undefined}
      />
    </div>
  );
}
