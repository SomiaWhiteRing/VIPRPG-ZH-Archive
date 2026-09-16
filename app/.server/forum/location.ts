import {
  FORUM_COMMENT_PAGE_SIZE,
  FORUM_POST_PAGE_SIZE,
  forumHref,
} from "@/lib/forum";
import { unavailable } from "./queries";
import type { ForumRuntime } from "./runtime";

export async function forumLocation(
  ctx: ForumRuntime,
  topicId: number,
  target: { commentId?: number; postNumber?: number },
) {
  const row = target.commentId
    ? await ctx.db
        .prepare(
          `SELECT c.id,c.post_id,c.post_number,c.comment_number FROM forum_public_comments c WHERE c.id=? AND c.topic_id=?`,
        )
        .bind(target.commentId, topicId)
        .first<{
          id: number;
          post_id: number;
          post_number: number;
          comment_number: number;
        }>()
    : await ctx.db
        .prepare(
          `SELECT id,id AS post_id,post_number,0 AS comment_number FROM forum_public_posts WHERE topic_id=? AND post_number=?`,
        )
        .bind(topicId, target.postNumber ?? 1)
        .first<{
          id: number;
          post_id: number;
          post_number: number;
          comment_number: number;
        }>();
  if (!row) unavailable();
  const page = Math.ceil(row.post_number / FORUM_POST_PAGE_SIZE);
  const commentPage = target.commentId
    ? Math.ceil(row.comment_number / FORUM_COMMENT_PAGE_SIZE)
    : 1;
  return {
    topicId,
    page,
    commentPage,
    postId: row.post_id,
    postNumber: row.post_number,
    href:
      forumHref(`/discussions/${topicId}`, {
        page,
        floor: target.commentId ? row.post_number : null,
        commentPage: target.commentId ? commentPage : null,
        comment: target.commentId,
      }) +
      (target.commentId ? `#comment-${row.id}` : `#post-${row.post_number}`),
  };
}
