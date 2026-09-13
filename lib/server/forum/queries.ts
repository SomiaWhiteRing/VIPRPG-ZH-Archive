import { imageJsonSql } from "./images";
import { hasPermission } from "@/lib/authz/permissions";
import {
  FORUM_COMMENT_PAGE_SIZE,
  FORUM_PAGE_SIZE,
  FORUM_PREVIEW_SIZE,
  FORUM_QUERY_LENGTH,
  forumHref,
  forumPage,
  type ForumAuthor,
  type ForumCapabilities,
  type ForumContent,
  type ForumDetail,
  type ForumImage,
  type ForumPage,
  type ForumSearchHit,
  type ForumState,
  type ForumTag,
  type ForumTarget,
  type ForumTopic,
  type ForumViewer,
} from "@/lib/forum";
import { getD1 } from "@/lib/server/db/d1";
import type { ArchiveUser } from "@/lib/server/db/users";
import { HttpError } from "@/lib/server/http/json";
import { forumSearchSnippet, normalizeForumSearch } from "@/lib/forum-search";

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
};
export type ContentRow = {
  id: number;
  topic_id: number;
  post_id: number;
  post_number: number;
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
const topicSql = `SELECT t.*,${authorColumns},${TAG_SNAPSHOT} AS tag_snapshot,
  EXISTS(SELECT 1 FROM forum_public_topics pt WHERE pt.id=t.id) AS public,
  (SELECT COUNT(*) FROM forum_public_content c WHERE c.topic_id=t.id AND NOT(c.kind='post' AND c.post_number=1)) AS replies,
  COALESCE((SELECT MAX(c.created_at) FROM forum_public_content c WHERE c.topic_id=t.id),t.created_at) AS active_at,
  last_user.id AS last_user_id,last_user.display_name AS last_name,last_user.avatar_blob_sha256 AS last_avatar,last_user.status AS last_status,
  NOT EXISTS(SELECT 1 FROM forum_posts p WHERE p.topic_id=t.id AND p.post_number<>1 AND p.status<>'deleted')
    AND NOT EXISTS(SELECT 1 FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id WHERE p.topic_id=t.id AND c.status<>'deleted') AS deletable
  FROM forum_topics t JOIN users u ON u.id=t.user_id
  LEFT JOIN users last_user ON last_user.id=(SELECT c.user_id FROM forum_public_content c WHERE c.topic_id=t.id
    AND NOT(c.kind='post' AND c.post_number=1) ORDER BY c.created_at DESC,c.kind,c.id DESC LIMIT 1)`;

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
export async function rawTopic(id: number): Promise<TopicRow> {
  const row = await getD1()
    .prepare(`${topicSql} WHERE t.id=?`)
    .bind(id)
    .first<TopicRow>();
  if (!row) unavailable();
  return row;
}
export async function topicTags(
  ids: number[],
): Promise<Map<number, ForumTag[]>> {
  const tags = new Map<number, ForumTag[]>();
  if (!ids.length) return tags;
  const rows = await getD1()
    .prepare(
      `SELECT x.topic_id,g.id,g.name,g.status AS state,g.revision,
    (SELECT COUNT(*) FROM forum_topic_tags tx JOIN forum_public_topics pt ON pt.id=tx.topic_id WHERE tx.tag_id=g.id) AS count
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
  id: number,
  viewer: ForumViewer,
): Promise<ForumTopic> {
  const row = await rawTopic(id);
  if (!row.public) unavailable();
  const tags = await topicTags([id]);
  return mapTopic(row, viewer, tags.get(id) ?? []);
}
export async function listForumTags(
  query = "",
  mode: "filter" | "suggest" | "popular" = "filter",
): Promise<ForumTag[]> {
  const term = query
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .slice(0, FORUM_QUERY_LENGTH);
  const rows = await getD1()
    .prepare(
      `SELECT g.id,g.name,g.status AS state,g.revision,
    (SELECT COUNT(*) FROM forum_topic_tags x JOIN forum_public_topics t ON t.id=x.topic_id WHERE x.tag_id=g.id) AS count
    FROM forum_tags g WHERE g.status ${mode === "suggest" ? "='active'" : "<>'hidden'"} AND instr(g.name_key,?)>0
    ORDER BY ${mode === "popular" ? `(SELECT COUNT(*) FROM forum_topic_tags x JOIN forum_public_topics t ON t.id=x.topic_id WHERE x.tag_id=g.id AND t.created_at>=datetime('now','-90 days')) DESC,` : "CASE WHEN substr(g.name_key,1,length(?))=? THEN 0 ELSE 1 END,"}
    count DESC,g.name_key LIMIT ?`,
    )
    .bind(
      ...(mode === "popular"
        ? [term, 10]
        : [term, term, term, mode === "suggest" ? 8 : 100]),
    )
    .all<ForumTag>();
  return rows.results;
}
export async function resolveTags(raw: string[]): Promise<ForumTag[]> {
  const ids = [
    ...new Set(
      raw
        .filter((v) => /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v)))
        .map(Number),
    ),
  ].sort((a, b) => a - b);
  if (!ids.length) return [];
  // JSON keeps arbitrary input out of SQL and avoids D1's bound-parameter limit.
  const rows = await getD1()
    .prepare(
      `SELECT id,name,status AS state,revision,0 AS count FROM forum_tags
    WHERE id IN (SELECT value FROM json_each(?)) AND status<>'hidden' ORDER BY id`,
    )
    .bind(JSON.stringify(ids))
    .all<ForumTag>();
  return rows.results;
}
export async function listForumTopics(
  input: { tags?: number[]; featured?: boolean; page?: number },
  viewer: ForumViewer,
): Promise<ForumPage<ForumTopic>> {
  const ids = input.tags ?? [];
  if (ids.length > 5) throw new HttpError(400, "最多选择 5 个 TAG。");
  const where = `t.id IN (SELECT id FROM forum_public_topics) ${input.featured ? "AND t.featured_at IS NOT NULL" : ""}
    AND (SELECT COUNT(*) FROM forum_topic_tags x JOIN forum_tags g ON g.id=x.tag_id WHERE x.topic_id=t.id
      AND g.status<>'hidden' AND x.tag_id IN (SELECT value FROM json_each(?)))=?`;
  const args = [JSON.stringify(ids), ids.length];
  const total = (await getD1()
    .prepare(`SELECT COUNT(*) AS n FROM forum_topics t WHERE ${where}`)
    .bind(...args)
    .first<{ n: number }>())!.n;
  const page = Math.min(
    forumPage(input.page),
    Math.max(1, Math.ceil(total / FORUM_PAGE_SIZE)),
  );
  const rows = await getD1()
    .prepare(
      `${topicSql} WHERE ${where} ORDER BY ${input.featured ? "t.featured_at" : "active_at"} DESC,t.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...args, FORUM_PAGE_SIZE, (page - 1) * FORUM_PAGE_SIZE)
    .all<TopicRow>();
  const tags = await topicTags(rows.results.map((row) => row.id));
  const items = rows.results.map((row) =>
    mapTopic(row, viewer, tags.get(row.id) ?? []),
  );
  return { items, total, page, pageSize: FORUM_PAGE_SIZE };
}

function contentSql(kind: "post" | "comment", viewerId: number): string {
  if (kind === "post")
    return `SELECT p.*,${imageJsonSql} AS images_json,'post' AS kind,p.id AS post_id,${authorColumns},p.status AS parent_status,u.status AS parent_user_status,
    EXISTS(SELECT 1 FROM forum_public_posts v WHERE v.id=p.id) AS public,NULL AS reply_to_id,0 AS target_public,NULL AS target_user_id,
    NULL AS target_name,NULL AS target_avatar,NULL AS target_status,
    (SELECT COUNT(*) FROM forum_post_likes l WHERE l.post_id=p.id) AS likes,
    EXISTS(SELECT 1 FROM forum_post_likes l WHERE l.post_id=p.id AND l.user_id=${viewerId}) AS liked
    FROM forum_posts p JOIN users u ON u.id=p.user_id`;
  return `SELECT c.*,p.topic_id,p.post_number,'comment' AS kind,${authorColumns},p.status AS parent_status,pu.status AS parent_user_status,
    EXISTS(SELECT 1 FROM forum_public_comments v WHERE v.id=c.id) AS public,
    EXISTS(SELECT 1 FROM forum_public_comments v WHERE v.id=c.reply_to_id) AS target_public,
    target.user_id AS target_user_id,tu.display_name AS target_name,tu.avatar_blob_sha256 AS target_avatar,tu.status AS target_status,0 AS likes,0 AS liked
    FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id JOIN users u ON u.id=c.user_id JOIN users pu ON pu.id=p.user_id
    LEFT JOIN forum_post_comments target ON target.id=c.reply_to_id LEFT JOIN users tu ON tu.id=target.user_id`;
}
export async function rawContent(
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
  const row = await getD1()
    .prepare(`${contentSql(kind, viewerId)} WHERE ${condition}`)
    .bind(target.id)
    .first<ContentRow>();
  if (!row) unavailable();
  return row;
}
export function contentImages(row: Pick<ContentRow, "kind" | "images_json">): ForumImage[] {
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
export async function forumComments(
  postId: number,
  requestedPage: number,
  viewer: ForumViewer,
  preview = false,
): Promise<ForumPage<ForumContent>> {
  const parent = await rawContent({ kind: "post", id: postId });
  const topic = await publicTopic(parent.topic_id, viewer);
  if (
    parent.parent_status === "hidden" ||
    !["active", "deleted"].includes(parent.author_status)
  )
    unavailable();
  const total = (await getD1()
    .prepare("SELECT COUNT(*) AS n FROM forum_post_comments WHERE post_id=?")
    .bind(postId)
    .first<{ n: number }>())!.n;
  const page = Math.min(
    forumPage(requestedPage),
    Math.max(1, Math.ceil(total / FORUM_COMMENT_PAGE_SIZE)),
  );
  const rows = await getD1()
    .prepare(
      `${contentSql("comment", viewer?.id ?? 0)} WHERE c.post_id=? ORDER BY c.created_at,c.id LIMIT ? OFFSET ?`,
    )
    .bind(
      postId,
      preview ? FORUM_PREVIEW_SIZE : FORUM_COMMENT_PAGE_SIZE,
      preview ? 0 : (page - 1) * FORUM_COMMENT_PAGE_SIZE,
    )
    .all<ContentRow>();
  return {
    items: rows.results.map((row) => mapContent(row, topic, viewer)),
    total,
    page,
    pageSize: FORUM_COMMENT_PAGE_SIZE,
  };
}
export async function locateForumContent(
  topicId: number,
  target: { postNumber?: number; commentId?: number },
  viewer: ForumViewer,
) {
  const topic = await publicTopic(topicId, viewer);
  let row: ContentRow;
  if (target.commentId)
    row = await rawContent({ kind: "comment", id: target.commentId });
  else {
    const found = await getD1()
      .prepare("SELECT id FROM forum_posts WHERE topic_id=? AND post_number=?")
      .bind(topicId, target.postNumber ?? 1)
      .first<{ id: number }>();
    if (!found) unavailable();
    row = await rawContent({ kind: "post", id: found.id });
  }
  if (!row.public || row.topic_id !== topic.id) unavailable();
  const count = (await getD1()
    .prepare(
      "SELECT COUNT(*) AS n FROM forum_posts WHERE topic_id=? AND post_number<=?",
    )
    .bind(topicId, row.post_number)
    .first<{ n: number }>())!.n;
  const page = Math.ceil(count / FORUM_PAGE_SIZE);
  let commentPage = 1;
  if (target.commentId)
    commentPage = Math.ceil(
      (await getD1()
        .prepare(
          "SELECT COUNT(*) AS n FROM forum_post_comments WHERE post_id=? AND (created_at<? OR (created_at=? AND id<=?))",
        )
        .bind(row.post_id, row.created_at, row.created_at, row.id)
        .first<{ n: number }>())!.n / FORUM_COMMENT_PAGE_SIZE,
    );
  const href =
    forumHref(`/discussions/${topicId}`, {
      page,
      floor: target.commentId ? row.post_number : null,
      commentPage: target.commentId ? commentPage : null,
      comment: target.commentId,
    }) + (target.commentId ? `#comment-${row.id}` : `#post-${row.post_number}`);
  return { page, commentPage, postNumber: row.post_number, href };
}
export async function forumDetail(
  id: number,
  input: {
    page?: number;
    floor?: number;
    commentPage?: number;
    comment?: number;
  },
  viewer: ForumViewer,
): Promise<ForumDetail> {
  const topic = await publicTopic(id, viewer);
  let requestedPage = input.page ?? 1;
  let floor = input.floor ?? null;
  let commentPage = input.commentPage ?? 1;
  if (input.comment) {
    const found = await locateForumContent(
      id,
      { commentId: input.comment },
      viewer,
    );
    requestedPage = found.page;
    floor = found.postNumber;
    commentPage = found.commentPage;
  } else if (floor) {
    const parent = await getD1()
      .prepare(
        "SELECT p.post_number,p.status,u.status AS user_status FROM forum_posts p JOIN users u ON u.id=p.user_id WHERE p.topic_id=? AND p.post_number=?",
      )
      .bind(id, floor)
      .first<{ post_number: number; status: string; user_status: string }>();
    if (
      !parent ||
      parent.status === "hidden" ||
      parent.user_status === "disabled"
    )
      unavailable();
    requestedPage = Math.ceil(
      (await getD1()
        .prepare(
          "SELECT COUNT(*) AS n FROM forum_posts WHERE topic_id=? AND post_number<=?",
        )
        .bind(id, floor)
        .first<{ n: number }>())!.n / FORUM_PAGE_SIZE,
    );
  }
  const total = (await getD1()
    .prepare("SELECT COUNT(*) AS n FROM forum_posts WHERE topic_id=?")
    .bind(id)
    .first<{ n: number }>())!.n;
  const page = Math.min(
    forumPage(requestedPage),
    Math.max(1, Math.ceil(total / FORUM_PAGE_SIZE)),
  );
  const rows = await getD1()
    .prepare(
      `${contentSql("post", viewer?.id ?? 0)} WHERE p.topic_id=? ORDER BY p.post_number LIMIT ? OFFSET ?`,
    )
    .bind(id, FORUM_PAGE_SIZE, (page - 1) * FORUM_PAGE_SIZE)
    .all<ContentRow>();
  const items: ForumDetail["posts"]["items"] = [];
  for (const row of rows.results) {
    const commentsAvailable =
      row.status !== "hidden" && row.author_status !== "disabled";
    const comments: ForumPage<ForumContent> = commentsAvailable
      ? await forumComments(
          row.id,
          row.post_number === floor ? commentPage : 1,
          viewer,
          row.post_number !== floor,
        )
      : { items: [], total: 0, page: 1, pageSize: FORUM_COMMENT_PAGE_SIZE };
    const commentPreview =
      comments.page === 1
        ? comments.items.slice(0, FORUM_PREVIEW_SIZE)
        : (await forumComments(row.id, 1, viewer, true)).items;
    items.push({
      ...mapContent(row, topic, viewer),
      commentsAvailable,
      comments,
      commentPreview,
    });
  }
  // A concurrent moderation may have invalidated the enclosing topic while rows were read.
  await publicTopic(id, viewer);
  return {
    topic,
    posts: { items, total, page, pageSize: FORUM_PAGE_SIZE },
    floor,
    comment: input.comment ?? null,
  };
}
export async function searchForum(
  input: {
    query: string;
    tags: number[];
    featured: boolean;
    latest: boolean;
    page: number;
  },
  viewer: ForumViewer,
): Promise<ForumPage<ForumSearchHit>> {
  const query = normalizeForumSearch(input.query).trim();
  if (query.length > FORUM_QUERY_LENGTH)
    throw new HttpError(400, `搜索词最多 ${FORUM_QUERY_LENGTH} 个字符。`);
  if (!query)
    return { items: [], total: 0, page: 1, pageSize: FORUM_PAGE_SIZE };
  if (input.tags.length > 5) throw new HttpError(400, "最多选择 5 个 TAG。");
  const source = `WITH matches AS (SELECT c.*,CASE
    WHEN c.kind='post' AND c.post_number=1 AND instr(t.title_search,?)>0 THEN 4
    WHEN c.kind='post' AND c.post_number=1 AND EXISTS(SELECT 1 FROM forum_topic_tags x JOIN forum_tags g ON g.id=x.tag_id WHERE x.topic_id=t.id AND g.status<>'hidden' AND instr(g.name_key,?)>0) THEN 3
    WHEN instr(c.body_search,?)>0 THEN 2 WHEN instr(lower(u.display_name),?)>0 THEN 1 ELSE 0 END AS score
    FROM forum_public_content c JOIN forum_public_topics t ON t.id=c.topic_id JOIN users u ON u.id=c.user_id
    WHERE ${input.featured ? "t.featured_at IS NOT NULL AND" : ""}
    (SELECT COUNT(*) FROM forum_topic_tags x JOIN forum_tags g ON g.id=x.tag_id WHERE x.topic_id=t.id AND g.status<>'hidden' AND x.tag_id IN(SELECT value FROM json_each(?)))=?)`;
  const binds = [
    query,
    query,
    query,
    query,
    JSON.stringify(input.tags),
    input.tags.length,
  ];
  const total = (await getD1()
    .prepare(`${source} SELECT COUNT(*) AS n FROM matches WHERE score>0`)
    .bind(...binds)
    .first<{ n: number }>())!.n;
  const page = Math.min(
    forumPage(input.page),
    Math.max(1, Math.ceil(total / FORUM_PAGE_SIZE)),
  );
  const rows = await getD1()
    .prepare(
      `${source} SELECT * FROM matches WHERE score>0 ORDER BY ${input.latest ? "" : "score DESC,"} created_at DESC,kind,id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...binds, FORUM_PAGE_SIZE, (page - 1) * FORUM_PAGE_SIZE)
    .all<{
      kind: "post" | "comment";
      id: number;
      topic_id: number;
      score: number;
    }>();
  const items: ForumSearchHit[] = [];
  for (const row of rows.results) {
    const raw = await rawContent(row, viewer?.id);
    if (!raw.public) continue;
    const topic = await publicTopic(row.topic_id, viewer);
    const content = mapContent(raw, topic, viewer);
    items.push({
      content,
      topic,
      score: row.score,
      snippet: !raw.body && content.images.length ? `图片 × ${content.images.length}` :
        forumSearchSnippet(raw.body, query),
    });
  }
  return { items, total, page, pageSize: FORUM_PAGE_SIZE };
}
