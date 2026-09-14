import * as handler from "@/lib/server/forum/image-handler";
import { getForumRequestRuntime } from "@/lib/server/forum/next";
import { jsonError } from "@/lib/server/http/json";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return await handler.GET(getForumRequestRuntime(), request, context); }
  catch (error) { return jsonError("论坛请求失败。", error); }
}
