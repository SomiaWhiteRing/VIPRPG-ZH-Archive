import { getForumRequestRuntime } from "@/app/.server/forum/context";
import { forumSitemap } from "@/app/.server/forum/sitemap";
import type { AppRuntime } from "@/app/.server/runtime";
import { jsonError } from "@/lib/http";
export async function GET(
  runtime: AppRuntime,
  _request: Request,
  { params }: { params: { shard: string } },
) {
  try {
    const { shard } = await params;
    if (!/^\d+\.xml$/.test(shard)) return new Response(null, { status: 404 });
    return await forumSitemap(
      getForumRequestRuntime(runtime),
      Number(shard.slice(0, -4)),
    );
  } catch (error) {
    return jsonError("站点地图读取失败。", error);
  }
}
