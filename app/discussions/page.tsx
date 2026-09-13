import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { listAdminEmojis } from "@/lib/server/db/work-community";
import {
  forumViewer,
  listForumTags,
  listForumTopics,
  resolveTags,
} from "@/lib/server/forum/queries";
import { forumHref, forumPage } from "@/lib/forum";
import { DiscussionWorkspace } from "./workspace";
export const dynamic = "force-dynamic";
export default async function DiscussionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams,
    rawTags = params.tag
      ? Array.isArray(params.tag)
        ? params.tag
        : [params.tag]
      : [];
  const selected = await resolveTags(rawTags),
    featured = params.view === "featured",
    viewer = forumViewer(await getCurrentUserFromCookies());
  const page =
    selected.length <= 5
      ? await listForumTopics(
          {
            tags: selected.map((t) => t.id),
            featured,
            page: forumPage(params.page),
          },
          viewer,
        )
      : undefined;
  const canonical = forumHref("/discussions", {
    view: featured ? "featured" : null,
    tag: selected.map((t) => t.id),
    page: page?.page,
  });
  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const item of Array.isArray(value) ? value : value ? [value] : [])
      incoming.append(key, item);
  if (
    selected.length <= 5 &&
    canonical !== `/discussions${incoming.size ? `?${incoming}` : ""}`
  )
    redirect(canonical);
  return (
    <DiscussionWorkspace
      viewer={viewer}
      emojis={await listAdminEmojis()}
      topics={page}
      selected={selected}
      popular={await listForumTags("", "popular")}
      featured={featured}
      filterError={
        selected.length > 5 ? "最多选择 5 个 TAG，请移除多余筛选。" : undefined
      }
    />
  );
}
