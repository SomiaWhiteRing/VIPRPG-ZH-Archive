import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Metadata } from "next";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { forumDetail, forumEmojis } from "@/lib/server/forum/detail";
import { getForumRuntime } from "@/lib/server/forum/next";
import { forumViewer } from "@/lib/server/forum/queries";
import { forumHref, forumListReturn, forumPage } from "@/lib/forum";
import { HttpError } from "@/lib/server/http/json";
import { DiscussionWorkspace } from "../workspace";
export const dynamic = "force-dynamic";
type TopicProps = {
  params: Promise<{ topicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
function optionalId(value: unknown) {
  if (value == null) return undefined;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) notFound();
  return Number(value);
}
const loadDetail = cache(async (id: number, page: number, floor: number | undefined, commentPage: number, comment: number | undefined) => {
  try {
    return await forumDetail(getForumRuntime(), id, { page, floor, commentPage, comment }, await getCurrentUserFromCookies());
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
});
export async function generateMetadata({ params, searchParams }: TopicProps): Promise<Metadata> {
  const { topicId } = await params;
  const query = await searchParams;
  const id = optionalId(topicId)!;
  const detail = await loadDetail(id, forumPage(query.page), optionalId(query.floor), forumPage(query.commentPage), optionalId(query.comment));
  return {
    title: `${detail.topic.title} - 讨论 - VIPRPG.org`,
    description: detail.posts.items.find((post) => post.postNumber === 1)?.body?.slice(0, 160) || detail.topic.title,
    alternates: { canonical: `/discussions/${id}` },
  };
}
export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ topicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { topicId } = await params,
    query = await searchParams;
  if (!/^[1-9]\d*$/.test(topicId) || !Number.isSafeInteger(Number(topicId)))
    notFound();
  const user = await getCurrentUserFromCookies();
  const viewer = forumViewer(user);
  const ctx = getForumRuntime();
  const detail = await loadDetail(Number(topicId), forumPage(query.page), optionalId(query.floor), forumPage(query.commentPage), optionalId(query.comment));
  const commentPage = detail.floor
    ? detail.posts.items.find((p) => p.postNumber === detail.floor)?.comments
        .page
    : null;
  const returnTo = forumListReturn(query.from);
  const initialReply = query.reply === "topic" ? "topic" : optionalId(query.reply);
  const canonical = forumHref(`/discussions/${topicId}`, {
    page: detail.posts.page,
    floor: detail.floor,
    commentPage,
    comment: detail.comment,
    from: returnTo,
    reply: initialReply,
  });
  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    for (const item of Array.isArray(value) ? value : value ? [value] : [])
      incoming.append(key, item);
  if (
    canonical !==
    `/discussions/${topicId}${incoming.size ? `?${incoming}` : ""}`
  )
    redirect(canonical + (detail.comment ? `#comment-${detail.comment}` : ""));
  return (
    <DiscussionWorkspace
      key={`${canonical}-${detail.topic.revision}`}
      viewer={viewer}
      emojis={await forumEmojis(ctx, detail.posts.items.flatMap((post) => [post.body, ...post.comments.items.map((comment) => comment.body), ...post.commentPreview.map((comment) => comment.body)]))}
      initialDetail={detail}
      returnTo={returnTo}
      initialReply={initialReply}
    />
  );
}
