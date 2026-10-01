import { Hono } from "hono";
import { HttpError, jsonError } from "@/lib/http";
import type { AppRuntime } from "./runtime";

type SitemapRuntime = Pick<AppRuntime, "db" | "origin"> & {
  execution: Pick<ExecutionContext, "waitUntil">;
};
const SHARD_SIZE = 1000;
const MAX_SITEMAPS = 50000;
const SHARD_ROUTE = "/:file{sitemap-[^/]+\\.xml}";
const sources = {
  games: "public_works",
  creators: "creators WHERE public_at IS NOT NULL",
  characters: "characters",
  catalogs: "catalogs WHERE status='published'",
  discussions: "forum_public_topics",
} as const;
type Section = keyof typeof sources;
const sections = Object.keys(sources) as Section[];
const pages = [
  "/", "/about", "/games", "/creators", "/characters", "/catalogs",
  "/discussions", "/rakuen", "/resources", "/tags",
];

export const sitemapApi = new Hono<{
  Bindings: CloudflareEnv;
  Variables: { runtime: AppRuntime };
}>();
sitemapApi.onError((error) => jsonError("站点地图读取失败。", error));
sitemapApi.on(["GET", "HEAD"], "/sitemap.xml", (c) =>
  sitemapIndex(c.get("runtime")),
);
sitemapApi.on(["GET", "HEAD"], "/sitemap-pages.xml", (c) => {
  const runtime = c.get("runtime");
  return cachedSitemap(runtime, "/sitemap-pages.xml", () =>
    urlset(pages.map((path) => ({ url: runtime.origin + path }))),
  );
});
sitemapApi.on(["GET", "HEAD"], SHARD_ROUTE, (c) => {
  const match = /^sitemap-([a-z]+)-(0|[1-9]\d*)\.xml$/.exec(c.req.param("file"));
  if (!match || !sections.includes(match[1] as Section)) {
    throw new HttpError(404, "站点地图不存在。");
  }
  return sitemapShard(c.get("runtime"), match[1] as Section, Number(match[2]));
});
for (const path of ["/sitemap.xml", "/sitemap-pages.xml", SHARD_ROUTE]) {
  sitemapApi.all(path, (c) => c.text("Method not allowed", 405, { Allow: "GET, HEAD" }));
}

export function sitemapIndex(ctx: SitemapRuntime, onlyDiscussions = false) {
  const selected = onlyDiscussions ? ["discussions" as const] : sections;
  const path = onlyDiscussions ? "/discussions/sitemap.xml" : "/sitemap.xml";
  return cachedSitemap(ctx, path, async () => {
    // List occupied public ID ranges, avoiding empty shards after hiding/deletion.
    const results = await ctx.db.batch<{ shard: number }>(selected.map((section) =>
      ctx.db.prepare(
        `SELECT DISTINCT CAST((id-1)/${SHARD_SIZE} AS INTEGER) AS shard
         FROM ${sources[section]} ORDER BY shard LIMIT ${MAX_SITEMAPS + 1}`,
      ),
    ));
    const paths = onlyDiscussions ? [] : ["/sitemap-pages.xml"];
    results.forEach((result, index) => {
      for (const row of result.results) paths.push(onlyDiscussions
        ? `/discussions/sitemaps/${row.shard}.xml`
        : shardPath(selected[index], row.shard));
    });
    if (paths.length > MAX_SITEMAPS) {
      throw new HttpError(503, "站点地图索引已达到协议上限。");
    }
    // An index references URL maps directly; sitemap indexes are never nested.
    return `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<sitemap><loc>${xmlEscape(ctx.origin + path)}</loc></sitemap>`).join("")}</sitemapindex>`;
  });
}

export function sitemapShard(ctx: SitemapRuntime, section: Section, shard: number, path = shardPath(section, shard)) {
  if (!Number.isSafeInteger(shard) || shard < 0 || !Number.isSafeInteger((shard + 1) * SHARD_SIZE)) {
    throw new HttpError(404, "站点地图不存在。");
  }
  return cachedSitemap(ctx, path, async () => {
    const source = sources[section];
    const condition = source.includes(" WHERE ") ? "AND" : "WHERE";
    const rows = await ctx.db.prepare(
      `SELECT id,updated_at FROM ${source} ${condition} id>? AND id<=? ORDER BY id LIMIT ${SHARD_SIZE}`,
    ).bind(shard * SHARD_SIZE, (shard + 1) * SHARD_SIZE)
      .all<{ id: number; updated_at: string }>();
    if (!rows.results.length) throw new HttpError(404, "站点地图不存在。");
    return urlset(rows.results.map((row) => ({
      url: `${ctx.origin}/${section}/${row.id}`,
      updatedAt: row.updated_at.slice(0, 10),
    })));
  });
}

function shardPath(section: Section, shard: number) {
  // Root-level maps cover every page even when discovered only through robots.txt.
  return `/sitemap-${section}-${shard}.xml`;
}

function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function urlset(rows: Array<{ url: string; updatedAt?: string }>) {
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.map((row) => `<url><loc>${xmlEscape(row.url)}</loc>${row.updatedAt ? `<lastmod>${xmlEscape(row.updatedAt)}</lastmod>` : ""}</url>`).join("")}</urlset>`;
}

async function cachedSitemap(ctx: SitemapRuntime, path: string, load: () => string | Promise<string>) {
  const cache = typeof caches === "undefined"
    ? undefined
    : (caches as CacheStorage & { default?: Cache }).default;
  const key = new Request(ctx.origin + path);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit;
  const response = new Response(`<?xml version="1.0" encoding="UTF-8"?>${await load()}`, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
  if (cache) ctx.execution.waitUntil(cache.put(key, response.clone()).catch(() => undefined));
  return response;
}
