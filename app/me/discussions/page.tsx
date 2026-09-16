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
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs } from "react-router";
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
  });

  return { result };
}

export default function DiscussionsPage() {
  const { result } = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader
        title="我的讨论"
        subtitle="按发表时间展示公开发帖和回帖，包含楼中楼回复。"
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
