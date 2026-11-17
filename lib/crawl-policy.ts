import { parseUiLocale, UI_LOCALE_PARAM } from "./i18n/locale";

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
    if (key === "page" || key === "_routes" || key === UI_LOCALE_PARAM) return false;
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
  // Deny the declared agent, including unverified or spoofed requests.
  const metaCrawler = /\bmeta-externalagent\b/i.test(request.headers.get("user-agent") ?? "");
  const cf = (request as Request & { cf?: { verifiedBotCategory?: string } }).cf;
  const bulkCrawler = (request.method === "GET" || request.method === "HEAD") &&
    bulkCrawlerCategories.has(cf?.verifiedBotCategory ?? "");
  const metaWebIndexer = request.method === "GET" && cf?.verifiedBotCategory === "Page Preview" &&
    /\bmeta-webindexer\b/i.test(request.headers.get("user-agent") ?? "");
  if (!metaCrawler && !bulkCrawler && !metaWebIndexer) return null;
  const url = new URL(request.url);
  const games = /^\/games(?:\.data)?\/?$/.test(url.pathname);
  if ((metaCrawler && url.pathname !== "/robots.txt") ||
      (bulkCrawler && /^\/api\/archive-versions\/\d+\/(?:download|kai-import)\/?$/.test(url.pathname)) ||
      (games && isFilteredGameList(url.searchParams))) {
    return new Response(request.method === "HEAD" ? null : "This endpoint is not available for automated crawling.", {
      status: 403,
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  if (bulkCrawler && games && !url.pathname.endsWith(".data")) {
    const destination = new URL(gameListCanonicalPath(url.searchParams), url.origin);
    const locale = parseUiLocale(url.searchParams.get(UI_LOCALE_PARAM));
    if (locale) destination.searchParams.set(UI_LOCALE_PARAM, locale);
    const canonical = destination.pathname + destination.search;
    if (url.pathname + url.search !== canonical) return new Response(null, {
      status: 308, headers: { Location: canonical, "Cache-Control": "private, no-store" },
    });
  }
  return null;
}

export function publicRobots(origin: string): string {
  return ["User-agent: meta-externalagent", "Disallow: /", "",
    "User-agent: *", "Allow: /",
    "Disallow: /api/archive-versions/*/download", "Disallow: /api/archive-versions/*/kai-import",
    ...["/games", "/games.data"].flatMap((path) =>
      gameFilterParams.map((key) => `Disallow: ${path}?*${key}=`)),
    "", `Sitemap: ${origin}/sitemap.xml`, "",
  ].join("\n");
}
