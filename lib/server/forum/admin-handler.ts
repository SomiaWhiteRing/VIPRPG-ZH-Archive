import { requireForumUser, readForumJson, type ForumRequestRuntime } from "./request";
import { jsonError, HttpError } from "@/lib/server/http/json";
import { forumPage } from "@/lib/forum";
import { forumTarget, moderateForum } from "@/lib/server/forum/mutations";
import {
  adminForumDetail,
  adminForumList,
  adminForumTags,
  manageForumTag,
} from "@/lib/server/forum/admin";
const permissions = [
  "forum.content.moderate_any",
  "forum.topic.feature_any",
  "forum.tag.manage",
] as const;
export async function GET(ctx: ForumRequestRuntime, request: Request) {
  try {
    const auth = await requireForumUser(ctx, request, permissions);
    const params = new URL(request.url).searchParams,
      op = params.get("op");
    const data =
      op === "detail"
        ? {
            detail: await adminForumDetail(ctx,
              auth.user,
              forumTarget({
                kind: params.get("kind"),
                id: Number(params.get("id")),
              }),
            ),
          }
        : op === "tags"
          ? {
              page: await adminForumTags(ctx, auth.user, {
                query: params.get("q") ?? "",
                state: params.get("state") ?? "",
                page: forumPage(params.get("page")),
              }),
            }
          : {
              page: await adminForumList(ctx, auth.user, {
                view: params.get("view") ?? "topics",
                query: params.get("q") ?? "",
                state: params.get("state") ?? "",
                page: forumPage(params.get("page")),
              }),
            };
    return Response.json(
      { ok: true, ...data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError("管理数据加载失败。", error);
  }
}
export async function POST(ctx: ForumRequestRuntime, request: Request) {
  try {
    const auth = await requireForumUser(ctx, request, permissions);
    const input = await readForumJson(request);
    if (input.op === "tag") await manageForumTag(ctx, auth.user, input);
    else if (input.op === "moderate") await moderateForum(ctx, auth.user, input);
    else throw new HttpError(400, "管理动作无效。");
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError("管理操作失败。", error);
  }
}
