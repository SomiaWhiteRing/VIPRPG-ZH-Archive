const sourceOrigin = "https://viprpg.org";
const relayOrigin = "https://download.viprpg.org";
const downloadPath = /^\/api\/archive-versions\/[1-9]\d*\/download\/?$/;
const expose = "Content-Length, Content-Range, Content-Disposition, ETag, Accept-Ranges, X-Archive-Download-Alternate, X-Archive-Download-Relay, X-Download-Cache, X-Download-Cache-Tier";

function cors(headers) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Expose-Headers", [headers.get("Access-Control-Expose-Headers"), expose].filter(Boolean).join(", "));
  headers.set("X-Archive-Download-Relay", "viprpg-download-v1");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return headers;
}

function unavailable(request, url) {
  // Fetch clients retry the original source themselves, avoiding a cross-origin
  // redirect chain. Native browser downloads can return to the original URL.
  if (request.headers.has("Origin") || ["cors", "same-origin"].includes(request.headers.get("Sec-Fetch-Mode"))) {
    return new Response(null, { status: 502, headers: cors(new Headers({ "Cache-Control": "no-store" })) });
  }
  url.searchParams.set("download_source", "origin");
  return new Response(null, { status: 307, headers: cors(new Headers({ Location: url.href, "Cache-Control": "no-store" })) });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.origin !== relayOrigin) return new Response(null, { status: 404 });
    if (!downloadPath.test(incoming.pathname)) return new Response(null, { status: 404, headers: cors(new Headers({ "Cache-Control": "no-store" })) });
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(new Headers({
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, If-Range",
        "Access-Control-Max-Age": "600",
        "Cache-Control": "no-store",
      })) });
    }
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: cors(new Headers({ Allow: "GET, HEAD, OPTIONS" })) });
    const source = new URL(`${incoming.pathname}${incoming.search}`, sourceOrigin);
    source.searchParams.delete("download_source");
    const headers = new Headers({ "X-Viprpg-Download-Origin": "1", "Accept-Encoding": "identity" });
    for (const name of ["Range", "If-Range", "If-None-Match", "If-Modified-Since"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    try {
      // The service binding stays on Cloudflare's internal network. Only public
      // download URLs are reachable, and user cookies/credentials never cross.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      let response;
      try {
        response = await env.ARCHIVE_SOURCE.fetch(new Request(source, {
          method: request.method, headers, redirect: "manual", signal: AbortSignal.any([request.signal, controller.signal]),
        }));
      } finally {
        // Bound only response-header waiting; large bodies can take longer.
        clearTimeout(timer);
      }
      // Pin floating shared-player selections while retaining the relay ingress.
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("Location");
        const pinned = location ? new URL(location, source) : null;
        await response.body?.cancel();
        if (!pinned || pinned.origin !== sourceOrigin || pinned.pathname !== source.pathname) return unavailable(request, source);
        pinned.hostname = "download.viprpg.org";
        pinned.searchParams.delete("download_source");
        return new Response(null, { status: 307, headers: cors(new Headers({ Location: pinned.href, "Cache-Control": "no-store" })) });
      }
      if (response.status >= 500) {
        await response.body?.cancel();
        return unavailable(request, source);
      }
      const output = cors(new Headers(response.headers));
      output.delete("Set-Cookie");
      // Publication is checked by the source on every request, including cache
      // hits. Do not introduce an independent cache that can outlive that check.
      output.set("Cache-Control", "no-store, no-transform");
      response = new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers: output });
      return response;
    } catch {
      return unavailable(request, source);
    }
  },
};
