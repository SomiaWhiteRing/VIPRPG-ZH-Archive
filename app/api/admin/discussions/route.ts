import { requireAnyPermission } from "@/lib/server/auth/authorize";
import { jsonError, HttpError } from "@/lib/server/http/json";
import { readJsonObject } from "@/lib/server/http/request";
import { forumPage } from "@/lib/forum";
import { forumTarget, moderateForum } from "@/lib/server/forum/mutations";
import {
  adminForumDetail,
  adminForumList,
  adminForumTags,
  exportForum,
  manageForumTag,
} from "@/lib/server/forum/admin";
export const dynamic = "force-dynamic";
const permissions = [
  "forum.content.moderate_any",
  "forum.topic.feature_any",
  "forum.tag.manage",
] as const;
export async function GET(request: Request) {
  try {
    const auth = await requireAnyPermission(request, permissions);
    if ("response" in auth) return auth.response;
    const params = new URL(request.url).searchParams,
      op = params.get("op");
    if (op === "export")
      return Response.json(await exportForum(auth.user), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": "attachment; filename=discussions.json",
        },
      });
    const data =
      op === "detail"
        ? {
            detail: await adminForumDetail(
              auth.user,
              forumTarget({
                kind: params.get("kind"),
                id: Number(params.get("id")),
              }),
            ),
          }
        : op === "tags"
          ? {
              page: await adminForumTags(auth.user, {
                query: params.get("q") ?? "",
                state: params.get("state") ?? "",
                page: forumPage(params.get("page")),
              }),
            }
          : {
              page: await adminForumList(auth.user, {
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
export async function POST(request: Request) {
  try {
    const auth = await requireAnyPermission(request, permissions);
    if ("response" in auth) return auth.response;
    const input = await readJsonObject(request, "请求无效。");
    if (input.op === "tag") await manageForumTag(auth.user, input);
    else if (input.op === "moderate") await moderateForum(auth.user, input);
    else throw new HttpError(400, "管理动作无效。");
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError("管理操作失败。", error);
  }
}
