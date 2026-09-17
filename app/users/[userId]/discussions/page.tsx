import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { parseAccountPage } from "@/app/.server/auth/account-user";
import { getForumRuntime } from "@/app/.server/forum/context";
import { publicUserDiscussions } from "@/app/.server/forum/user-discussions";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { DiscussionList } from "@/app/components/profile/discussion-list";
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
    { page },
  );

  return { user, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: [loaderData?.user.displayName || "用户", "讨论"],
      page: loaderData?.result.page,
    },
    error,
  );

export default function PublicDiscussions() {
  const { user, result } = useLoaderData<typeof loader>();
  return (
    <section>
      <h2>最近讨论</h2>
      <DiscussionList items={result.items} />
      <PaginationLinks
        basePath={`/users/${user.id}/discussions`}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </section>
  );
}
