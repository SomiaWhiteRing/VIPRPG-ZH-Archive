import { getCurrentUser } from "@/app/.server/auth/current-user";
import { getForumRequestRuntime } from "@/app/.server/forum/context";
import { publicTopicList } from "@/app/.server/forum/public-queries";
import { topicViews } from "@/app/.server/views/service";
import { forumViewer, resolveTags } from "@/app/.server/forum/queries";
import { forumTagHeat } from "@/app/.server/forum/tag-heat";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { forumPage } from "@/lib/forum";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { interactiveTopic } from "@/lib/forum-state";
import { HttpError } from "@/lib/http";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { DiscussionWorkspace } from "./workspace";
import { translate } from "@/lib/i18n/core";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  const ctx = getForumRequestRuntime(runtime);
  const viewer = forumViewer(await getCurrentUser(runtime));
  const rawTag = Array.isArray(params.tag) ? params.tag[0] : params.tag;
  const featured = params.view === "featured";
  const page = forumPage(params.page);
  let selected: Awaited<ReturnType<typeof resolveTags>> = [];
  let topics;
  let filterError;
  try {
    selected = await resolveTags(ctx, rawTag ? [rawTag] : []);
    const result = await publicTopicList(ctx, {
      tags: selected.map((tag) => tag.id),
      featured,
      page,
    });
    topics = {
      ...result,
      items: await topicViews(
        runtime,
        result.items.map((topic) => interactiveTopic(topic, viewer)),
      ),
    };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 400) throw error;
    filterError = error.message;
  }
  const renderData0 = await forumTagHeat(ctx);

  return { viewer, featured, selected, topics, filterError, renderData0, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors(
    {
      title: translate(locale, loaderData?.featured ? "forum.featuredTitle" : "core.nav.discussions"),
      page: loaderData?.topics?.page,
    },
    error, locale,
  );
};

export default function DiscussionsPage() {
  const { viewer, featured, selected, topics, filterError, renderData0 } =
    useLoaderData<typeof loader>();
  return (
    <DiscussionWorkspace
      viewer={viewer}
      emojis={[]}
      topics={topics}
      selected={selected}
      popular={renderData0.tags}
      featured={featured}
      filterError={filterError}
    />
  );
}

export { default as ErrorBoundary } from "@/app/discussions/error";
