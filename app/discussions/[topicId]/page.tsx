import { notFound, redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { listAdminEmojis } from "@/lib/server/db/work-community";
import { forumDetail, forumViewer } from "@/lib/server/forum/queries";
import { forumHref, forumListReturn, forumPage } from "@/lib/forum";
import { HttpError } from "@/lib/server/http/json";
import { DiscussionWorkspace } from "../workspace";
export const dynamic = "force-dynamic";
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
  const viewer = forumViewer(await getCurrentUserFromCookies());
  const optionalId = (value: unknown) => {
    if (value == null) return undefined;
    if (
      typeof value !== "string" ||
      !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      notFound();
    return Number(value);
  };
  let detail;
  try {
    detail = await forumDetail(
      Number(topicId),
      {
        page: forumPage(query.page),
        floor: optionalId(query.floor),
        commentPage: forumPage(query.commentPage),
        comment: optionalId(query.comment),
      },
      viewer,
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
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
      emojis={await listAdminEmojis()}
      initialDetail={detail}
      returnTo={returnTo}
      initialReply={initialReply}
    />
  );
}
