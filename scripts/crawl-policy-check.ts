import assert from "node:assert/strict";
import { crawlerResponse, gameListCanonicalPath, publicRobots } from "../lib/crawl-policy";

const origin = "https://archive.example.test";
function request(path: string, category?: string, method = "GET") {
  const value = new Request(origin + path, { method, headers: { "User-Agent": "Googlebot", "cf-verified-bot-category": "AI Crawler" } });
  if (category) Object.defineProperty(value, "cf", { value: { verifiedBotCategory: category } });
  return value;
}
for (const path of ["/api/archive-versions/1/download?profile=web-play-v2", "/api/archive-versions/1/kai-import",
  "/games?engine=rpg_maker_2000&sort=title", "/games.data?duration=short&_routes=games", "/games?unknown=1"]) {
  assert.equal(crawlerResponse(request(path)), null, "headers cannot impersonate Cloudflare's verified category");
  assert.equal(crawlerResponse(request(path, "Monitoring & Analytics")), null);
  for (const category of ["Search Engine Crawler", "AI Crawler", "AI Search", "Archiver"]) {
    assert.equal(crawlerResponse(request(path, category))?.status, 403);
    assert.equal(await crawlerResponse(request(path, category, "HEAD"))?.text(), "");
  }
}
for (const path of ["/games", "/games?page=2", "/games.data?page=2&_routes=games", "/games/1", "/sitemap.xml", "/api/media/blobs/example"])
  assert.equal(crawlerResponse(request(path, "Search Engine Crawler")), null, "content discovery and images stay available");
const canonical = crawlerResponse(request("/games?page=01&sort=id&engine=all", "Search Engine Crawler"));
assert.equal(canonical?.status, 308);
assert.equal(canonical?.headers.get("Location"), "/games");
assert.equal(gameListCanonicalPath(new URLSearchParams("page=2")), "/games?page=2");
const robots = publicRobots(origin);
assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
assert.ok(!robots.includes("Disallow: /api/\n"), "do not block media discovery");
console.log("Crawl policy contracts passed: platform identity, early rejection, human access, pagination, canonical and media boundaries.");
