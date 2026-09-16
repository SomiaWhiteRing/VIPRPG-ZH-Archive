import { getCurrentUser } from "@/app/.server/auth/current-user";
import { adminForumList } from "@/app/.server/forum/admin";
import { getForumRuntime } from "@/app/.server/forum/context";
import { forumViewer } from "@/app/.server/forum/queries";
import { redirectPage } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { hasPermission } from "@/lib/authz/permissions";
import { forumPage } from "@/lib/forum";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AdminDiscussions } from "./workspace";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const user = await getCurrentUser(runtime);
  if (!user) redirectPage("/login?next=%2Fadmin%2Fdiscussions");
  const moderate = hasPermission(user, "forum.content.moderate_any");
  if (!moderate && !hasPermission(user, "forum.topic.feature_any"))
    redirectPage("/");
  const p = await searchParams,
    view =
      moderate && ["reports", "posts", "topics"].includes(String(p.view))
        ? String(p.view)
        : moderate && !p.view
          ? "reports"
          : "topics";
  const query = typeof p.q === "string" ? p.q : "",
    state = typeof p.state === "string" ? p.state : "";
  const data = await adminForumList(getForumRuntime(runtime), user, {
    view,
    query,
    state,
    page: forumPage(p.page),
  });

  return { viewer: forumViewer(user)!, p, view, query, state, data };
}

export default function AdminDiscussionsPage() {
  const { viewer, p, view, query, state, data } =
    useLoaderData<typeof loader>();
  return (
    <AdminDiscussions
      key={JSON.stringify(p)}
      data={data}
      view={view}
      query={query}
      state={state}
      viewer={viewer}
    />
  );
}
