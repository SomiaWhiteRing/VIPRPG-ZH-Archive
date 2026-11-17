import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { searchCatalogsForOwner } from "@/app/.server/db/catalogs";
import { searchUserWorks } from "@/app/.server/db/game-library";
import { searchUserComments } from "@/app/.server/db/work-community";
import { readShowcase } from "@/app/.server/db/showcase";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { Showcase } from "@/app/components/profile/showcase";
import { getForumRuntime } from "@/app/.server/forum/context";
import { previewPublicUserDiscussions } from "@/app/.server/forum/user-discussions";
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
import { useIsPostAuthorHidden } from "@/app/components/use-is-post-author-hidden";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useParams } from "react-router";

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
          }, "preview")
        : null,
      visibility.favorites
        ? searchUserWorks(runtime, {
            userId: user.id,
            kind: "favorite",
            pageSize: 4,
          }, "preview")
        : null,
      visibility.catalogs
        ? searchCatalogsForOwner(runtime, { userId: user.id, pageSize: 3 }, "preview")
        : null,
      visibility.comments
        ? searchUserComments(runtime, {
            userId: user.id,
            publicOnly: true,
            pageSize: 3,
          }, "preview")
        : null,
      visibility.discussions
        ? previewPublicUserDiscussions(getForumRuntime(runtime), user.id, 3, runtime.uiLocale)
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
    locale: runtime.uiLocale,
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

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, "publicProfile.title");
  const name = loaderData?.displayName;
  return pageMetaDescriptors({ title: name ? [name, title] : title }, error, locale);
};

export default function PublicUserPage() {
  const t = useMessages();
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
  const { userId } = useParams();
  const hidePosts = useIsPostAuthorHidden()(Number(userId));
  return (
    <div className="grid min-w-0 grid-cols-1 gap-7">
      <Showcase
        key={base}
        entries={showcaseEntries}
        editable={canEditShowcase}
      />
      {played ? (
        <AccountSection href={`${base}/history`} title={t("publicProfile.history")}>
          {played.length ? (
            <AccountWorkGrid items={played} showPlayedAt />
          ) : (
            <AccountEmpty>{t("publicProfile.noHistory")}</AccountEmpty>
          )}
        </AccountSection>
      ) : null}
      {favorites ? (
        <AccountSection href={`${base}/favorites`} title={t("publicProfile.favorites")}>
          {favorites.length ? (
            <AccountWorkGrid items={favorites} />
          ) : (
            <AccountEmpty>{t("publicProfile.noFavorites")}</AccountEmpty>
          )}
        </AccountSection>
      ) : null}
      {catalogs ? (
        <AccountSection href={`${base}/catalogs`} title={t("publicProfile.catalogs")}>
          {catalogs.length ? (
            <CatalogSummaryList items={catalogs} preview />
          ) : (
            <AccountEmpty>{t("publicProfile.noCatalogs")}</AccountEmpty>
          )}
        </AccountSection>
      ) : null}
      {comments && !hidePosts ? (
        <AccountSection href={`${base}/comments`} title={t("publicProfile.comments")}>
          {comments.length ? (
            <RecentCommentList items={comments} />
          ) : (
            <AccountEmpty>{t("publicProfile.noComments")}</AccountEmpty>
          )}
        </AccountSection>
      ) : null}
      {discussions && !hidePosts ? (
        <AccountSection href={`${base}/discussions`} title={t("publicProfile.discussions")}>
          <DiscussionList items={discussions} compact />
        </AccountSection>
      ) : null}
      {!hasVisibleSections ? (
        <AccountEmpty>{t("publicProfile.empty")}</AccountEmpty>
      ) : null}
    </div>
  );
}
