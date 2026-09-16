import type { ForumImage, ForumPage, ForumTopic } from "@/lib/forum";
import type { PublicSearchPage } from "@/lib/dto/forum/activity";
import {
  FORUM_COMMENT_PAGE_SIZE,
  FORUM_PAGE_SIZE,
  FORUM_POST_PAGE_SIZE,
  forumPage,
} from "@/lib/forum";
import type { PublicForumContent } from "@/lib/forum-public";
import { publicContentDto, publicTopicDto } from "@/lib/forum-public";
import {
  FORUM_SEARCH_PAGE_SIZE,
  forumSearchPhrase,
} from "@/lib/forum-search-index";
import { HttpError } from "@/lib/http";
import { imageColumns } from "./images";
import type { ContentRow } from "./queries";
import {
  author,
  contentSql,
  mapContent,
  mapTopic,
  rawTopic,
  topicTags,
  unavailable,
} from "./queries";
import type { ForumRuntime } from "./runtime";

export function cursorId(raw: string | null): number {
  if (raw === null || raw === "") return Number.MAX_SAFE_INTEGER;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new HttpError(400, "分页位置无效。");
  return Number(raw);
}

export async function forumPostPage(
  ctx: ForumRuntime,
  topicId: number,
  requested: number,
) {
  const row = await rawTopic(ctx, topicId);
  if (!row.public) unavailable();
  const total = row.next_post_number - 1;
  const page = Math.min(
    forumPage(requested),
    Math.max(1, Math.ceil(total / FORUM_POST_PAGE_SIZE)),
  );
  const low = (page - 1) * FORUM_POST_PAGE_SIZE + 1;
  const data = await ctx.db
    .prepare(
      `${contentSql("post", 0, true)} WHERE p.topic_id=? AND p.post_number BETWEEN ? AND ? ORDER BY p.post_number`,
    )
    .bind(topicId, low, low + FORUM_POST_PAGE_SIZE - 1)
    .all<ContentRow>();
  const tags = await topicTags(ctx, [topicId]);
  const topic = mapTopic(row, null, tags.get(topicId) ?? []);
  const ids = JSON.stringify(
    data.results.filter((p) => p.public).map((p) => p.id),
  );
  const images = await ctx.db
    .prepare(
      `SELECT post_id,${imageColumns} FROM forum_images WHERE post_id IN(SELECT value FROM json_each(?)) AND status='ready' ORDER BY post_id,position`,
    )
    .bind(ids)
    .all<ForumImage & { post_id: number }>();
  const likes = await ctx.db
    .prepare(
      `SELECT post_id,COUNT(*) AS n FROM forum_post_likes WHERE post_id IN(SELECT value FROM json_each(?)) GROUP BY post_id`,
    )
    .bind(ids)
    .all<{ post_id: number; n: number }>();
  const imageMap = new Map<number, ForumImage[]>();
  for (const { post_id, ...image } of images.results) {
    const list = imageMap.get(post_id) ?? [];
    list.push(image);
    imageMap.set(post_id, list);
  }
  const likeMap = new Map(likes.results.map((r) => [r.post_id, r.n]));
  await assertPublicTopic(ctx, topicId);
  return {
    topic: publicTopicDto(topic),
    posts: {
      page,
      pageSize: FORUM_POST_PAGE_SIZE,
      total,
      items: data.results.map((post) => ({
        ...publicContentDto(mapContent(post, topic, null)),
        images: imageMap.get(post.id) ?? [],
        likes: likeMap.get(post.id) ?? 0,
        commentsAvailable:
          post.status !== "hidden" && post.author_status !== "disabled",
        comments: {
          items: [],
          total: 0,
          page: 1,
          pageSize: FORUM_COMMENT_PAGE_SIZE,
        },
      })),
    },
  };
}

export async function assertPublicTopic(ctx: ForumRuntime, id: number) {
  if (
    !(await ctx.db
      .prepare("SELECT id FROM forum_public_topics WHERE id=?")
      .bind(id)
      .first())
  )
    unavailable();
}

function parentQuery(ids: number[]) {
  if (
    !ids.length ||
    ids.length > FORUM_POST_PAGE_SIZE ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    new Set(ids).size !== ids.length
  )
    throw new HttpError(400, "楼层集合无效。");
  return JSON.stringify(ids);
}

export async function forumPreviews(
  ctx: ForumRuntime,
  topicId: number,
  ids: number[],
) {
  const selected = parentQuery(ids);
  const [parents, comments] = (await ctx.db.batch([
    ctx.db
      .prepare(
        `SELECT p.id,p.next_comment_number,t.locked,p.status,u.status AS author_status
    FROM forum_posts p JOIN forum_public_topics t ON t.id=p.topic_id JOIN users u ON u.id=p.user_id
    WHERE p.topic_id=? AND p.id IN(SELECT value FROM json_each(?))`,
      )
      .bind(topicId, selected),
    ctx.db
      .prepare(
        `${contentSql("comment", 0, true)}
      WHERE p.topic_id=? AND c.post_id IN(SELECT value FROM json_each(?)) AND c.comment_number<=5
        AND p.status<>'hidden' AND pu.status IN('active','deleted') ORDER BY c.post_id,c.comment_number`,
      )
      .bind(topicId, selected),
  ])) as [
    D1Result<{
      id: number;
      next_comment_number: number;
      locked: number;
      status: string;
      author_status: string;
    }>,
    D1Result<ContentRow>,
  ];
  if (parents.results.length !== ids.length) unavailable();
  const allowed = parents.results.filter(
    (p) => p.status !== "hidden" && p.author_status !== "disabled",
  );
  const context = {
    locked: !!parents.results[0]?.locked,
    capabilities: {},
  } as ForumTopic;
  const grouped = new Map<number, PublicForumContent[]>();
  for (const row of comments.results) {
    const list = grouped.get(row.post_id) ?? [];
    list.push(publicContentDto(mapContent(row, context, null)));
    grouped.set(row.post_id, list);
  }
  return parents.results.map((p) => ({
    postId: p.id,
    available: allowed.some((a) => a.id === p.id),
    comments: {
      items: grouped.get(p.id) ?? [],
      total: allowed.some((a) => a.id === p.id) ? p.next_comment_number - 1 : 0,
      page: 1,
      pageSize: FORUM_COMMENT_PAGE_SIZE,
    },
  }));
}

export async function publicCommentPage(
  ctx: ForumRuntime,
  postId: number,
  requested: number,
): Promise<ForumPage<PublicForumContent>> {
  const parent = await ctx.db
    .prepare(
      `SELECT p.next_comment_number,p.topic_id,t.locked FROM forum_posts p
    JOIN forum_public_topics t ON t.id=p.topic_id JOIN users u ON u.id=p.user_id
    WHERE p.id=? AND p.status<>'hidden' AND u.status IN('active','deleted')`,
    )
    .bind(postId)
    .first<{ next_comment_number: number; topic_id: number; locked: number }>();
  if (!parent) unavailable();
  const total = parent.next_comment_number - 1;
  const page = Math.min(
    forumPage(requested),
    Math.max(1, Math.ceil(total / FORUM_COMMENT_PAGE_SIZE)),
  );
  const rows = await ctx.db
    .prepare(
      `${contentSql("comment", 0, true)} WHERE c.post_id=? AND c.comment_number BETWEEN ? AND ? ORDER BY c.comment_number`,
    )
    .bind(
      postId,
      (page - 1) * FORUM_COMMENT_PAGE_SIZE + 1,
      page * FORUM_COMMENT_PAGE_SIZE,
    )
    .all<ContentRow>();
  if (
    !(await ctx.db
      .prepare(
        `SELECT p.id FROM forum_posts p JOIN forum_public_topics t ON t.id=p.topic_id JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.status<>'hidden' AND u.status IN('active','deleted')`,
      )
      .bind(postId)
      .first())
  )
    unavailable();
  return {
    items: rows.results.map((row) =>
      publicContentDto(
        mapContent(row, { locked: !!parent.locked } as ForumTopic, null),
      ),
    ),
    total,
    page,
    pageSize: FORUM_COMMENT_PAGE_SIZE,
  };
}

export async function indexedForumSearch(
  ctx: ForumRuntime,
  input: { query: string; tags: number[]; featured: boolean; page: number },
): Promise<PublicSearchPage> {
  if (input.tags.length > 5) throw new HttpError(400, "最多选择 5 个 TAG。");
  if (!input.query.trim())
    return { items: [], total: 0, page: 1, pageSize: FORUM_SEARCH_PAGE_SIZE };
  const phrase = `{title body}:${forumSearchPhrase(input.query)} AND scope:public`;
  const source = `FROM forum_search_index f JOIN forum_search_documents d ON d.id=f.rowid
    LEFT JOIN forum_posts p ON p.id=d.post_id LEFT JOIN forum_post_comments c ON c.id=d.comment_id
    LEFT JOIN forum_posts parent ON parent.id=c.post_id JOIN forum_topics t ON t.id=COALESCE(p.topic_id,parent.topic_id)
    JOIN users u ON u.id=COALESCE(p.user_id,c.user_id)
    WHERE forum_search_index MATCH ?
      AND (EXISTS(SELECT 1 FROM forum_public_posts visible_post WHERE visible_post.id=p.id)
        OR EXISTS(SELECT 1 FROM forum_public_comments visible_comment WHERE visible_comment.id=c.id))
      AND (?=0 OR t.featured_at IS NOT NULL)
      AND (SELECT COUNT(*) FROM forum_topic_tags x JOIN forum_tags g ON g.id=x.tag_id WHERE x.topic_id=t.id AND g.status<>'hidden' AND x.tag_id IN(SELECT value FROM json_each(?)))=?`;
  const bindings = [
    phrase,
    input.featured ? 1 : 0,
    JSON.stringify(input.tags),
    input.tags.length,
  ];
  const total = (await ctx.db
    .prepare(`SELECT COUNT(*) AS total ${source}`)
    .bind(...bindings)
    .first<{ total: number }>())!.total;
  const page = Math.min(
    forumPage(input.page),
    Math.max(1, Math.ceil(total / FORUM_SEARCH_PAGE_SIZE)),
  );
  const rows = await ctx.db
    .prepare(
      `SELECT d.post_id,d.comment_id,
    COALESCE(p.topic_id,parent.topic_id) AS topic_id,COALESCE(p.post_number,parent.post_number) AS post_number,
    t.title,substr(COALESCE(p.body,c.body),1,180) AS snippet,COALESCE(p.created_at,c.created_at) AS created_at,
    u.id AS user_id,u.display_name,u.status AS user_status,u.avatar_blob_sha256
    ${source} ORDER BY f.rowid DESC LIMIT ? OFFSET ?`,
    )
    .bind(
      ...bindings,
      FORUM_SEARCH_PAGE_SIZE,
      (page - 1) * FORUM_SEARCH_PAGE_SIZE,
    )
    .all<{
      post_id: number | null;
      comment_id: number | null;
      topic_id: number;
      post_number: number;
      title: string;
      snippet: string;
      created_at: string;
      user_id: number;
      display_name: string;
      user_status: string;
      avatar_blob_sha256: string | null;
    }>();
  return {
    items: rows.results.map((r) => ({
      id: r.post_id ?? r.comment_id!,
      kind: r.post_id ? "post" : "comment",
      topicId: r.topic_id,
      title: r.title,
      snippet: r.snippet,
      createdAt: r.created_at,
      author: author(
        r.user_id,
        r.display_name,
        r.avatar_blob_sha256,
        r.user_status,
      ),
      href: r.post_id
        ? `/discussions/${r.topic_id}/posts/${r.post_number}`
        : `/discussions/${r.topic_id}/comments/${r.comment_id}`,
    })),
    total,
    page,
    pageSize: FORUM_SEARCH_PAGE_SIZE,
  };
}

export async function publicTopicList(
  ctx: ForumRuntime,
  input: { tags: number[]; featured: boolean; page: number },
) {
  if (input.tags.length > 5) throw new HttpError(400, "最多选择 5 个 TAG。");
  const sort = input.featured ? "featured_at" : "last_activity_at";
  const source = `FROM forum_public_topics t WHERE
    ${input.featured ? "t.featured_at IS NOT NULL" : "1"}
    AND (SELECT COUNT(*) FROM forum_topic_tags x JOIN forum_tags g ON g.id=x.tag_id WHERE x.topic_id=t.id AND g.status<>'hidden' AND x.tag_id IN(SELECT value FROM json_each(?)))=?`;
  const bindings = [JSON.stringify(input.tags), input.tags.length];
  const total = (await ctx.db
    .prepare(`SELECT COUNT(*) AS total ${source}`)
    .bind(...bindings)
    .first<{ total: number }>())!.total;
  const page = Math.min(
    forumPage(input.page),
    Math.max(1, Math.ceil(total / FORUM_PAGE_SIZE)),
  );
  const rows = await ctx.db
    .prepare(
      `SELECT t.id ${source} ORDER BY t.${sort} DESC,t.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, FORUM_PAGE_SIZE, (page - 1) * FORUM_PAGE_SIZE)
    .all<{ id: number }>();
  const ids = rows.results.map((r) => r.id);
  const { topicSql } = await import("./queries");
  const topics = ids.length
    ? await ctx.db
        .prepare(
          `${topicSql} WHERE t.id IN(SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM forum_public_topics visible WHERE visible.id=t.id) ORDER BY t.${sort} DESC,t.id DESC`,
        )
        .bind(JSON.stringify(ids))
        .all<import("./queries").TopicRow>()
    : { results: [] };
  const tags = await topicTags(ctx, ids);
  return {
    items: topics.results.map((r) =>
      publicTopicDto(mapTopic(r, null, tags.get(r.id) ?? [])),
    ),
    total,
    page,
    pageSize: FORUM_PAGE_SIZE,
  };
}

export async function publicTagList(
  ctx: ForumRuntime,
  query: string,
  after: string | null,
  selectable: boolean,
) {
  if (query.length > 64) throw new HttpError(400, "TAG 搜索词过长。");
  const rows = await ctx.db
    .prepare(
      `SELECT id,name,status AS state,revision,0 AS count FROM forum_tags WHERE status ${selectable ? "='active'" : "<>'hidden'"}
    AND id>? AND instr(name_key,?)>0 ORDER BY id LIMIT 101`,
    )
    .bind(
      after ? cursorId(after) : 0,
      query.normalize("NFKC").toLowerCase().trim(),
    )
    .all<import("@/lib/forum").ForumTag>();
  const tags = rows.results.slice(0, 100);
  return {
    tags,
    nextCursor: rows.results.length > 100 ? String(tags.at(-1)!.id) : null,
  };
}
