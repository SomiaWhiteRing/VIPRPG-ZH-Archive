import { requirePagePermission } from "@/lib/server/auth/authorize";
import { adminForumTags } from "@/lib/server/forum/admin";
import { forumPage } from "@/lib/forum";
import { AdminDiscussionTags } from "./workspace";
export const dynamic = "force-dynamic";
export default async function DiscussionTagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(
      "/admin/discussion-tags",
      "forum.tag.manage",
    ),
    p = await searchParams;
  const query = typeof p.q === "string" ? p.q : "",
    state = typeof p.state === "string" ? p.state : "";
  return (
    <AdminDiscussionTags
      key={JSON.stringify(p)}
      data={await adminForumTags(user, {
        query,
        state,
        page: forumPage(p.page),
      })}
      query={query}
      state={state}
    />
  );
}
