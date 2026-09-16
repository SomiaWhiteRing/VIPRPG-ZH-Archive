import { getForumRequestRuntime } from "@/app/.server/forum/context";
import { forumSitemap } from "@/app/.server/forum/sitemap";
import type { AppRuntime } from "@/app/.server/runtime";
import { jsonError } from "@/lib/http";
export async function GET(runtime: AppRuntime) {
  try {
    return await forumSitemap(getForumRequestRuntime(runtime));
  } catch (error) {
    return jsonError("站点地图读取失败。", error);
  }
}
