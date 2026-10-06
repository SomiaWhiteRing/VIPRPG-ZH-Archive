import { isIP } from "node:net";

const RANGE_URL = "https://www.cloudflare.com/ips-v4/";
const FEED_URL = "https://www.wetest.vip/api/cf2dns/get_cloudflare_ip";
const RIPE_URL = "https://stat.ripe.net/data/";
const BOOTSTRAP = ["172.64.155.209", "8.35.211.227", "8.39.125.89"];
const CARRIERS = ["CT", "CU", "CM", "CN"];
const ALLOWED_ASNS = new Set(["13335", "209242"]);
const NON_PUBLIC_RANGES = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24",
  "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15",
  "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/3",
];

function ipv4Number(ip) {
  if (typeof ip !== "string" || isIP(ip) !== 4) return null;
  return ip.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

export function inCidr(ip, cidr) {
  if (typeof cidr !== "string") return false;
  const parts = cidr.split("/");
  if (parts.length !== 2 || !/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(parts[1])) return false;
  const address = ipv4Number(ip), network = ipv4Number(parts[0]);
  if (address === null || network === null) return false;
  const block = 2 ** (32 - Number(parts[1]));
  return Math.floor(address / block) === Math.floor(network / block);
}

export function isPublicIpv4(ip) {
  return ipv4Number(ip) !== null && !NON_PUBLIC_RANGES.some((cidr) => inCidr(ip, cidr));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failureReason(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "request-timeout";
  // Do not expose URLs containing the public API key or arbitrary remote bodies.
  return ["http-error", "response-too-large", "invalid-json", "invalid-ranges", "invalid-feed", "invalid-network-info", "invalid-rpki"]
    .includes(error?.message) ? error.message : "request-failed";
}

async function readText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8_000), redirect: "error",
    headers: { "User-Agent": "VIPRPG-Ingress-Candidates/1", Accept: "application/json,text/plain" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("http-error");
  }
  const chunks = [], reader = response.body.getReader();
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 512 * 1024) throw new Error("response-too-large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(url) {
  const body = await readText(url);
  try { return JSON.parse(body); }
  catch { throw new Error("invalid-json"); }
}

function validRange(cidr) {
  if (typeof cidr !== "string") return false;
  const [network, prefix] = cidr.split("/");
  return isPublicIpv4(network) && Number(prefix) >= 8 && inCidr(network, cidr) &&
    ipv4Number(network) % (2 ** (32 - Number(prefix))) === 0;
}

async function validateAddress(ip, ranges, evidence) {
  if (ranges.some((cidr) => inCidr(ip, cidr))) {
    evidence.push({ ip, accepted: true, check: "cloudflare-published-range" });
    return true;
  }
  try {
    const networkUrl = `${RIPE_URL}network-info/data.json?${new URLSearchParams({ resource: ip })}`;
    const network = await readJson(networkUrl);
    const asns = network?.data?.asns;
    const prefix = network?.data?.prefix;
    if (network?.status !== "ok" || !Array.isArray(asns) || asns.length !== 1 ||
        !ALLOWED_ASNS.has(String(asns[0])) || !validRange(prefix) || !inCidr(ip, prefix))
      throw new Error("invalid-network-info");
    const asn = String(asns[0]);
    const rpkiUrl = `${RIPE_URL}rpki-validation/data.json?${new URLSearchParams({ resource: `AS${asn}`, prefix })}`;
    const response = await readJson(rpkiUrl);
    const rpki = response?.data;
    if (response?.status !== "ok" || String(rpki?.resource) !== asn || rpki?.prefix !== prefix ||
        !["valid", "invalid", "unknown"].includes(rpki?.status)) throw new Error("invalid-rpki");
    const accepted = rpki.status !== "invalid";
    evidence.push({ ip, accepted, check: "cloudflare-asn", asn, prefix, rpki: rpki.status,
      ...(rpki.status === "unknown" ? { note: "No validating ROA; not equivalent to RPKI valid." } : {}),
    });
    return accepted;
  } catch (error) {
    evidence.push({ ip, accepted: false, check: "cloudflare-asn", reason: failureReason(error) });
    return false;
  }
}

/** Return the optional current IPv4 baseline and at most `limit` independently validated candidates.
 * `save`, when supplied, is an async (filename, JSON-value) evidence writer.
 * This module only performs public reads when loadCandidates is called; it never writes DNS.
 */
export async function loadCandidates({ currentIp, limit = 3, save } = {}) {
  if (currentIp !== undefined && !isPublicIpv4(currentIp)) throw new Error("currentIp must be a public IPv4 address");
  if (!Number.isInteger(limit) || limit < 0 || limit > 3) throw new Error("limit must be between 0 and 3");
  if (save !== undefined && typeof save !== "function") throw new Error("save must be a function");
  const evidence = currentIp === undefined ? [] : [{ source: "current", ip: currentIp, retained: true }];
  const candidates = currentIp === undefined ? [] : [currentIp], seen = new Set(candidates);
  const baselineCount = candidates.length;
  const finish = async () => {
    const result = { candidates, evidence };
    if (save) await save("candidate-sources", result);
    return result;
  };
  let ranges = [];
  try {
    const live = (await readText(RANGE_URL)).trim().split(/\s+/);
    if (!live.length || live.length > 100 || live.some((cidr) => !validRange(cidr)))
      throw new Error("invalid-ranges");
    ranges = live;
    evidence.push({ source: RANGE_URL, status: "live", ranges });
  } catch (error) {
    evidence.push({ source: RANGE_URL, status: "failed", reason: failureReason(error) });
  }
  if (currentIp !== undefined) {
    const currentVerified = await validateAddress(currentIp, ranges, evidence);
    evidence.push({ source: "current", ip: currentIp, ownershipVerified: currentVerified });
    if (!currentVerified) return finish();
  }
  if (limit === 0) return finish();
  const append = async (ip, source) => {
    if (seen.has(ip) || candidates.length >= baselineCount + limit) return false;
    seen.add(ip);
    if (!await validateAddress(ip, ranges, evidence)) return false;
    candidates.push(ip);
    evidence.push({ source, ip, selected: true });
    return true;
  };
  const feedStart = candidates.length;
  try {
    const url = new URL(FEED_URL);
    url.search = new URLSearchParams({ key: "o1zrmHAF", type: "v4" }).toString();
    const feed = await readJson(url);
    if (feed?.status !== true || feed.code !== 200 || !isObject(feed.info) ||
        CARRIERS.some((line) => !Array.isArray(feed.info[line]) || feed.info[line].length > 100))
      throw new Error("invalid-feed");
    const now = Math.floor(Date.now() / 1000);
    evidence.push({ source: FEED_URL, status: "ok", counts: Object.fromEntries(CARRIERS.map((line) => [line, feed.info[line].length])) });
    for (const line of CARRIERS) {
      for (const entry of feed.info[line]) {
        const ip = entry?.ip;
        let reason;
        if (!isObject(entry) || entry.type !== "official") reason = "not-official";
        else if (!isPublicIpv4(ip)) reason = "not-public-ipv4";
        else if (!Number.isInteger(entry.updated_at) || entry.updated_at > now) reason = "invalid-or-future-timestamp";
        else if (now - entry.updated_at > 86_400) reason = "stale";
        if (reason) {
          evidence.push({ source: FEED_URL, line, rejected: true, ...(isPublicIpv4(ip) ? { ip } : {}), reason });
          continue;
        }
        if (await append(ip, `WeTest:${line}`)) break;
      }
    }
  } catch (error) {
    evidence.push({ source: FEED_URL, status: "failed", reason: failureReason(error) });
  }
  if (candidates.length === feedStart) {
    evidence.push({ source: "bootstrap", reason: "feed-supplied-no-new-validated-candidate" });
    for (const ip of BOOTSTRAP) await append(ip, "previously-tested-bootstrap");
  }
  return finish();
}
