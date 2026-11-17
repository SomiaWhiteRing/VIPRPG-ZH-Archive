import { translate } from "@/lib/i18n/core";
import { preserveUiLocale } from "@/lib/i18n/locale";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { adminForumList } from "@/app/.server/forum/admin";
import { getForumRuntime } from "@/app/.server/forum/context";
import { forumViewer } from "@/app/.server/forum/queries";
import { redirectPage } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { forumPage } from "@/lib/forum";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { AdminDiscussions } from "./workspace";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const user = await getCurrentUser(runtime);
  if (!user) {
    const url = new URL(args.request.url);
    const login = preserveUiLocale(new URL("/login?next=%2Fadmin%2Fdiscussions", url), url);
    redirectPage(login.pathname + login.search);
  }
  const viewer = forumViewer(user)!;
  const { moderate } = viewer;
  if (!moderate && !viewer.feature && !viewer.sage)
    redirectPage("/", args.request);
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

  return { viewer, p, view, query, state, data, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({
    title: [translate(locale, "admin.discussions.title"), translate(locale, "admin.characterIndex.console")],
    page: loaderData?.data.page,
  }, error, locale);
};

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
