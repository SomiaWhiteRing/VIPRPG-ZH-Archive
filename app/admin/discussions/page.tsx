import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/authz/permissions";
import { forumPage } from "@/lib/forum";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { adminForumList } from "@/lib/server/forum/admin";
import { forumViewer } from "@/lib/server/forum/queries";
import { AdminDiscussions } from "./workspace";
export const dynamic = "force-dynamic";
export default async function AdminDiscussionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?next=%2Fadmin%2Fdiscussions");
  const moderate = hasPermission(user, "forum.content.moderate_any");
  if (!moderate && !hasPermission(user, "forum.topic.feature_any"))
    redirect("/");
  const p = await searchParams,
    view =
      moderate && ["reports", "posts", "topics"].includes(String(p.view))
        ? String(p.view)
        : moderate && !p.view
          ? "reports"
          : "topics";
  const query = typeof p.q === "string" ? p.q : "",
    state = typeof p.state === "string" ? p.state : "";
  const data = await adminForumList(user, {
    view,
    query,
    state,
    page: forumPage(p.page),
  });
  return (
    <AdminDiscussions
      key={JSON.stringify(p)}
      data={data}
      view={view}
      query={query}
      state={state}
      viewer={forumViewer(user)!}
    />
  );
}
