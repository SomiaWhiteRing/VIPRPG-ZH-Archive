import { PaginationLinks } from "@/app/components/library/pagination-links";
import { DiscussionList } from "@/app/components/profile/discussion-list";
import { parseAccountPage } from "@/lib/server/auth/account-user";
import { getForumRuntime } from "@/lib/server/forum/next";
import { publicUserDiscussions } from "@/lib/server/forum/user-discussions";
import { requirePublicProfileSection } from "../public-user";

export const dynamic = "force-dynamic";

export default async function PublicDiscussions({ params, searchParams }: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await requirePublicProfileSection((await params).userId, "discussions");
  const page = parseAccountPage((await searchParams).page);
  const result = await publicUserDiscussions(getForumRuntime(), user.id, { page });
  return (
    <section>
      <h2>最近讨论</h2>
      <DiscussionList items={result.items} />
      <PaginationLinks basePath={`/users/${user.id}/discussions`} page={result.page} pageSize={result.pageSize} total={result.total} />
    </section>
  );
}
