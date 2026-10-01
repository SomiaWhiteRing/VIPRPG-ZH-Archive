import { sitemapIndex, sitemapShard } from "../sitemap";
import type { ForumRequestRuntime } from "./request";

export function forumSitemap(ctx: ForumRequestRuntime, shard?: number) {
  return shard === undefined
    ? sitemapIndex(ctx, true)
    : sitemapShard(ctx, "discussions", shard, `/discussions/sitemaps/${shard}.xml`);
}
