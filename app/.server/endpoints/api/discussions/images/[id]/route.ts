import { getForumRequestRuntime } from "@/app/.server/forum/context";
import * as handler from "@/app/.server/forum/image-handler";
import type { AppRuntime } from "@/app/.server/runtime";
import { jsonError } from "@/lib/http";

export async function GET(
  runtime: AppRuntime,
  request: Request,
  context: { params: { id: string } },
) {
  try {
    return await handler.GET(getForumRequestRuntime(runtime), request, context);
  } catch (error) {
    return jsonError("论坛请求失败。", error);
  }
}
