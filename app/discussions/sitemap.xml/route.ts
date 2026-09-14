import { forumSitemap } from "@/lib/server/forum/sitemap";
import { getForumRequestRuntime } from "@/lib/server/forum/next";
import { jsonError } from "@/lib/server/http/json";
export const dynamic = "force-dynamic";
export async function GET() {
  try {

    return await forumSitemap(getForumRequestRuntime());
  } catch (error) { return jsonError("站点地图读取失败。", error); }
}
