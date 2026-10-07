import { isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const apiOrigin = "https://api.globalping.io/v1";
const carrierAsns = [4134, 4837, 9808];
const reserve = 12;
const maxBodyBytes = 8192;
const pollDeadlineMs = 45000;
const countNames = ["zero", "one", "two"];

function splitPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\r\n#]/.test(value))
    throw new Error("Measurement path must be a same-host path without a fragment");
  const separator = value.indexOf("?");
  return separator < 0 ? { path: value } : { path: value.slice(0, separator), query: value.slice(separator + 1) };
}

function slot(probe) {
  return `${probe.country}:${probe.asn}:${String(probe.city).toLowerCase()}`;
}

function fingerprint(probe) {
  return JSON.stringify({
    country: probe.country, asn: probe.asn, city: probe.city, network: probe.network,
    latitude: probe.latitude, longitude: probe.longitude, tags: [...(probe.tags ?? [])].sort(),
  });
}

function validateLocations(locations) {
  if (!Array.isArray(locations) || ![3, 6].includes(locations.length)) throw new Error("Three carrier filters or three or six explicit mainland city locations are required");
  const carrierFilters = locations.every(location => location.city === undefined);
  const perCarrier = locations.reduce((sum, location) => sum + location.limit, 0) / 3;
  if (![1, 2].includes(perCarrier)) throw new Error("Request one or two probes per carrier");
  const slots = new Set();
  for (const location of locations) {
    if (location.country !== "CN" || !carrierAsns.includes(location.asn)
      || !Array.isArray(location.tags) || !location.tags.includes("eyeball-network")
      || (carrierFilters ? location.limit !== perCarrier
        : typeof location.city !== "string" || !location.city.trim() || location.limit !== 1))
      throw new Error("Locations must request balanced mainland eyeball probes per carrier, or one per explicit city");
    slots.add(carrierFilters ? location.asn : slot(location));
  }
  if (slots.size !== locations.length || carrierAsns.some(asn => locations.filter(location => location.asn === asn).length !== (carrierFilters ? 1 : perCarrier)))
    throw new Error("Each mainland carrier requires the same number of distinct cities");
  return locations.map(({ country, asn, city, limit }) => ({ country, asn, ...(city === undefined ? {} : { city }), tags: ["eyeball-network"], limit }));
}

function normalizeHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([name, header]) => [name.toLowerCase(), header]));
}

function numericTiming(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Coordinate Globalping's mainland probes; this machine's own egress is not a quality sample.
 * save(name, data) is an optional awaitable artifact writer; names have no file extension.
 * Anonymous requests cannot spend credits. Authenticated automatic credit consumption is disabled.
 */
export function createMeasurements(options) {
  const { hostname, expectedBody, path = "/robots.txt", budget = 96, save } = options;
  if (options.token !== undefined) throw new Error("Ingress measurements allow anonymous free API requests only; do not provide a token");
  if (typeof hostname !== "string" || !/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,63}$/i.test(hostname))
    throw new Error("A valid public TLS hostname is required");
  if (typeof expectedBody !== "string" || !expectedBody.length || [...expectedBody].some(char => char.charCodeAt(0) > 127) || Buffer.byteLength(expectedBody) > maxBodyBytes)
    throw new Error("The expected canary must contain 1 to 8192 ASCII bytes");
  if (!Number.isSafeInteger(budget) || budget < 6 || budget > 250) throw new Error("Probe budget must be an integer from 6 to 250");
  if (save !== undefined && typeof save !== "function") throw new Error("save must be an artifact-writer function");
  const canaryRequest = splitPath(path);
  const seeds = new Map();
  let selectedLocations;
  let firstId;
  let spent = 0;
  let sequence = 0;
  let measuring = false;

  async function record(name, data) {
    if (save) await save(name, data);
  }

  async function api(endpoint, { body, timeout = 12000 } = {}) {
    const response = await fetch(`${apiOrigin}${endpoint}`, {
      method: body ? "POST" : "GET", redirect: "error",
      headers: { "User-Agent": "VIPRPG-Ingress-Selection/1.0", "Accept-Encoding": "gzip", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1500);
      throw new Error(`Globalping ${body ? "POST" : "GET"} ${endpoint}: HTTP ${response.status} ${detail}`);
    }
    const creditHeader = response.headers.get("x-credits-consumed");
    if (creditHeader !== null && Number(creditHeader) !== 0) throw new Error("Unexpected Globalping credit consumption");
    return response.json();
  }

  async function remaining() {
    const data = await api("/limits");
    const quota = data?.rateLimit?.measurements?.create;
    if (quota?.type !== "ip" || !Number.isSafeInteger(quota.remaining) || quota.remaining < 0)
      throw new Error("Globalping did not report a valid anonymous free quota");
    return quota.remaining;
  }

  async function inventory(perCarrier = 2) {
    if (![1, 2].includes(perCarrier)) throw new Error("Request one or two probes per carrier");
    const data = await api("/probes");
    if (!Array.isArray(data)) throw new Error("Globalping probe inventory is malformed");
    const eligible = data.filter(probe => probe.location?.country === "CN"
      && carrierAsns.includes(probe.location.asn) && probe.tags?.includes("eyeball-network")
      && typeof probe.location.city === "string" && probe.location.city.trim());
    const locations = carrierAsns.map(asn => {
      const cities = new Set(eligible.filter(probe => probe.location.asn === asn).map(probe => probe.location.city.toLowerCase()));
      if (cities.size < perCarrier) throw new Error(`AS${asn} has fewer than ${countNames[perCarrier]} mainland eyeball probe cities; keep DNS unchanged`);
      // Public inventory omits IPv4 capability. The backend selects ready IPv4 probes
      // and diversifies locations; verify the actual two cities after the first test.
      return { country: "CN", asn, tags: ["eyeball-network"], limit: perCarrier };
    });
    selectedLocations = validateLocations(locations);
    await record(`probe-inventory-${perCarrier}`, { selectedLocations, eligible: eligible.map(probe => ({ ...probe.location, tags: probe.tags })) });
    return structuredClone(selectedLocations);
  }

  async function measure(target, { locations, range } = {}) {
    if (measuring) throw new Error("Mainland measurements must run serially");
    if (isIP(target) !== 4 && target !== hostname) throw new Error("Measurement target must be an IPv4 candidate or the configured hostname");
    measuring = true;
    const artifact = `measurement-${String(++sequence).padStart(3, "0")}`;
    try {
      locations ??= firstId ?? selectedLocations ?? await inventory();
      const seed = typeof locations === "string" ? seeds.get(locations) : { locations: validateLocations(locations) };
      if (!seed) throw new Error("Fixed probe ID must belong to this measurement cycle");
      const count = seed.locations.reduce((sum, location) => sum + location.limit, 0);
      const perCarrier = count / 3;
      let requestPath = canaryRequest;
      let expectedLength = Buffer.byteLength(expectedBody);
      const headers = { "Accept-Encoding": "identity" };
      if (range) {
        if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start
          || !Number.isSafeInteger(range.total) || range.total <= range.end || range.end - range.start + 1 > maxBodyBytes
          || typeof range.etag !== "string" || !/^"[^"\r\n]+"$/.test(range.etag))
          throw new Error("Range metadata must specify a strong ETag and at most 8192 bytes within the archive");
        requestPath = splitPath(range.path);
        expectedLength = range.end - range.start + 1;
        headers.Range = `bytes=${range.start}-${range.end}`;
        headers["If-Range"] = range.etag;
      }
      const request = {
        type: "http", target, timeout: 20, locations, ...(typeof locations === "string" ? { limit: count } : {}),
        measurementOptions: { protocol: "HTTP2", ...(isIP(target) ? {} : { ipVersion: 4 }), request: { method: "GET", host: hostname, ...requestPath, headers } },
      };
      await record(`${artifact}-request`, request);
      if (spent + count > budget) throw new Error("Local mainland probe budget exhausted; keep DNS unchanged");
      if (await remaining() < count + reserve) throw new Error("Anonymous Globalping quota below probe count plus reserve; keep DNS unchanged");
      // Reserve before POST: an interrupted response may already have created billable probe work.
      spent += count;
      const created = await api("/measurements", { body: request, timeout: 15000 });
      await record(`${artifact}-created`, created);
      if (typeof created.id !== "string" || !/^[a-z0-9_-]{4,100}$/i.test(created.id)) throw new Error("Globalping returned an invalid measurement ID");
      const deadline = Date.now() + pollDeadlineMs;
      let raw;
      while (Date.now() < deadline) {
        raw = await api(`/measurements/${created.id}`, { timeout: Math.min(10000, Math.max(1, deadline - Date.now())) });
        if (raw.status === "finished") break;
        if (raw.status !== "in-progress") throw new Error("Globalping returned an unknown measurement status");
        await delay(Math.min(1000, Math.max(0, deadline - Date.now())));
      }
      await record(`${artifact}-result`, raw ?? null);
      if (raw?.id !== created.id || raw.status !== "finished" || !Array.isArray(raw.results) || raw.results.length !== count)
        throw new Error("Mainland measurement did not finish with all required probes; keep DNS unchanged");
      const expectedSlots = seed.locations.every(location => location.city !== undefined) ? new Set(seed.locations.map(slot)) : null;
      const seen = new Set();
      const fingerprints = [];
      const rows = raw.results.map(({ probe, result }, index) => {
        if (!probe || !result || probe.country !== "CN" || !carrierAsns.includes(probe.asn) || typeof probe.city !== "string" || !probe.city.trim()
          || (expectedSlots && !expectedSlots.has(slot(probe))) || !probe.tags?.includes("eyeball-network"))
          throw new Error("Measurement probe coverage differs from the required mainland carrier cities");
        if (seen.has(slot(probe))) throw new Error("Measurement probe coverage has duplicate mainland carrier cities");
        seen.add(slot(probe));
        fingerprints.push(fingerprint(probe));
        if (seed.fingerprints && seed.fingerprints[index] !== fingerprints[index])
          throw new Error("Repeated measurement did not use the same probes in the same order");
        const responseHeaders = normalizeHeaders(result.headers);
        const totalMs = numericTiming(result.timings?.total);
        const dnsMs = numericTiming(result.timings?.dns) ?? 0;
        const contentLength = responseHeaders["content-length"];
        const commonValid = result.status === "finished" && result.tls?.authorized === true && !result.tls.error
          && result.truncated === false && totalMs !== null && (contentLength === undefined || contentLength === String(expectedLength))
          && (!responseHeaders["content-encoding"] || responseHeaders["content-encoding"] === "identity");
        // Globalping decodes binary bodies as UTF-8 and aborts above 10000 characters.
        // A Range sample validates completion/metadata, never binary SHA or sustained ZIP throughput.
        const valid = commonValid && (range
          ? result.statusCode === 206 && contentLength === String(expectedLength) && responseHeaders.etag === range.etag
            && responseHeaders["content-range"] === `bytes ${range.start}-${range.end}/${range.total}`
          : result.statusCode === 200 && result.rawBody === expectedBody && Buffer.byteLength(result.rawBody) === expectedLength);
        return {
          probeKey: slot(probe), country: probe.country, asn: probe.asn, city: probe.city,
          resolvedAddress: result.resolvedAddress ?? null,
          valid, totalMs, dnsMs, ingressMs: totalMs === null ? null : Math.max(0, totalMs - dnsMs),
          code: result.statusCode ?? null, status: result.status, headers: responseHeaders,
        };
      });
      if (carrierAsns.some(asn => rows.filter(row => row.asn === asn).length !== perCarrier))
        throw new Error(`Actual measurement requires ${countNames[perCarrier]} distinct cities per mainland carrier`);
      const actualLocations = raw.results.map(({ probe }) => ({ country: probe.country, asn: probe.asn, city: probe.city, tags: ["eyeball-network"], limit: 1 }));
      seeds.set(created.id, { locations: actualLocations, fingerprints });
      firstId ??= created.id;
      return { id: created.id, locations: created.id, rows, raw };
    } catch (error) {
      await record(`${artifact}-error`, { message: error.message, spent, budget });
      throw error;
    } finally {
      measuring = false;
    }
  }

  return { inventory, measure, remaining, used: () => spent };
}
