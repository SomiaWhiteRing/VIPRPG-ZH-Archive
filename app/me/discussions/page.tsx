import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import {
  parseAccountPage,
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { getForumRuntime } from "@/app/.server/forum/context";
import { ownUserDiscussions } from "@/app/.server/forum/user-discussions";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { DiscussionList } from "@/app/components/profile/discussion-list";
import { AccountPageHeader } from "@/app/me/account-page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(
    runtime,
    `/me/discussions${page > 1 ? `?page=${page}` : ""}`,
  );
  const result = await ownUserDiscussions(getForumRuntime(runtime), user, {
    page,
    locale: runtime.uiLocale,
  });

  return { locale: runtime.uiLocale, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "account.nav.discussions"), page: loaderData?.result.page }, error, locale);
};

export default function DiscussionsPage() {
  const t = useMessages();
  const { result } = useLoaderData<typeof loader>();
  return (
    <div>
      <AccountPageHeader
        title={t("account.nav.discussions")}
      />
      <DiscussionList items={result.items} />
      <PaginationLinks
        basePath="/me/discussions"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
