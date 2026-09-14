import { requireUser } from "@/lib/server/auth/guards";
import { markInboxItemRead } from "@/lib/server/db/inbox";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    itemId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser(request);

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { itemId: rawItemId } = await context.params;
    let target;
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = await readJsonObject(request,"提醒目标无效。");
      target = {
        topicId:parsePositiveId(String(body.topicId)),
        postNumber:parsePositiveId(String(body.postNumber)),
        commentId:body.commentId == null ? null : parsePositiveId(String(body.commentId)),
      };
    }

    await markInboxItemRead({
      user: auth.user,
      itemId: parsePositiveId(rawItemId,"inbox item id"),
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
