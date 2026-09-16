import * as handler from "@/app/.server/forum/cleanup-handler";
import { getForumRequestRuntime } from "@/app/.server/forum/context";
import type { AppRuntime } from "@/app/.server/runtime";
import { jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  try {
    return await handler.POST(getForumRequestRuntime(runtime), request);
  } catch (error) {
    return jsonError("论坛请求失败。", error);
  }
}
