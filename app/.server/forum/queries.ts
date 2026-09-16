import { hasPermission } from "@/lib/authz/permissions";
import type {
  ForumAuthor,
  ForumCapabilities,
  ForumContent,
  ForumImage,
  ForumState,
  ForumTag,
  ForumTarget,
  ForumTopic,
  ForumViewer,
} from "@/lib/forum";
import { imageJsonSql } from "./images";
import type { ForumRuntime } from "./runtime";

import type { ArchiveUser } from "@/lib/dto/db/user-access";
import { HttpError } from "@/lib/http";

// Moderation audit detail only; TAG changes advance the owning topics' revisions.
const TAG_SNAPSHOT = `(SELECT COALESCE(json_group_array(json_array(id,revision,position)),'[]') FROM
  (SELECT g.id,g.revision,x.position FROM forum_topic_tags x JOIN forum_tags g ON g.id=x.tag_id WHERE x.topic_id=t.id ORDER BY x.position))`;
export type TopicRow = {
  id: number;
  user_id: number;
  title: string;
  status: ForumState;
  locked: number;
  featured_at: string | null;
  view_count: number;
  revision: string;
  tag_snapshot: string;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_avatar: string | null;
  author_status: string;
  public: number;
  replies: number;
  active_at: string;
  last_user_id: number | null;
  last_name: string | null;
  last_avatar: string | null;
  last_status: string | null;
  deletable: number;
  next_post_number: number;
};
export type ContentRow = {
  id: number;
  topic_id: number;
  post_id: number;
  post_number: number;
  comment_number: number;
  next_comment_number: number;
  user_id: number;
  kind: "post" | "comment";
  body: string;
  images_json?: string;
  status: ForumState;
  revision: string;
  created_at: string;
  edited_at: string | null;
  author_name: string;
  author_avatar: string | null;
  author_status: string;
  parent_status: ForumState;
  parent_user_status: string;
  public: number;
  reply_to_id: number | null;
  target_public: number;
  target_user_id: number | null;
  target_name: string | null;
  target_avatar: string | null;
  target_status: string | null;
  likes: number;
  liked: number;
};
const authorColumns = `u.display_name AS author_name,u.avatar_blob_sha256 AS author_avatar,u.status AS author_status`;
export const topicSql = `SELECT t.*,${authorColumns},${TAG_SNAPSHOT} AS tag_snapshot,
  EXISTS(SELECT 1 FROM forum_public_topics pt WHERE pt.id=t.id) AS public,
  t.reply_count AS replies,t.last_activity_at AS active_at,
  last_user.id AS last_user_id,last_user.display_name AS last_name,last_user.avatar_blob_sha256 AS last_avatar,last_user.status AS last_status,
  0 AS deletable
  FROM forum_topics t JOIN users u ON u.id=t.user_id
  LEFT JOIN forum_posts last_post ON last_post.id=t.last_post_id AND last_post.status='published'
  LEFT JOIN forum_post_comments last_comment ON last_comment.id=t.last_comment_id AND last_comment.status='published'
  LEFT JOIN forum_posts last_parent ON last_parent.id=last_comment.post_id AND last_parent.status IN('published','deleted')
  LEFT JOIN users last_parent_user ON last_parent_user.id=last_parent.user_id AND last_parent_user.status IN('active','deleted')
  LEFT JOIN users last_user ON last_user.id=COALESCE(last_post.user_id,CASE WHEN last_parent_user.id IS NOT NULL THEN last_comment.user_id END)
    AND last_user.status IN('active','deleted')`;

export function forumViewer(user: ArchiveUser | null): ForumViewer {
  return user
    ? {
        id: user.id,
        name: user.displayName,
        avatar: user.avatarBlobSha256,
        moderate: hasPermission(user, "forum.content.moderate_any"),
        feature: hasPermission(user, "forum.topic.feature_any"),
        tags: hasPermission(user, "forum.tag.manage"),
      }
    : null;
}
export function unavailable(): never {
  throw new HttpError(404, "内容不可用", "forum_unavailable");
}
export function author(
  id: number,
  name: string,
  avatar: string | null,
  status: string,
): ForumAuthor {
  return {
    id,
    name: status === "deleted" ? "账户已注销" : name,
    avatar: status === "deleted" ? null : avatar,
    profile: status === "active",
  };
}
export async function rawTopic(
  ctx: ForumRuntime,
  id: number,
): Promise<TopicRow> {
  const row = await ctx.db
    .prepare(`${topicSql} WHERE t.id=?`)
    .bind(id)
    .first<TopicRow>();
  if (!row) unavailable();
  return row;
}
export async function topicTags(
  ctx: ForumRuntime,
  ids: number[],
): Promise<Map<number, ForumTag[]>> {
  const tags = new Map<number, ForumTag[]>();
  if (!ids.length) return tags;
  const rows = await ctx.db
    .prepare(
      `SELECT x.topic_id,g.id,g.name,g.status AS state,g.revision,
    0 AS count
    FROM forum_topic_tags x JOIN forum_tags g ON g.id=x.tag_id
    WHERE x.topic_id IN (SELECT value FROM json_each(?)) AND g.status<>'hidden'
    ORDER BY x.topic_id,x.position`,
    )
    .bind(JSON.stringify(ids))
    .all<ForumTag & { topic_id: number }>();
  for (const { topic_id, ...tag } of rows.results) {
    const group = tags.get(topic_id) ?? [];
    group.push(tag);
    tags.set(topic_id, group);
  }
  return tags;
}
export function mapTopic(
  row: TopicRow,
  viewer: ForumViewer,
  tags: ForumTag[],
): ForumTopic {
  const own = viewer?.id === row.user_id && !!row.public;
  return {
    id: row.id,
    title: row.title,
    state: row.status,
    locked: !!row.locked,
    featured: !!row.featured_at,
    author: author(
      row.user_id,
      row.author_name,
      row.author_avatar,
      row.author_status,
    ),
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activeAt: row.active_at,
    replies: row.replies,
    views: row.view_count,
    lastAuthor: row.last_user_id
      ? author(
          row.last_user_id,
          row.last_name!,
          row.last_avatar,
          row.last_status!,
        )
      : null,
    revision: row.revision,
    capabilities: {
      edit: own && !row.locked,
      delete: own && !!row.deletable,
      reply: !!viewer && !!row.public && !row.locked,
      like: !!viewer && !!row.public,
      report: !!viewer && !!row.public,
      moderate: !!viewer?.moderate,
      feature: !!viewer?.feature && !!row.public,
    },
  };
}
export async function publicTopic(
  ctx: ForumRuntime,
  id: number,
  viewer: ForumViewer,
): Promise<ForumTopic> {
  const row = await rawTopic(ctx, id);
  if (!row.public) unavailable();
  const tags = await topicTags(ctx, [id]);
  return mapTopic(row, viewer, tags.get(id) ?? []);
}
export async function resolveTags(
  ctx: ForumRuntime,
  raw: string[],
): Promise<ForumTag[]> {
  if (raw.length > 5) throw new HttpError(400, "最多选择 5 个 TAG。");
  const ids = [
    ...new Set(
      raw
        .filter((v) => /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v)))
        .map(Number),
    ),
  ].sort((a, b) => a - b);
  if (!ids.length) return [];
  // JSON keeps arbitrary input out of SQL and avoids D1's bound-parameter limit.
  const rows = await ctx.db
    .prepare(
      `SELECT id,name,status AS state,revision,0 AS count FROM forum_tags
    WHERE id IN (SELECT value FROM json_each(?)) AND status<>'hidden' ORDER BY id`,
    )
    .bind(JSON.stringify(ids))
    .all<ForumTag>();
  return rows.results;
}

export function contentSql(
  kind: "post" | "comment",
  viewerId: number,
  publicOnly = false,
): string {
  const readable =
    kind === "post"
      ? "EXISTS(SELECT 1 FROM forum_public_posts visible WHERE visible.id=p.id)"
      : "EXISTS(SELECT 1 FROM forum_public_comments visible WHERE visible.id=c.id)";
  const source = kind === "post" ? "p" : "c";
  const projection = publicOnly
    ? `${source}.id,${source}.user_id,${source}.status,${source}.created_at,
    CASE WHEN ${readable} THEN ${source}.revision ELSE '' END AS revision,
    CASE WHEN ${readable} THEN ${source}.body ELSE '' END AS body,
    CASE WHEN ${readable} THEN ${source}.edited_at END AS edited_at,
    CASE WHEN ${readable} THEN u.display_name ELSE '' END AS author_name,
    CASE WHEN ${readable} THEN u.avatar_blob_sha256 END AS author_avatar,u.status AS author_status`
    : `${source}.*,${authorColumns}`;
  if (kind === "post")
    return `SELECT ${projection},${publicOnly ? "p.topic_id,p.post_number,p.next_comment_number," : ""}
    ${publicOnly ? "'[]'" : imageJsonSql} AS images_json,
    'post' AS kind,p.id AS post_id,p.status AS parent_status,u.status AS parent_user_status,
    ${readable} AS public,NULL AS reply_to_id,0 AS target_public,NULL AS target_user_id,NULL AS target_name,NULL AS target_avatar,NULL AS target_status,
    ${publicOnly ? "0" : "(SELECT COUNT(*) FROM forum_post_likes l WHERE l.post_id=p.id)"} AS likes,
    ${viewerId ? `EXISTS(SELECT 1 FROM forum_post_likes l WHERE l.post_id=p.id AND l.user_id=${viewerId})` : "0"} AS liked
    FROM forum_posts p JOIN users u ON u.id=p.user_id`;
  return `SELECT ${projection},${publicOnly ? "c.post_id,c.comment_number,c.reply_to_id," : ""}p.topic_id,p.post_number,'comment' AS kind,
    p.status AS parent_status,pu.status AS parent_user_status,${readable} AS public,
    target.id IS NOT NULL AND tu.status IN('active','deleted') AND p.status IN('published','deleted') AND pu.status IN('active','deleted') AS target_public,target.user_id AS target_user_id,tu.display_name AS target_name,tu.avatar_blob_sha256 AS target_avatar,tu.status AS target_status,0 AS likes,0 AS liked
    FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id JOIN users u ON u.id=c.user_id JOIN users pu ON pu.id=p.user_id
    LEFT JOIN forum_post_comments target ON target.id=c.reply_to_id AND target.status='published' LEFT JOIN users tu ON tu.id=target.user_id`;
}
export async function rawContent(
  ctx: ForumRuntime,
  target: ForumTarget,
  viewerId = 0,
): Promise<ContentRow> {
  if (!Number.isSafeInteger(viewerId) || viewerId < 0)
    throw new Error("Invalid viewer");
  const kind = target.kind === "comment" ? "comment" : "post";
  const condition =
    target.kind === "topic"
      ? "p.topic_id=? AND p.post_number=1"
      : `${kind === "post" ? "p" : "c"}.id=?`;
  const row = await ctx.db
    .prepare(`${contentSql(kind, viewerId)} WHERE ${condition}`)
    .bind(target.id)
    .first<ContentRow>();
  if (!row) unavailable();
  return row;
}

/** Mutation gates need identity/status/version, never image JSON, likes or the body. */
export async function contentIdentity(
  ctx: ForumRuntime,
  target: ForumTarget,
): Promise<ContentRow> {
  const comment = target.kind === "comment",
    source = comment ? "c" : "p";
  const where =
    target.kind === "topic"
      ? "p.topic_id=? AND p.post_number=1"
      : `${source}.id=?`;
  const row = await ctx.db
    .prepare(
      `SELECT ${source}.id,${source}.user_id,${source}.status,${source}.revision,
    p.topic_id,p.post_number,p.id AS post_id,${comment ? "c.comment_number" : "0"} AS comment_number,
    '${comment ? "comment" : "post"}' AS kind,
    EXISTS(SELECT 1 FROM ${comment ? "forum_public_comments" : "forum_public_posts"} visible WHERE visible.id=${source}.id) AS public
    FROM ${comment ? "forum_post_comments c JOIN forum_posts p ON p.id=c.post_id" : "forum_posts p"} WHERE ${where}`,
    )
    .bind(target.id)
    .first<ContentRow>();
  if (!row) unavailable();
  return row;
}
export function contentImages(
  row: Pick<ContentRow, "kind" | "images_json">,
): ForumImage[] {
  return row.kind === "post" ? JSON.parse(row.images_json ?? "[]") : [];
}
export function mapContent(
  row: ContentRow,
  topic: ForumTopic,
  viewer: ForumViewer,
): ForumContent {
  const readable = !!row.public;
  const own = readable && row.user_id === viewer?.id;
  const capability: ForumCapabilities = {
    edit: own && !topic.locked,
    delete: own,
    reply:
      readable &&
      !topic.locked &&
      row.parent_status === "published" &&
      !!viewer,
    like: readable && row.kind === "post" && !!viewer,
    report: readable && !!viewer,
    moderate: !!viewer?.moderate && row.status !== "deleted",
    feature: false,
  };
  if (row.kind === "post" && row.post_number === 1) {
    capability.edit = topic.capabilities.edit;
    capability.delete = topic.capabilities.delete;
  }
  return {
    id: row.id,
    kind: row.kind,
    topicId: row.topic_id,
    postId: row.post_id,
    postNumber: row.post_number,
    author: readable
      ? author(
          row.user_id,
          row.author_name,
          row.author_avatar,
          row.author_status,
        )
      : null,
    body: readable ? row.body : null,
    images: readable ? contentImages(row) : [],
    state: readable
      ? "published"
      : row.status === "published"
        ? "unavailable"
        : row.status,
    createdAt: row.created_at,
    editedAt: readable ? row.edited_at : null,
    revision: readable ? row.revision : "",
    likes: readable ? row.likes : 0,
    liked: readable && !!row.liked,
    replyTo:
      readable && row.reply_to_id
        ? {
            id: row.reply_to_id,
            author: row.target_public
              ? author(
                  row.target_user_id!,
                  row.target_name!,
                  row.target_avatar,
                  row.target_status!,
                )
              : null,
          }
        : null,
    capabilities: capability,
  };
}
