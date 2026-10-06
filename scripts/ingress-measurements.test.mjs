import assert from "node:assert/strict";
import test from "node:test";
import { createMeasurements } from "./ingress-measurements.mjs";

const hostname = "viprpg.org";
const candidate = "8.35.211.227";
const expectedBody = "User-agent: *\nAllow: /\n";
const sampleLocations = [
  { country: "CN", asn: 4134, city: "Shanghai" },
  { country: "CN", asn: 4134, city: "Xi'an" },
  { country: "CN", asn: 4837, city: "Changsha" },
  { country: "CN", asn: 4837, city: "Wuhan" },
  { country: "CN", asn: 9808, city: "Guangzhou" },
  { country: "CN", asn: 9808, city: "Kunming" },
].map(location => ({ ...location, tags: ["eyeball-network"], limit: 1 }));
const range = { path: "/api/archive-versions/178/download?profile=web-play-v2&download_source=origin", etag: '"archive-178-test"', start: 0, end: 4095, total: 10000 };

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

// Entire API is replaced: a request to any unlisted endpoint fails locally.
function stubApi(t, { inventory, readyLocations = sampleLocations, remaining = 250, mutate, postError } = {}) {
  const calls = [];
  const posts = [];
  const measurements = new Map();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    assert.equal(new Headers(options.headers).get("authorization"), null);
    assert.equal(options.redirect, "error");
    const endpoint = new URL(url).pathname;
    if (endpoint === "/v1/probes") return response(inventory ?? sampleLocations.map(location => ({ location, tags: location.tags })));
    if (endpoint === "/v1/limits") return response({ rateLimit: { measurements: { create: { type: "ip", remaining } } } });
    if (endpoint === "/v1/measurements" && options.method === "POST") {
      const request = JSON.parse(options.body);
      posts.push(request);
      if (postError) throw postError;
      const id = `stub-${posts.length}`;
      const locations = typeof request.locations === "string" ? measurements.get(request.locations).locations
        : request.locations.flatMap(filter => readyLocations.filter(probe => probe.country === filter.country && probe.asn === filter.asn
          && (filter.city === undefined || filter.city === probe.city)).slice(0, filter.limit));
      measurements.set(id, { locations, request, index: posts.length });
      return response({ id, probesCount: locations.length });
    }
    const id = endpoint.slice("/v1/measurements/".length);
    if (endpoint.startsWith("/v1/measurements/") && measurements.has(id)) {
      const { locations, request, index } = measurements.get(id);
      const isRange = Boolean(request.measurementOptions.request.headers.Range);
      const raw = {
        id, status: "finished", results: locations.map(location => ({
          probe: { ...location, network: `AS${location.asn}`, latitude: 30, longitude: 110 },
          result: {
            status: "finished", statusCode: isRange ? 206 : 200, tls: { authorized: true }, truncated: false,
            timings: { dns: request.target === hostname ? 25 : 0, total: 150 }, resolvedAddress: candidate,
            // Binary response text is deliberately unusable for SHA verification.
            rawBody: isRange ? "\uFFFD".repeat(900) : expectedBody,
            headers: isRange
              ? { "Content-Length": "4096", "Content-Range": "bytes 0-4095/10000", ETag: range.etag }
              : { "Content-Length": String(Buffer.byteLength(expectedBody)) },
          },
        })),
      };
      if (mutate) mutate(raw, request, index);
      return response(raw);
    }
    throw new Error(`Unexpected stub endpoint ${endpoint}`);
  });
  return { calls, posts };
}

function client(options = {}) {
  return createMeasurements({ hostname, expectedBody, ...options });
}

test("inventory excludes overseas, datacenter and unrelated-AS probes and requires two cities per carrier", async t => {
  const entries = [...sampleLocations.map(location => ({ location, tags: location.tags }))].reverse();
  entries.push(entries[0]); // A duplicate probe does not provide a second city.
  entries.push({ location: { country: "HK", asn: 4134, city: "Hong Kong" }, tags: ["eyeball-network"] });
  entries.push({ location: { country: "CN", asn: 45090, city: "Guangzhou" }, tags: ["eyeball-network"] });
  entries.push({ location: { country: "CN", asn: 4134, city: "Beijing" }, tags: ["datacenter-network"] });
  stubApi(t, { inventory: entries });
  const selected = await client().inventory();
  assert.equal(selected.length, 3);
  for (const asn of [4134, 4837, 9808]) {
    const filters = selected.filter(location => location.asn === asn);
    assert.equal(filters.length, 1);
    assert.ok(filters.every(location => location.country === "CN" && location.limit === 2 && location.city === undefined && location.tags.includes("eyeball-network")));
  }
});

test("hidden IPv4 capability is handled by backend selection, then actual six city probes are pinned", async t => {
  const advertised = sampleLocations.map(location => ({ location, tags: location.tags }));
  for (const asn of [4134, 4837, 9808]) {
    // These lexically first inventory cities have no ready IPv4 probe. Public GET
    // does not disclose that, so choosing them before measurement loses coverage.
    advertised.push({ location: { country: "CN", asn, city: "AAAA IPv6-only" }, tags: ["eyeball-network"] });
    advertised.push({ location: { country: "CN", asn, city: "BBBB IPv6-only" }, tags: ["eyeball-network"] });
  }
  const { posts } = stubApi(t, { inventory: advertised });
  const measurements = client();
  const first = await measurements.measure(hostname);
  assert.equal(posts[0].locations.length, 3);
  assert.ok(posts[0].locations.every(location => location.city === undefined && location.limit === 2));
  assert.equal(posts[0].limit, undefined);
  assert.equal(first.rows.length, 6);
  assert.ok(first.rows.every(row => row.valid && !row.city.includes("IPv6-only")));
  const second = await measurements.measure(candidate, { locations: first.id });
  assert.equal(posts[1].locations, first.id);
  assert.equal(posts[1].limit, 6);
  assert.deepEqual(second.rows.map(row => row.probeKey), first.rows.map(row => row.probeKey));
  assert.equal(measurements.used(), 12);
});

test("backend selection must provide two different actual cities for each carrier", async t => {
  await t.test("same-city duplicates", async subtest => {
    stubApi(subtest, { mutate: raw => { raw.results[1].probe.city = raw.results[0].probe.city; } });
    await assert.rejects(client().measure(candidate), /coverage.*cities/);
  });
  await t.test("six samples with unbalanced carrier coverage", async subtest => {
    stubApi(subtest, { mutate: raw => { raw.results[2].probe.asn = 4134; } });
    await assert.rejects(client().measure(candidate), /two distinct cities per mainland carrier/);
  });
});

test("missing carrier coverage stops before any measurement", async t => {
  const inventory = sampleLocations.filter(location => location.city !== "Kunming").map(location => ({ location, tags: location.tags }));
  const { posts } = stubApi(t, { inventory });
  await assert.rejects(client().measure(candidate), /AS9808.*fewer than two/);
  assert.equal(posts.length, 0);
});

test("hostname/SNI and query remain separate while comparisons reuse the original six probes", async t => {
  const { posts } = stubApi(t);
  const saved = new Map();
  const measurements = client({ path: "/robots.txt?revision=2026&mode=canary", save: (name, data) => saved.set(name, data) });
  const first = await measurements.measure(hostname);
  const second = await measurements.measure(candidate, { locations: first.locations });
  assert.ok(first.rows.every(row => row.valid));
  assert.ok(second.rows.every(row => row.valid && row.resolvedAddress === candidate));
  assert.deepEqual(second.rows.map(row => row.probeKey), first.rows.map(row => row.probeKey));
  assert.equal(posts[0].measurementOptions.request.host, hostname);
  assert.equal(posts[0].measurementOptions.request.path, "/robots.txt");
  assert.equal(posts[0].measurementOptions.request.query, "revision=2026&mode=canary");
  assert.equal(posts[0].measurementOptions.ipVersion, 4);
  assert.equal(posts[1].measurementOptions.ipVersion, undefined); // Schema forbids ipVersion for an IP target.
  assert.equal(posts[1].locations, first.id);
  assert.equal(posts[1].limit, 6); // String-ID reuse otherwise defaults to one probe.
  assert.ok(posts[0].limit === undefined || posts[0].locations.every(location => location.limit === undefined));
  assert.equal(measurements.used(), 12);
  assert.ok(saved.has("measurement-001-result"));
});

test("untrusted or incomplete canary responses cannot qualify", async t => {
  const faults = {
    "same-length wrong body": result => { result.rawBody = "X".repeat(expectedBody.length); },
    "untrusted TLS": result => { result.tls.authorized = false; },
    "TLS authorization error": result => { result.tls.error = "HOSTNAME_MISMATCH"; },
    "truncated response": result => { result.truncated = true; },
    "redirect": result => { result.statusCode = 302; },
    "partial response with 200 headers": result => { result.status = "failed"; },
    "wrong declared length": result => { result.headers["Content-Length"] = "1"; },
  };
  for (const [name, fault] of Object.entries(faults)) await t.test(name, async subtest => {
    stubApi(subtest, { mutate: raw => fault(raw.results[0].result) });
    const result = await client().measure(candidate, { locations: sampleLocations });
    assert.equal(result.rows[0].valid, false);
    assert.ok(result.rows.slice(1).every(row => row.valid));
  });
});

test("Range validation checks completion and metadata without hashing lossy binary text", async t => {
  const faults = {
    "valid metadata with lossy binary text": () => {},
    "different ETag": result => { result.headers.ETag = '"different-version"'; },
    "full-body 200": result => { result.statusCode = 200; },
    "wrong byte interval": result => { result.headers["Content-Range"] = "bytes 4096-8191/10000"; },
    "wrong archive size": result => { result.headers["Content-Range"] = "bytes 0-4095/10001"; },
    "missing Content-Length": result => { delete result.headers["Content-Length"]; },
    "body truncated": result => { result.truncated = true; },
  };
  for (const [name, fault] of Object.entries(faults)) await t.test(name, async subtest => {
    const { posts } = stubApi(subtest, { mutate: raw => fault(raw.results[0].result) });
    const result = await client().measure(candidate, { locations: sampleLocations, range });
    assert.equal(result.rows[0].valid, name === "valid metadata with lossy binary text");
    const request = posts[0].measurementOptions.request;
    assert.equal(request.path, "/api/archive-versions/178/download");
    assert.equal(request.query, "profile=web-play-v2&download_source=origin");
    assert.equal(request.headers.Range, "bytes=0-4095");
    assert.equal(request.headers["If-Range"], range.etag);
  });
});

test("free-quota reserve and local budget prevent extra POSTs", async t => {
  await t.test("remote reserve", async subtest => {
    const { posts } = stubApi(subtest, { remaining: 17 });
    const measurements = client();
    await assert.rejects(measurements.measure(candidate, { locations: sampleLocations }), /quota.*reserve/);
    assert.equal(posts.length, 0);
    assert.equal(measurements.used(), 0);
  });
  await t.test("local budget", async subtest => {
    const { posts } = stubApi(subtest);
    const measurements = client({ budget: 6 });
    await measurements.measure(candidate, { locations: sampleLocations });
    await assert.rejects(measurements.measure(candidate), /budget exhausted/);
    assert.equal(posts.length, 1);
    assert.equal(measurements.used(), 6);
  });
});

test("an interrupted POST consumes the local reservation and is never retried", async t => {
  const { posts } = stubApi(t, { postError: new Error("network response lost") });
  const measurements = client({ budget: 6 });
  await assert.rejects(measurements.measure(candidate, { locations: sampleLocations }), /response lost/);
  await assert.rejects(measurements.measure(candidate, { locations: sampleLocations }), /budget exhausted/);
  assert.equal(posts.length, 1);
  assert.equal(measurements.used(), 6);
});

test("probe identity replacement is rejected even when city and ASN match", async t => {
  stubApi(t, { mutate: (raw, _request, index) => { if (index === 2) raw.results[0].probe.tags.push("replacement-owner"); } });
  const measurements = client();
  const first = await measurements.measure(candidate, { locations: sampleLocations });
  await assert.rejects(measurements.measure(candidate, { locations: first.id }), /same probes/);
});

test("offline samples stay invalid; missing probes stop the comparison", async t => {
  await t.test("offline probe cannot qualify", async subtest => {
    stubApi(subtest, { mutate: raw => { raw.results[0].result = { status: "offline", rawOutput: "Probe is offline" }; } });
    const result = await client().measure(candidate, { locations: sampleLocations });
    assert.equal(result.rows[0].valid, false);
    assert.equal(result.rows[0].status, "offline");
  });
  await t.test("missing probe rejects the batch", async subtest => {
    stubApi(subtest, { mutate: raw => { raw.results.pop(); } });
    await assert.rejects(client().measure(candidate, { locations: sampleLocations }), /all required probes/);
  });
});

test("credentials and unsafe measurement targets are rejected locally", async t => {
  const { calls } = stubApi(t);
  assert.throws(() => client({ token: "must-not-be-sent" }), /anonymous free.*token/);
  const measurements = client();
  await assert.rejects(measurements.measure("https://different.example/path"), /IPv4 candidate or the configured hostname/);
  assert.equal(calls.length, 0);
});
