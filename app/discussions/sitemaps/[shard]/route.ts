import { forumSitemap } from "@/lib/server/forum/sitemap";
import { getForumRequestRuntime } from "@/lib/server/forum/next";
import { jsonError } from "@/lib/server/http/json";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ shard: string }> }) {
  try {
    const { shard } = await params;
    if (!/^\d+\.xml$/.test(shard)) return new Response(null, { status: 404 });
    return await forumSitemap(getForumRequestRuntime(), Number(shard.slice(0, -4)));
  } catch (error) { return jsonError("站点地图读取失败。", error); }
}
