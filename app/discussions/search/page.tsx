import { redirectPage } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { forumHref } from "@/lib/forum";
import { translate } from "@/lib/i18n/core";
import { parseUiLocale, UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  redirectPage(
    forumHref("/search", {
      scope: "discussions",
      q: params.q,
      page: params.page,
      [UI_LOCALE_PARAM]: parseUiLocale(new URL(args.request.url).searchParams.get(UI_LOCALE_PARAM)),
    }),
  );

  return {};
}

export const meta: MetaFunction = ({ error, location, matches }) => {
  const locale = pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "forum.search") }, error, locale);
};

export default function DiscussionSearchPage() {
  return null;
}

export { default as ErrorBoundary } from "@/app/discussions/error";
