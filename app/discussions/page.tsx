import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { forumViewer, resolveTags } from "@/lib/server/forum/queries";
import { publicTopicList } from "@/lib/server/forum/public-queries";
import { getForumRequestRuntime } from "@/lib/server/forum/next";
import { forumTagHeat } from "@/lib/server/forum/tag-heat";
import { interactiveTopic } from "@/lib/forum-state";
import { HttpError } from "@/lib/server/http/json";
import { DiscussionWorkspace } from "./workspace";
import { forumPage } from "@/lib/forum";

export default async function DiscussionsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = getForumRequestRuntime();
  const viewer = forumViewer(await getCurrentUserFromCookies());
  const rawTags = params.tag ? Array.isArray(params.tag) ? params.tag : [params.tag] : [];
  const featured = params.view === "featured";
  const page = forumPage(params.page);
  let selected: Awaited<ReturnType<typeof resolveTags>> = [];
  let topics;
  let filterError;
  try {
    selected = await resolveTags(ctx, rawTags);
    const result = await publicTopicList(ctx, { tags: selected.map((tag) => tag.id), featured, page });
    topics = { ...result, items: result.items.map((topic) => interactiveTopic(topic, viewer)) };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 400) throw error;
    filterError = error.message;
  }
  return <DiscussionWorkspace viewer={viewer} emojis={[]} topics={topics}
    selected={selected} popular={(await forumTagHeat(ctx)).tags} featured={featured} filterError={filterError} />;
}
