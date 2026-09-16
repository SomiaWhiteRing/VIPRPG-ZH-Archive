import { PageHeader } from "@/app/components/ui/page-header";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { requireAccountUser, parseAccountPage } from "@/lib/server/auth/account-user";
import { getForumRuntime } from "@/lib/server/forum/next";
import { ownUserDiscussions } from "@/lib/server/forum/user-discussions";
import { DiscussionList } from "@/app/components/profile/discussion-list";

export const dynamic = "force-dynamic";

export default async function DiscussionsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(`/me/discussions${page > 1 ? `?page=${page}` : ""}`);
  const result = await ownUserDiscussions(getForumRuntime(), user, { page });
  return (
    <div>
      <PageHeader title="我的讨论" subtitle="按发表时间展示公开发帖和回帖，包含楼中楼回复。" />
      <DiscussionList items={result.items} />
      <PaginationLinks basePath="/me/discussions" page={result.page} pageSize={result.pageSize} total={result.total} />
    </div>
  );
}
