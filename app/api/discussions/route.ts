import { getCurrentUserFromRequest } from "@/lib/server/auth/current-user";
import { requireUser } from "@/lib/server/auth/guards";
import { assertSameOrigin, SameOriginError } from "@/lib/server/auth/origin";
import { readJsonObject, parsePositiveId } from "@/lib/server/http/request";
import { jsonError, HttpError } from "@/lib/server/http/json";
import { forumPage, type ForumEditVersion } from "@/lib/forum";
import { getD1 } from "@/lib/server/db/d1";
import {
  contentImages,
  forumComments,
  forumDetail,
  forumViewer,
  listForumTags,
  locateForumContent,
  rawContent,
  publicTopic,
  unavailable,
} from "@/lib/server/forum/queries";
import {
  publishForum,
  editForum,
  deleteForum,
  likeForum,
  reportForum,
  moderateForum,
  forumTarget,
} from "@/lib/server/forum/mutations";
export const dynamic = "force-dynamic";
function result(data: unknown) {
  return Response.json(
    { ok: true, ...(data as object) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams,
      op = params.get("op"),
      viewer = forumViewer(await getCurrentUserFromRequest(request));
    if (op === "tags")
      return result({
        tags: await listForumTags(
          params.get("q") ?? "",
          params.get("mode") === "suggest" ? "suggest" : "filter",
        ),
      });
    if (op === "comments")
      return result({
        comments: await forumComments(
          parsePositiveId(params.get("postId") ?? ""),
          forumPage(params.get("page")),
          viewer,
        ),
      });
    if (op === "detail")
      return result({
        detail: await forumDetail(
          parsePositiveId(params.get("topicId") ?? ""),
          {
            page: forumPage(params.get("page")),
            floor: params.has("floor")
              ? parsePositiveId(params.get("floor")!)
              : undefined,
            commentPage: forumPage(params.get("commentPage")),
            comment: params.has("comment")
              ? parsePositiveId(params.get("comment")!)
              : undefined,
          },
          viewer,
        ),
      });
    if (op === "edit") {
      if (!viewer) throw new HttpError(401, "请重新登录。");
      const target = forumTarget({
        kind: params.get("kind"),
        id: Number(params.get("id")),
      });
      const row = await rawContent(target),
        topic = await publicTopic(row.topic_id, viewer);
      if (!row.public || row.user_id !== viewer.id) unavailable();
      if (topic.locked) throw new HttpError(409, "主题已锁定。");
      return result({
        body: row.body,
        images: contentImages(row),
        revision: row.revision,
        topic,
      } satisfies ForumEditVersion);
    }
    throw new HttpError(400, "查询无效。");
  } catch (error) {
    return jsonError("讨论加载失败。", error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = await readJsonObject(request, "请求无效。");
    if (input.op === "view") {
      const topicId = Number(input.topicId);
      if (!Number.isSafeInteger(topicId) || topicId < 1) unavailable();
      await getD1()
        .prepare(
          "UPDATE forum_topics SET view_count=view_count+1 WHERE id=? AND id IN(SELECT id FROM forum_public_topics)",
        )
        .bind(topicId)
        .run();
      return result({});
    }
    const auth = await requireUser(request);
    if ("response" in auth) return auth.response;
    if (input.op === "publish" || input.op === "edit") {
      const saved =
        input.op === "publish"
          ? await publishForum(auth.user, input)
          : await editForum(auth.user, input);
      const row = await rawContent(saved.target);
      const location = await locateForumContent(
        row.topic_id,
        saved.target.kind === "comment"
          ? { commentId: row.id }
          : { postNumber: row.post_number },
        forumViewer(auth.user),
      );
      return result({
        target: saved.target,
        ...location,
        topicId: row.topic_id,
      });
    }
    if (input.op === "delete") {
      await deleteForum(auth.user, input);
      return result({});
    }
    if (input.op === "like") return result(await likeForum(auth.user, input));
    if (input.op === "report")
      return result(await reportForum(auth.user, input));
    if (input.op === "moderate") {
      await moderateForum(auth.user, input);
      return result({});
    }
    throw new HttpError(400, "操作无效。");
  } catch (error) {
    return jsonError(
      "讨论操作失败。",
      error instanceof SameOriginError
        ? new HttpError(403, error.message)
        : error,
    );
  }
}
