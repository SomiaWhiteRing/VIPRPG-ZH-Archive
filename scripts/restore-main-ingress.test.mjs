import assert from "node:assert/strict";
import test from "node:test";
import { checkRestoredHealth, createRestorationApi, restoreMainIngress } from "./restore-main-ingress.mjs";

const config = {
  accountId: "a".repeat(32), zoneId: "b".repeat(32), recordId: "c".repeat(32), routeId: "d".repeat(32),
  hostname: "viprpg.org", worker: "viprpg-zh-archive", originalDomainId: "e".repeat(40),
  trial: { id: "11111111-1111-4111-8111-111111111111", startsAt: "2026-10-06T00:00:00Z", expiresAt: "2026-10-07T00:00:00Z" },
};
const now = Date.parse("2026-10-07T00:00:01Z");
const domainPath = `/accounts/${config.accountId}/workers/domains`;
const recordPath = `/zones/${config.zoneId}/dns_records/${config.recordId}`;
const routePath = `/zones/${config.zoneId}/workers/routes/${config.routeId}`;

function fixture() {
  return {
    zone: { id: config.zoneId, name: config.hostname, status: "active", account: { id: config.accountId } },
    domains: [],
    dns: [
      { id: config.recordId, name: config.hostname, type: "A", content: "8.35.211.227", proxied: false, ttl: 60, comment: "VIPRPG main ingress" },
      { id: "mail", name: config.hostname, type: "MX", content: "mail.example.com" },
      { id: "text", name: config.hostname, type: "TXT", content: "preserve-this-public-record" },
    ],
    routes: [
      { id: config.routeId, pattern: "https://viprpg.org/*", script: config.worker },
      { id: "other", pattern: "https://staging.viprpg.org/*", script: "staging-worker" },
    ],
  };
}

function managedState(state) {
  state.domains = [{ id: config.originalDomainId, hostname: config.hostname, zone_id: config.zoneId, service: config.worker, enabled: true }];
  state.dns.push({ id: "managed", name: config.hostname, type: "AAAA", content: "100::", proxied: true,
    meta: { read_only: true, origin_worker_id: config.originalDomainId } });
}

function fakeApi(state, { lose = [], failPut = false } = {}) {
  const writes = [], calls = [];
  const api = async (resource, method = "GET", body) => {
    calls.push({ resource, method, body });
    if (method === "GET") {
      if (resource === `/zones/${config.zoneId}`) return structuredClone(state.zone);
      if (resource === domainPath) return structuredClone(state.domains);
      if (resource === `/zones/${config.zoneId}/workers/routes`) return structuredClone(state.routes);
      if (resource === `/zones/${config.zoneId}/dns_records?name=viprpg.org&per_page=100`) return structuredClone(state.dns);
      throw Error("Unexpected fake read");
    }
    writes.push({ resource, method, body });
    if (resource === recordPath && method === "DELETE") state.dns = state.dns.filter(record => record.id !== config.recordId);
    else if (resource === domainPath && method === "PUT") {
      if (failPut) throw Error("Cloudflare update failed");
      assert.deepEqual(body, { hostname: config.hostname, service: config.worker, zone_id: config.zoneId });
      managedState(state);
    } else if (resource === routePath && method === "DELETE") state.routes = state.routes.filter(route => route.id !== config.routeId);
    else throw Error("Unexpected fake mutation");
    if (lose.includes(resource)) throw Error("Response lost after mutation");
    return null;
  };
  return { api, writes, calls };
}

const invoke = (api, options = {}) => restoreMainIngress({ config, api, now, restore: true, confirm: config.hostname,
  domainWaitMs: 0, health: async () => {}, ...options });

test("plan reads state without mutating or invoking health", async () => {
  const { api, writes } = fakeApi(fixture());
  const result = await invoke(api, { restore: false, health: async () => { throw Error("Plan must not run health"); } });
  assert.equal(result.mode, "plan");
  assert.equal(result.deleteTrialDnsRecord, config.recordId);
  assert.equal(writes.length, 0);
});

test("active trials and missing target confirmation cannot write", async () => {
  const { api, writes } = fakeApi(fixture());
  await assert.rejects(invoke(api, { now: Date.parse("2026-10-06T12:00:00Z") }), /expired trial/);
  await assert.rejects(invoke(api, { confirm: undefined }), /confirm viprpg.org/);
  assert.equal(writes.length, 0);
});

test("foreign identity, changed ownership and extra addresses stop restoration", async t => {
  for (const [name, mutate] of Object.entries({
    "wrong account": state => { state.zone.account.id = "f".repeat(32); },
    "changed A ownership": state => { state.dns[0].comment = "another administrator"; },
    "changed Route": state => { state.routes[0].script = "someone-else"; },
    "foreign Custom Domain": state => { state.domains = [{ hostname: config.hostname, zone_id: config.zoneId, service: "someone-else" }]; },
    "other A record": state => { state.dns.push({ id: "foreign", name: config.hostname, type: "A", content: "1.1.1.1" }); },
  })) await t.test(name, async () => {
    const state = fixture();
    mutate(state);
    const { api, writes } = fakeApi(state);
    await assert.rejects(invoke(api), /identity|ownership|unexpected|block/);
    assert.equal(writes.length, 0);
  });
});

test("restoration keeps Route through domain and health verification and preserves MX/TXT", async () => {
  const state = fixture();
  state.dns[0].content = "172.64.155.209"; // Automatic preferred-IP changes retain record ownership.
  const { api, writes } = fakeApi(state);
  const saved = new Map();
  const result = await invoke(api, { save: (name, data) => saved.set(name, data), health: async () => {
    assert.ok(state.routes.some(route => route.id === config.routeId));
    assert.equal(state.domains[0].service, config.worker);
    assert.ok(state.dns.some(record => record.meta?.origin_worker_id === config.originalDomainId));
  } });
  assert.equal(result.mode, "restored");
  assert.deepEqual(writes.map(write => `${write.method} ${write.resource}`), [`DELETE ${recordPath}`, `PUT ${domainPath}`, `DELETE ${routePath}`]);
  assert.ok(state.dns.some(record => record.id === "mail"));
  assert.ok(state.dns.some(record => record.id === "text"));
  assert.ok(state.routes.some(route => route.id === "other"));
  assert.ok(saved.has("before") && saved.has("healthy") && saved.has("result"));
});

test("a prior DNS delete without domain creation can resume idempotently", async () => {
  const state = fixture();
  state.dns = state.dns.filter(record => record.id !== config.recordId);
  const { api, writes } = fakeApi(state);
  await invoke(api);
  assert.deepEqual(writes.map(write => write.method), ["PUT", "DELETE"]);
});

test("already restored domain only cleans its exact remaining Route; repeated restoration writes nothing", async () => {
  const state = fixture();
  state.dns = state.dns.filter(record => record.id !== config.recordId);
  managedState(state);
  const { api, writes } = fakeApi(state);
  await invoke(api);
  assert.deepEqual(writes.map(write => write.resource), [routePath]);
  await invoke(api);
  assert.equal(writes.length, 1);
});

test("lost mutation responses are resolved by reads without duplicate writes", async () => {
  const state = fixture();
  const { api, writes } = fakeApi(state, { lose: [recordPath, domainPath, routePath] });
  const result = await invoke(api);
  assert.equal(result.routeRemoved, true);
  assert.equal(writes.length, 3);
});

test("domain restore or health failure preserves the trial Route", async t => {
  await t.test("failed domain PUT", async () => {
    const state = fixture();
    const { api, writes } = fakeApi(state, { failPut: true });
    await assert.rejects(invoke(api), /did not confirm/);
    assert.ok(state.routes.some(route => route.id === config.routeId));
    assert.ok(!writes.some(write => write.resource === routePath));
  });
  await t.test("health failure", async () => {
    const state = fixture();
    const { api, writes } = fakeApi(state);
    await assert.rejects(invoke(api, { health: async () => { throw Error("Wrong service health"); } }), /Wrong service/);
    assert.ok(state.routes.some(route => route.id === config.routeId));
    assert.ok(!writes.some(write => write.resource === routePath));
  });
});

test("scoped transport refuses unrelated writes and undocumented PUT fields before fetch", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("No network expected"); });
  const api = createRestorationApi(config, "secret-must-not-be-emitted");
  await assert.rejects(api(`/zones/${config.zoneId}/dns_records/other`, "DELETE"), /permits only scoped/);
  await assert.rejects(api(domainPath, "PUT", { hostname: config.hostname, service: config.worker, zone_id: config.zoneId, override_scope: true }), /permits only scoped/);
  await assert.rejects(api(`/accounts/${config.accountId}/workers/scripts`, "GET"), /permits only scoped/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("real empty 200/204 responses are accepted only for scoped DELETE and PUT mutations", async t => {
  for (const status of [200, 204]) await t.test(String(status), async t => {
    const fetch = t.mock.method(globalThis, "fetch", async (url, init) =>
      init.method === "GET" && new URL(url).pathname.endsWith("/workers/routes")
        ? new Response(JSON.stringify({ success: true, result: fixture().routes }), { status: 200 })
        : new Response(null, { status }));
    const api = createRestorationApi(config, "fake-restoration-token");
    assert.equal(await api(recordPath, "DELETE"), null);
    await api(`/zones/${config.zoneId}/workers/routes`);
    assert.equal(await api(routePath, "DELETE"), null);
    assert.equal(await api(domainPath, "PUT", { hostname: config.hostname, service: config.worker, zone_id: config.zoneId }), null);
    // Reads must still contain the successful JSON envelope; an empty body is not state evidence.
    await assert.rejects(api(`/zones/${config.zoneId}`), SyntaxError);
    assert.equal(fetch.mock.callCount(), 5);
    for (const [resource, method, body] of [
      [`/zones/${config.zoneId}/dns_records/unregistered`, "DELETE"],
      [`/zones/${config.zoneId}/workers/routes/unregistered`, "DELETE"],
      [domainPath, "PUT", { hostname: "elsewhere.example", service: config.worker, zone_id: config.zoneId }],
      [recordPath, "PATCH", { content: "8.35.211.227" }],
    ]) await assert.rejects(api(resource, method, body), /permits only scoped/);
    assert.equal(fetch.mock.callCount(), 5, "unscoped writes are rejected before the mocked transport");
  });
});

test("empty mutation acknowledgements complete restoration only after successful state readbacks", async t => {
  for (const status of [200, 204]) await t.test(String(status), async t => {
    const state = fixture();
    const simulated = fakeApi(state);
    t.mock.method(globalThis, "fetch", async (url, init) => {
      const endpoint = new URL(url);
      const resource = endpoint.pathname.replace(/^\/client\/v4/, "") + endpoint.search;
      const result = await simulated.api(resource, init.method, init.body ? JSON.parse(init.body) : undefined);
      return init.method === "GET"
        ? new Response(JSON.stringify({ success: true, result }), { status: 200 })
        : new Response(null, { status });
    });
    const result = await invoke(createRestorationApi(config, "fake-restoration-token"));
    assert.equal(result.mode, "restored");
    assert.equal(result.routeRemoved, true);
    assert.deepEqual(simulated.writes.map(write => `${write.method} ${write.resource}`),
      [`DELETE ${recordPath}`, `PUT ${domainPath}`, `DELETE ${routePath}`]);
    assert.ok(simulated.calls.filter(call => call.method === "GET").length >= 16);
    assert.equal(state.domains[0].service, config.worker);
  });
});

test("health requires both ok:true and the correct service", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ ok: true, service: "wrong-worker" }), { status: 200 }));
  await assert.rejects(checkRestoredHealth(config, 5), /approved service/);
});
