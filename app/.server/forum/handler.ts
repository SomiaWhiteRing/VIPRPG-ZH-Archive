import type { AppRuntime } from "@/app/.server/runtime";
import { forumPage } from "@/lib/forum";
import { HttpError, jsonError } from "@/lib/http";
import { loadRequestSession } from "../auth/request-auth";
import { parsePositiveId } from "../http/request";
import { getForumRequestRuntime } from "./context";
import { forumDetail, forumEmojis } from "./detail";
import { forumLocation } from "./location";
import {
  deleteForum,
  editForum,
  forumTarget,
  likeForum,
  moderateForum,
  publishForum,
  reportForum,
} from "./mutations";
import {
  indexedForumSearch,
  publicCommentPage,
  publicTagList,
  publicTopicList,
} from "./public-queries";
import {
  contentImages,
  forumViewer,
  publicTopic,
  rawContent,
  unavailable,
} from "./queries";
import type { ForumRequestRuntime } from "./request";
import { assertForumOrigin, readForumJson, requireForumUser } from "./request";

function result(data: object) {
  return Response.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function read(ctx: ForumRequestRuntime, request: Request) {
  const p = new URL(request.url).searchParams;
  const id = (key: string) => parsePositiveId(p.get(key) ?? "");
  const tags = p.getAll("tag").map((v) => parsePositiveId(v));
  switch (p.get("op")) {
    case "detail": {
      const detail = await forumDetail(
        ctx,
        id("topicId"),
        {
          page: forumPage(p.get("page")),
          floor: p.has("floor") ? id("floor") : undefined,
          commentPage: forumPage(p.get("commentPage")),
          comment: p.has("comment") ? id("comment") : undefined,
        },
        (await loadRequestSession(ctx.db, request.headers.get("cookie")))
          ?.user ?? null,
      );
      return result({
        detail,
        emojis: await forumEmojis(
          ctx,
          detail.posts.items.flatMap((post) => [
            post.body,
            ...post.comments.items.map((comment) => comment.body),
            ...post.commentPreview.map((comment) => comment.body),
          ]),
        ),
      });
    }
    case "list":
      return result(
        await publicTopicList(ctx, {
          tags,
          featured: p.get("featured") === "1",
          page: forumPage(p.get("page")),
        }),
      );
    case "search":
      return result(
        await indexedForumSearch(ctx, {
          tags,
          featured: p.get("featured") === "1",
          page: forumPage(p.get("page")),
          query: p.get("q") ?? "",
        }),
      );
    case "emojis": {
      const codes = p.getAll("shortcode");
      if (
        codes.length > 100 ||
        codes.some((code) => !/^[A-Za-z0-9_+-]{1,64}$/.test(code))
      )
        throw new HttpError(400, "表情集合无效。");
      const rows = await ctx.db
        .prepare(
          `SELECT id,shortcode,name,category,('/api/media/blobs/'||image_blob_sha256) AS imageUrl,
        visible_in_picker AS visibleInPicker,status FROM custom_emojis WHERE status IN('active','retired')
        ${codes.length ? "AND shortcode IN(SELECT value FROM json_each(?))" : ""} ORDER BY shortcode`,
        )
        .bind(...(codes.length ? [JSON.stringify(codes)] : []))
        .all();
      return result({ emojis: rows.results });
    }
    case "comments":
      return result({
        comments: await publicCommentPage(
          ctx,
          id("postId"),
          forumPage(p.get("page")),
        ),
      });
    case "tags":
      return result(
        await publicTagList(
          ctx,
          p.get("q") ?? "",
          p.get("cursor"),
          p.get("mode") === "suggest",
        ),
      );
    case "edit": {
      const auth = await requireForumUser(ctx, request);
      const target = forumTarget({ kind: p.get("kind"), id: id("id") });
      const row = await rawContent(ctx, target);
      const topic = await publicTopic(
        ctx,
        row.topic_id,
        forumViewer(auth.user),
      );
      if (!row.public || row.user_id !== auth.user.id) unavailable();
      if (topic.locked) throw new HttpError(409, "主题已锁定。");
      return result({
        body: row.body,
        images: contentImages(row),
        revision: row.revision,
        topic,
      });
    }
    default:
      throw new HttpError(400, "查询无效。");
  }
}

async function write(ctx: ForumRequestRuntime, request: Request) {
  assertForumOrigin(ctx, request);
  const input = await readForumJson(request);
  if (input.op === "view") {
    const topicId = parsePositiveId(String(input.topicId));
    await ctx.db
      .prepare(
        `UPDATE forum_topics SET view_count=view_count+1 WHERE id=? AND EXISTS(SELECT 1 FROM forum_public_topics t WHERE t.id=forum_topics.id)`,
      )
      .bind(topicId)
      .run();
    return result({});
  }
  const { user } = await requireForumUser(ctx, request);
  if (input.op === "publish" || input.op === "edit") {
    const saved =
      input.op === "publish"
        ? await publishForum(ctx, user, input)
        : await editForum(ctx, user, input);
    const row =
      saved.target.kind === "comment"
        ? await ctx.db
            .prepare(
              "SELECT p.topic_id,p.post_number FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id WHERE c.id=?",
            )
            .bind(saved.target.id)
            .first<{ topic_id: number; post_number: number }>()
        : await ctx.db
            .prepare(
              `SELECT topic_id,post_number FROM forum_posts WHERE ${saved.target.kind === "topic" ? "topic_id=? AND post_number=1" : "id=?"}`,
            )
            .bind(saved.target.id)
            .first<{ topic_id: number; post_number: number }>();
    if (!row) unavailable();
    return result(
      await forumLocation(
        ctx,
        row.topic_id,
        saved.target.kind === "comment"
          ? { commentId: saved.target.id }
          : { postNumber: row.post_number },
      ),
    );
  }
  if (input.op === "delete") {
    await deleteForum(ctx, user, input);
    return result({});
  }
  if (input.op === "like") return result(await likeForum(ctx, user, input));
  if (input.op === "report") return result(await reportForum(ctx, user, input));
  if (input.op === "moderate") {
    await moderateForum(ctx, user, input);
    return result({});
  }
  throw new HttpError(400, "操作无效。");
}

export async function GET(runtime: AppRuntime, request: Request) {
  try {
    return await read(getForumRequestRuntime(runtime), request);
  } catch (error) {
    return jsonError("论坛请求失败。", error);
  }
}

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    return await write(getForumRequestRuntime(runtime), request);
  } catch (error) {
    return jsonError("论坛请求失败。", error);
  }
}
