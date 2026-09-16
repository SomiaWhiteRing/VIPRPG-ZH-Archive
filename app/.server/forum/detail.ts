import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { CustomEmojiDto } from "@/lib/dto/db/work-community";
import type { ForumDetail } from "@/lib/forum";
import { FORUM_POST_PAGE_SIZE } from "@/lib/forum";
import { interactiveContent, interactiveTopic } from "@/lib/forum-state";
import { forumEngagement } from "./engagement";
import { forumLocation } from "./location";
import {
  assertPublicTopic,
  forumPostPage,
  forumPreviews,
  publicCommentPage,
} from "./public-queries";
import { unavailable } from "./queries";
import type { ForumRuntime } from "./runtime";

export async function forumDetail(
  ctx: ForumRuntime,
  topicId: number,
  input: {
    page: number;
    floor?: number;
    commentPage: number;
    comment?: number;
  },
  user: ArchiveUser | null,
): Promise<ForumDetail> {
  let { page, floor, commentPage } = input;
  if (input.comment) {
    const location = await forumLocation(ctx, topicId, {
      commentId: input.comment,
    });
    page = location.page;
    floor = location.postNumber;
    commentPage = location.commentPage;
  } else if (floor) {
    page = Math.ceil(floor / FORUM_POST_PAGE_SIZE);
  }
  const data = await forumPostPage(ctx, topicId, page);
  const ids = data.posts.items.map((post) => post.id);
  const engagement = await forumEngagement(ctx, user, topicId, ids);
  const topic = interactiveTopic(
    data.topic,
    engagement.viewer,
    engagement.topicCapabilities,
  );
  const previews = ids.length ? await forumPreviews(ctx, topicId, ids) : [];
  const selected = data.posts.items.find((post) => post.postNumber === floor);
  if (floor && (!selected || !selected.commentsAvailable)) unavailable();
  const expanded = selected
    ? await publicCommentPage(ctx, selected.id, commentPage)
    : null;
  const posts = data.posts.items.map((post) => {
    const preview = previews.find((item) => item.postId === post.id)!;
    const comment = (item: Parameters<typeof interactiveContent>[0]) => {
      const content = interactiveContent(item, topic, engagement.viewer);
      content.capabilities.reply &&= post.state === "published";
      return content;
    };
    const comments =
      post.id === selected?.id && expanded ? expanded : preview.comments;
    return {
      ...interactiveContent(post, topic, engagement.viewer, engagement.liked),
      commentsAvailable: preview.available,
      commentPreview: preview.comments.items.map(comment),
      comments: { ...comments, items: comments.items.map(comment) },
    };
  });
  await assertPublicTopic(ctx, topicId);
  return {
    topic,
    posts: { ...data.posts, items: posts },
    floor: floor ?? null,
    comment: input.comment ?? null,
  };
}

export async function forumEmojis(
  ctx: ForumRuntime,
  bodies: (string | null)[],
): Promise<CustomEmojiDto[]> {
  const codes = [
    ...new Set(
      bodies.flatMap((body) =>
        [...(body ?? "").matchAll(/:([A-Za-z0-9_+-]{1,64}):/g)].map(
          (match) => match[1],
        ),
      ),
    ),
  ];
  if (!codes.length) return [];
  const rows = await ctx.db
    .prepare(
      `SELECT id,shortcode,name,category,('/api/media/blobs/'||image_blob_sha256) AS imageUrl,
    visible_in_picker AS visibleInPicker,status FROM custom_emojis
    WHERE status IN('active','retired') AND shortcode IN(SELECT value FROM json_each(?)) ORDER BY shortcode`,
    )
    .bind(JSON.stringify(codes))
    .all<CustomEmojiDto>();
  return rows.results;
}
