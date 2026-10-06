// Cloudflare supplies this field; never infer verified status from User-Agent.
const bulkCrawlerCategories = new Set([
  "Search Engine Crawler", "AI Crawler", "AI Search", "Archiver",
]);
const gameFilterParams = [
  "engine", "duration", "genre", "language", "original", "uploader",
  "character", "release", "tag", "tag_source", "sort", "order",
];

export function isFilteredGameList(params: URLSearchParams): boolean {
  return [...params].some(([key, value]) => {
    if (key === "page" || key === "_routes") return false;
    if (key === "engine" && value === "all") return false;
    if (key === "sort" && value === "id") return false;
    return Boolean(value) || !gameFilterParams.includes(key);
  });
}

export function gameListCanonicalPath(params: URLSearchParams): string {
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  return page > 1 ? `/games?page=${page}` : "/games";
}

export function crawlerResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const cf = (request as Request & { cf?: { verifiedBotCategory?: string } }).cf;
  if (!bulkCrawlerCategories.has(cf?.verifiedBotCategory ?? "")) return null;
  const url = new URL(request.url);
  const games = /^\/games(?:\.data)?\/?$/.test(url.pathname);
  if (/^\/api\/archive-versions\/\d+\/(?:download|kai-import)\/?$/.test(url.pathname) ||
      (games && isFilteredGameList(url.searchParams))) {
    return new Response(request.method === "HEAD" ? null : "This endpoint is not available for automated crawling.", {
      status: 403,
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  if (games && !url.pathname.endsWith(".data")) {
    const canonical = gameListCanonicalPath(url.searchParams);
    if (url.pathname + url.search !== canonical) return new Response(null, {
      status: 308, headers: { Location: canonical, "Cache-Control": "private, no-store" },
    });
  }
  return null;
}

export function publicRobots(origin: string): string {
  return ["User-agent: *", "Allow: /",
    "Disallow: /api/archive-versions/*/download", "Disallow: /api/archive-versions/*/kai-import",
    ...["/games", "/games.data"].flatMap((path) =>
      gameFilterParams.map((key) => `Disallow: ${path}?*${key}=`)),
    "", `Sitemap: ${origin}/sitemap.xml`, "",
  ].join("\n");
}
