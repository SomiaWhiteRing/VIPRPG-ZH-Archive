import { HttpError } from "@/lib/server/http/json";
import { locateForumContent } from "./queries";

export async function forumPermalink(
  topicId: string,
  kind: "post" | "comment",
  targetId: string,
) {
  try {
    if (
      ![topicId, targetId].every(
        (value) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)),
      )
    )
      throw new HttpError(404, "内容不可用");
    const found = await locateForumContent(
      Number(topicId),
      kind === "post"
        ? { postNumber: Number(targetId) }
        : { commentId: Number(targetId) },
      null,
    );
    return new Response(null, {
      status: 307,
      headers: {
        Location: found.href,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404)
      return new Response(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>内容不可用</title><main><h1>内容不可用</h1><a href="/discussions">返回讨论</a></main></html>',
        {
          status: 404,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    throw error;
  }
}
