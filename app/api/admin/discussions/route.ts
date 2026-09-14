import * as handler from "@/lib/server/forum/admin-handler";
import { getForumRequestRuntime } from "@/lib/server/forum/next";
import { jsonError } from "@/lib/server/http/json";

export async function GET(request: Request) {
  try { return await handler.GET(getForumRequestRuntime(), request); }
  catch (error) { return jsonError("论坛请求失败。", error); }
}

export async function POST(request: Request) {
  try { return await handler.POST(getForumRequestRuntime(), request); }
  catch (error) { return jsonError("论坛请求失败。", error); }
}
