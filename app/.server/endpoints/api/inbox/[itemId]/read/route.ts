import { requireUser } from "@/app/.server/auth/guards";
import { markInboxItemRead } from "@/app/.server/db/inbox";
import { redirectResponse } from "@/app/.server/http/form";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

type RouteContext = {
  params: {
    itemId: string;
  };
};

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requireUser(runtime, request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { itemId: rawItemId } = await context.params;
    let target;
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = await readJsonObject(request, "提醒目标无效。");
      target = {
        topicId: parsePositiveId(String(body.topicId)),
        postNumber: parsePositiveId(String(body.postNumber)),
        commentId:
          body.commentId == null
            ? null
            : parsePositiveId(String(body.commentId)),
      };
    }

    await markInboxItemRead(runtime, {
      user: auth.user,
      itemId: parsePositiveId(rawItemId, "inbox item id"),
      target,
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({ ok: true });
    }

    return redirectResponse(new URL("/inbox", request.url));
  } catch (error) {
    return jsonError("Inbox item read failed", error);
  }
}
