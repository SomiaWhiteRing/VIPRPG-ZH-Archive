function acceptsBrotli(request: Request): boolean {
  const advertised = request.cf?.clientAcceptEncoding;
  const value = typeof advertised === "string" ? advertised : request.headers.get("Accept-Encoding") ?? "";
  const encodings = value.toLowerCase().split(",").map((entry) => entry.trim().split(";").map((part) => part.trim()));
  const selected = encodings.find(([name]) => name === "br") ?? encodings.find(([name]) => name === "*");
  if (!selected) return false;
  const quality = selected.slice(1).find((part) => part.startsWith("q="));
  const weight = quality === undefined ? 1 : Number(quality.slice(2));
  return weight > 0 && weight <= 1;
}

/** Keep public runtime URLs while serving verified, precompressed representations. */
export async function maybeHandleEasyRpgAsset(
  request: Request,
  assets: CloudflareEnv["ASSETS"],
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/play\/runtime\/easyrpg\/[a-z0-9][a-z0-9.-]*\/easyrpg-player(?:-asyncify)?\.(wasm|data)$/.exec(url.pathname);
  if (!match || !["GET", "HEAD"].includes(request.method)) return null;
  const compressed = !request.headers.has("Range") && acceptsBrotli(request);
  if (compressed) url.pathname += ".br";
  const assetRequest = new Request(url, request);
  // The representation is already encoded on disk; never encode it a second time.
  assetRequest.headers.set("Accept-Encoding", "identity");
  const response = await assets.fetch(assetRequest);
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Timing-Allow-Origin", "*");
  const vary = headers.get("Vary");
  if (!vary?.split(",").some((value) => value.trim().toLowerCase() === "accept-encoding"))
    headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
  if (compressed && (response.status === 200 || response.status === 304)) {
    headers.set("Content-Type", match[1] === "wasm" ? "application/wasm" : "application/octet-stream");
    headers.set("Content-Encoding", "br");
    headers.set("Cache-Control", "public,max-age=31536000,immutable,no-transform");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    encodeBody: "manual",
  });
}
