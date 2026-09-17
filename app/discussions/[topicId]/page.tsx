import { getCurrentUser } from "@/app/.server/auth/current-user";
import { getInboxItemForUser } from "@/app/.server/db/inbox";
import { getForumRuntime } from "@/app/.server/forum/context";
import { forumDetail, forumEmojis } from "@/app/.server/forum/detail";
import { forumViewer } from "@/app/.server/forum/queries";
import { redirectPage, throwNotFound } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import type { AppRuntime } from "@/app/.server/runtime";
import { InboxReadOnView } from "@/app/inbox/read-on-view";
import { forumHref, forumListReturn, forumPage } from "@/lib/forum";
import { HttpError } from "@/lib/http";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { DiscussionWorkspace } from "../workspace";

function optionalId(value: unknown) {
  if (value == null) return undefined;
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throwNotFound();
  return Number(value);
}
const loadDetail = async (
  runtime: AppRuntime,
  id: number,
  page: number,
  floor: number | undefined,
  commentPage: number,
  comment: number | undefined,
) => {
  try {
    return await forumDetail(
      getForumRuntime(runtime),
      id,
      { page, floor, commentPage, comment },
      await getCurrentUser(runtime),
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throwNotFound();
    throw error;
  }
};

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);

  const { topicId } = await params,
    query = await searchParams;
  if (!/^[1-9]\d*$/.test(topicId) || !Number.isSafeInteger(Number(topicId)))
    throwNotFound();
  const user = await getCurrentUser(runtime);
  const viewer = forumViewer(user);
  const ctx = getForumRuntime(runtime);
  const detail = await loadDetail(
    runtime,
    Number(topicId),
    forumPage(query.page),
    optionalId(query.floor),
    forumPage(query.commentPage),
    optionalId(query.comment),
  );
  const commentPage = detail.floor
    ? detail.posts.items.find((p) => p.postNumber === detail.floor)?.comments
        .page
    : null;
  const returnTo = forumListReturn(query.from);
  const initialReply =
    query.reply === "topic" ? ("topic" as const) : optionalId(query.reply);
  const inboxId = optionalId(query.inbox);
  const canonical = forumHref(`/discussions/${topicId}`, {
    page: detail.posts.page,
    floor: detail.floor,
    commentPage,
    comment: detail.comment,
    from: returnTo,
    reply: initialReply,
    inbox: inboxId,
  });
  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    for (const item of Array.isArray(value) ? value : value ? [value] : [])
      incoming.append(key, item);
  if (
    canonical !==
    `/discussions/${topicId}${incoming.size ? `?${incoming}` : ""}`
  )
    redirectPage(
      canonical + (detail.comment ? `#comment-${detail.comment}` : ""),
    );
  const inboxItem =
    inboxId && user
      ? await getInboxItemForUser(runtime, inboxId, user).catch(
          (error: unknown) => {
            if (error instanceof HttpError && error.status === 404) return null;
            throw error;
          },
        )
      : null;
  const interaction = inboxItem?.interaction;
  const displayedPost =
    interaction?.topicId === Number(topicId)
      ? detail.posts.items.find(
          (post) =>
            post.postNumber === interaction.postNumber &&
            post.state === "published",
        )
      : null;
  const displayed =
    displayedPost &&
    (!interaction?.commentId ||
      (detail.comment === interaction.commentId &&
        displayedPost.comments.items.some(
          (comment) =>
            comment.id === interaction.commentId &&
            comment.state === "published",
        )));
  const renderData0 = await forumEmojis(
    ctx,
    detail.posts.items.flatMap((post) => [
      post.body,
      ...post.comments.items.map((comment) => comment.body),
      ...post.commentPreview.map((comment) => comment.body),
    ]),
  );

  const pageMetadata = {
    title: [detail.topic.title, "讨论版"],
    page: detail.posts.page,
    description:
      detail.posts.items
        .find((post) => post.postNumber === 1)
        ?.body?.slice(0, 160) || detail.topic.title,
    alternates: { canonical: `/discussions/${topicId}` },
  };
  return {
    viewer,
    detail,
    returnTo,
    initialReply,
    canonical,
    inboxItem,
    interaction,
    displayed,
    renderData0,
    pageMetadata,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(loaderData?.pageMetadata, error);

export default function TopicPage() {
  const {
    viewer,
    detail,
    returnTo,
    initialReply,
    inboxItem,
    interaction,
    displayed,
    renderData0,
  } = useLoaderData<typeof loader>();
  return (
    <>
      {displayed && inboxItem && !inboxItem.readAt && interaction ? (
        <InboxReadOnView
          itemId={inboxItem.id}
          topicId={interaction.topicId}
          postNumber={interaction.postNumber}
          commentId={interaction.commentId}
        />
      ) : null}
      <DiscussionWorkspace
        key={detail.topic.id}
        viewer={viewer}
        emojis={renderData0}
        initialDetail={detail}
        returnTo={returnTo}
        initialReply={initialReply}
      />
    </>
  );
}

export { default as ErrorBoundary } from "@/app/discussions/error";
