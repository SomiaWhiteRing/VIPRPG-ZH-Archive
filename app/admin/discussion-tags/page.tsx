import { requirePagePermission } from "@/app/.server/auth/authorize";
import { adminForumTags } from "@/app/.server/forum/admin";
import { getForumRuntime } from "@/app/.server/forum/context";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { forumPage } from "@/lib/forum";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AdminDiscussionTags } from "./workspace";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const user = await requirePagePermission(
      runtime,
      "/admin/discussion-tags",
      "forum.tag.manage",
    ),
    p = await searchParams;
  const query = typeof p.q === "string" ? p.q : "",
    state = typeof p.state === "string" ? p.state : "";
  const renderData0 = await adminForumTags(getForumRuntime(runtime), user, {
    query,
    state,
    page: forumPage(p.page),
  });

  return { p, query, state, renderData0 };
}

export default function DiscussionTagsPage() {
  const { p, query, state, renderData0 } = useLoaderData<typeof loader>();
  return (
    <AdminDiscussionTags
      key={JSON.stringify(p)}
      data={renderData0}
      query={query}
      state={state}
    />
  );
}
