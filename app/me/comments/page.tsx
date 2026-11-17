import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { parseCommentTargetKind } from "@/lib/comment-target";
import { CommentCategoryFilter } from "@/app/components/profile/comment-category-filter";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import {
  parseAccountPage,
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { searchUserComments } from "@/app/.server/db/work-community";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { CommentSummaryList } from "@/app/components/profile/comment-summary-list";
import { AccountPageHeader } from "@/app/me/account-page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const filters = await searchParams;
  const page = parseAccountPage(filters.page);
  const kind = parseCommentTargetKind(filters.kind);
  const query = new URLSearchParams();
  if (kind) query.set("kind", kind);
  if (page > 1) query.set("page", String(page));
  const user = await requireAccountUser(
    runtime,
    `/me/comments${query.size ? `?${query}` : ""}`,
  );
  const result = await searchUserComments(runtime, {
    userId: user.id,
    page,
    pageSize: 20,
    kind,
  });

  return { locale: runtime.uiLocale, page, result, kind };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "account.nav.comments"), page: loaderData?.page }, error, locale);
};

export default function CommentsPage() {
  const t = useMessages();
  const { page, result, kind } = useLoaderData<typeof loader>();
  return (
    <div>
      <AccountPageHeader
        title={t("account.nav.comments")}
        subtitle={t(kind ? "account.activity.filteredComments" : "account.activity.comments", { count: result.total })}
      />
      <CommentCategoryFilter basePath="/me/comments" kind={kind} />
      {result.items.length ? (
        <CommentSummaryList items={result.items} showStatus />
      ) : (
        <AccountEmpty>{t(kind ? "account.activity.noFilteredComments" : "account.activity.noComments")}</AccountEmpty>
      )}
      <PaginationLinks
        basePath="/me/comments"
        params={{ kind }}
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
