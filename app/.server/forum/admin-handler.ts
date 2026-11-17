import { translate } from "@/lib/i18n/core";
import { type UiLocale } from "@/lib/i18n/locale";
import { json as jsonResponse, HttpError, jsonError } from "@/lib/http";
import {
  adminForumDetail,
  adminForumList,
  adminForumTags,
  manageForumTag,
} from "@/app/.server/forum/admin";
import { forumTarget, moderateForum } from "@/app/.server/forum/mutations";
import { forumPage } from "@/lib/forum";

import { type ForumRequestRuntime, readForumJson, requireForumUser } from "./request";

const permissions = [
  "forum.content.moderate_any",
  "forum.topic.feature_any",
  "forum.topic.sage_any",
  "forum.tag.manage",
] as const;
export async function GET(ctx: ForumRequestRuntime, request: Request, locale: UiLocale) {
  try {
    const auth = await requireForumUser(ctx, request, permissions, locale);
    const params = new URL(request.url).searchParams,
      op = params.get("op");
    const data =
      op === "detail"
        ? {
            detail: await adminForumDetail(
              ctx,
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
    return jsonResponse(
      { ok: true, ...data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(translate(locale, "admin.discussions.loadFailed"), error);
  }
}
export async function POST(ctx: ForumRequestRuntime, request: Request, locale: UiLocale) {
  try {
    const auth = await requireForumUser(ctx, request, permissions, locale);
    const input = await readForumJson(request, locale);
    if (input.op === "tag") await manageForumTag(ctx, auth.user, input, locale);
    else if (input.op === "moderate")
      await moderateForum(ctx, auth.user, input, locale);
    else throw new HttpError(400, translate(locale, "admin.discussions.invalidAction"));
    return jsonResponse(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(translate(locale, "admin.discussions.operationFailed"), error);
  }
}
