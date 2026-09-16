import { redirectPage } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { forumHref } from "@/lib/forum";
import type { LoaderFunctionArgs } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  redirectPage(
    forumHref("/search", {
      scope: "discussions",
      q: params.q,
      page: params.page,
    }),
  );

  return {};
}

export default function DiscussionSearchPage() {
  return null;
}

export { default as ErrorBoundary } from "@/app/discussions/error";
