import type { ArchiveUser } from "@/lib/dto/db/user-access";
import type { UserDiscussionItem } from "@/lib/dto/forum/activity";
import type { ForumPage } from "@/lib/forum";
import { forumPage } from "@/lib/forum";
import type { ForumRuntime } from "./runtime";

type DiscussionPageInput = { page?: number; pageSize?: number };
type DiscussionRow = {
  kind: "post" | "comment";
  id: number;
  topic_id: number;
  post_number: number;
  title: string;
  snippet: string;
  created_at: string;
};

export function publicUserDiscussions(
  ctx: ForumRuntime,
  userId: number,
  input: DiscussionPageInput = {},
) {
  return userDiscussions(ctx, userId, false, input);
}

export function ownUserDiscussions(
  ctx: ForumRuntime,
  user: ArchiveUser,
  input: DiscussionPageInput = {},
) {
  return userDiscussions(ctx, user.id, user.status === "active", input);
}

async function userDiscussions(
  ctx: ForumRuntime,
  userId: number,
  own: boolean,
  input: DiscussionPageInput,
): Promise<ForumPage<UserDiscussionItem>> {
  const pageSize = Math.min(50, forumPage(input.pageSize ?? 20));
  const source = `FROM forum_public_content c
    JOIN forum_public_topics t ON t.id=c.topic_id
    JOIN users u ON u.id=c.user_id
    WHERE c.user_id=? AND u.status='active' AND (?=1 OR u.profile_show_discussions=1)`;
  const bindings = [userId, own ? 1 : 0];
  const total = (await ctx.db
    .prepare(`SELECT COUNT(*) AS total ${source}`)
    .bind(...bindings)
    .first<{ total: number }>())!.total;
  const page = Math.min(
    forumPage(input.page),
    Math.max(1, Math.ceil(total / pageSize)),
  );
  const rows = await ctx.db
    .prepare(
      `SELECT c.kind,c.id,c.topic_id,c.post_number,t.title,
      substr(c.body,1,180) AS snippet,c.created_at
    ${source} ORDER BY c.created_at DESC,c.kind DESC,c.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, pageSize, (page - 1) * pageSize)
    .all<DiscussionRow>();
  return {
    items: rows.results.map((row) => ({
      id: row.id,
      kind:
        row.kind === "post" && row.post_number === 1
          ? ("topic" as const)
          : row.kind,
      title: row.title,
      snippet: row.snippet,
      createdAt: row.created_at.includes("T")
        ? row.created_at
        : row.created_at.replace(" ", "T") + "Z",
      href:
        row.kind === "comment"
          ? `/discussions/${row.topic_id}/comments/${row.id}`
          : `/discussions/${row.topic_id}/posts/${row.post_number}`,
    })),
    total,
    page,
    pageSize,
  };
}
