import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { parseAccountPage } from "@/app/.server/auth/account-user";
import { getForumRuntime } from "@/app/.server/forum/context";
import { publicUserDiscussions } from "@/app/.server/forum/user-discussions";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { DiscussionList } from "@/app/components/profile/discussion-list";
import { useIsPostAuthorHidden } from "@/app/components/use-is-post-author-hidden";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);

  const user = await requirePublicProfileSection(
    runtime,
    (await params).userId,
    "discussions",
  );
  const page = parseAccountPage((await searchParams).page);
  const result = await publicUserDiscussions(
    getForumRuntime(runtime),
    user.id,
    { page, locale: runtime.uiLocale },
  );

  return { locale: runtime.uiLocale, user, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, "publicProfile.discussionTab");
  const name = loaderData?.user.displayName;
  return pageMetaDescriptors({ title: name ? [name, title] : title, page: loaderData?.result.page }, error, locale);
};

export default function PublicDiscussions() {
  const t = useMessages();
  const { user, result } = useLoaderData<typeof loader>();
  const hidePosts = useIsPostAuthorHidden()(user.id);
  return (
    <section aria-label={t("publicProfile.discussionTab")}>
      {!hidePosts && <DiscussionList items={result.items} />}
      <PaginationLinks
        basePath={`/users/${user.id}/discussions`}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </section>
  );
}
