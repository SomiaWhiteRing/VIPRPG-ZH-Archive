import assert from "node:assert/strict";
import { test } from "node:test";
import { assertOwnedState, chooseIngress, applySelected, ownerComment, routePattern } from "./ingress-policy.mjs";
import { cloudflareClient } from "./select-main-ingress.mjs";

const current = "172.64.155.209", candidate = "8.35.211.227", backup = "8.39.125.89";
const config = { hostname: "viprpg.org", accountId: "a".repeat(32), zoneId: "b".repeat(32),
  worker: "main-worker", recordId: "c".repeat(32), routeId: "d".repeat(32) };
const now = Date.parse("2026-10-06T14:00:00Z");
const record = { id: config.recordId, name: config.hostname, type: "A", content: current,
  proxied: false, ttl: 60, comment: ownerComment, modified_on: "2026-10-05T12:00:00Z" };
function state() {
  return { zone: { id: config.zoneId, name: config.hostname, account: { id: config.accountId }, status: "active" },
    dns: [structuredClone(record)], domains: [], routes: [{ id: config.routeId, pattern: routePattern, script: config.worker }],
    certificates: [{ status: "active", hosts: [config.hostname], certificates: [{ status: "active", expires_on: "2026-12-01T00:00:00Z" }] }] };
}
function rounds(time = 500) {
  return [0, 1].map(() => ({ rows: [4134, 4837, 9808].flatMap(asn => ["A", "B"].map(city => ({
    probeKey: `CN:${asn}:${city}`, country: "CN", asn, city, valid: true, totalMs: time, ingressMs: time,
  }))) }));
}
test("only the owned main A and exact Route may be edited", () => {
  assert.equal(assertOwnedState(state(), config, now).content, current);
  const mutations = [
    x => { x.dns.push({ type: "AAAA", content: "2606:4700::1" }); },
    x => { x.dns[0].comment = "another owner"; },
    x => { x.dns[0].proxied = true; },
    x => { x.domains.push({ hostname: config.hostname, service: config.worker }); },
    x => { x.routes.push({ pattern: "https://viprpg.org/api/*", script: "another-worker" }); },
    x => { x.routes.push({ pattern: "*viprpg.org/*", script: "another-worker" }); },
    x => { x.routes[0].script = "another-worker"; },
    x => { x.zone.account.id = "e".repeat(32); },
    x => { x.certificates[0].certificates[0].expires_on = "2026-10-07T00:00:00Z"; },
  ];
  for (const mutate of mutations) { const input = state(); mutate(input); assert.throws(() => assertOwnedState(input, config, now)); }
  const separate = state(); separate.routes.push({ pattern: "https://download.viprpg.org/*", script: "relay" });
  assert.doesNotThrow(() => assertOwnedState(separate, config, now));
});
test("repeatable three-carrier gain selects a verified candidate", () => {
  const result = chooseIngress({ [current]: rounds(500), [candidate]: rounds(300) }, current, record.modified_on, now);
  assert.equal(result.selected, candidate); assert.equal(result.fallback, current); assert.equal(result.change, true);
});
test("minor gains, second-round noise and a slower carrier keep DNS", () => {
  for (const candidateRounds of [rounds(460), [rounds(300)[0], rounds(460)[1]]])
    assert.equal(chooseIngress({ [current]: rounds(), [candidate]: candidateRounds }, current, record.modified_on, now).change, false);
  const regressed = rounds(150); regressed.forEach(round => round.rows.filter(row => row.asn === 9808).forEach(row => { row.totalMs = row.ingressMs = 600; }));
  assert.equal(chooseIngress({ [current]: rounds(), [candidate]: regressed }, current, record.modified_on, now).change, false);
});
test("missing cities, wrong content and a changed probe set cannot authorize writes", () => {
  const missing = rounds(); missing[0].rows.pop();
  assert.equal(chooseIngress({ [current]: missing, [candidate]: rounds(200) }, current, record.modified_on, now).change, false);
  const wrong = rounds(200); wrong[1].rows[0].valid = false;
  assert.equal(chooseIngress({ [current]: rounds(), [candidate]: wrong }, current, record.modified_on, now).change, false);
  const changed = rounds(200); changed[0].rows[0].probeKey = "a-different-probe";
  assert.equal(chooseIngress({ [current]: rounds(), [candidate]: changed }, current, record.modified_on, now).change, false);
});
test("healthy optimization respects twelve-hour hold", () => {
  const held = chooseIngress({ [current]: rounds(), [candidate]: rounds(200) }, current, new Date(now - 3600000).toISOString(), now);
  assert.equal(held.reason, "minimum-twelve-hour-hold"); assert.equal(held.change, false);
});
test("an offline instrument is never interpreted as a broken current ingress", () => {
  const offline = rounds(100); offline.forEach(round => { round.rows[0].valid = false; round.rows[0].status = "offline"; });
  const result = chooseIngress({ [current]: offline, [candidate]: rounds(150), [backup]: rounds(155) }, current, record.modified_on, now);
  assert.equal(result.change, false); assert.equal(result.reason, "measurement-probe-offline");
});
test("recovery needs repeatable failure, no healthy-node regression and a separate fallback", () => {
  const faulty = rounds(100); faulty.forEach(round => { round.rows[0].valid = false; });
  assert.equal(chooseIngress({ [current]: faulty, [candidate]: rounds(19000), [backup]: rounds(19500) }, current, record.modified_on, now).change, false);
  assert.equal(chooseIngress({ [current]: faulty, [candidate]: rounds(150) }, current, record.modified_on, now).reason, "no-healthy-rollback-address");
  assert.equal(chooseIngress({ [current]: faulty, [candidate]: rounds(150), [backup]: rounds(19000) }, current, record.modified_on, now).reason, "no-healthy-rollback-address");
  const result = chooseIngress({ [current]: faulty, [candidate]: rounds(150), [backup]: rounds(155) }, current, new Date(now).toISOString(), now);
  assert.equal(result.reason, "verified-recovery"); assert.equal(result.fallback, backup); assert.equal(result.change, true);
  faulty[1].rows[0].valid = true;
  assert.equal(chooseIngress({ [current]: faulty, [candidate]: rounds(150), [backup]: rounds(155) }, current, record.modified_on, now).reason, "current-failure-not-repeatable");
});
function store() {
  let value = structuredClone(record), sequence = 0;
  const writes = [];
  return { read: async () => structuredClone(value),
    patch: async content => { writes.push(content); value = { ...value, content, modified_on: `write-${++sequence}` }; return structuredClone(value); },
    change: patch => { value = { ...value, ...patch }; }, writes };
}
const save = async () => {};
test("successful update and post-switch failure have bounded write sequences", async () => {
  const ok = store();
  const receipt = await applySelected({ before: record, selected: candidate, fallback: current, ...ok, verify: async () => {}, save });
  assert.equal(receipt.outcome, "applied"); assert.deepEqual(ok.writes, [candidate]);
  const fail = store(); let checks = 0;
  await assert.rejects(applySelected({ before: record, selected: candidate, fallback: current, ...fail, save,
    verify: async () => { if (++checks === 1) throw Error("normal-DNS check failed"); } }), /fallback .* restored/);
  assert.deepEqual(fail.writes, [candidate, current]); assert.equal((await fail.read()).content, current);
});
test("a DNS change during measurement aborts before PATCH", async () => {
  const data = store(); data.change({ modified_on: "human-update" });
  await assert.rejects(applySelected({ before: record, selected: candidate, fallback: current, ...data, verify: async () => {}, save }), /during measurement/);
  assert.deepEqual(data.writes, []);
});
test("post-check cannot overwrite a later change even when its IP matches", async () => {
  const data = store();
  await assert.rejects(applySelected({ before: record, selected: candidate, fallback: current, ...data, save,
    verify: async () => { data.change({ modified_on: "human-update-same-ip" }); throw Error("failed probe"); } }), /refusing rollback/);
  assert.deepEqual(data.writes, [candidate]); assert.equal((await data.read()).modified_on, "human-update-same-ip");
});
test("unknown PATCH outcome is reported without a blind second write", async () => {
  const data = store();
  await assert.rejects(applySelected({ before: record, selected: candidate, fallback: current, ...data, save, verify: async () => {},
    patch: async content => { await data.patch(content); throw Error("connection reset after send"); } }), /unconfirmed/);
  assert.deepEqual(data.writes, [candidate]);
});
test("scheduler API transport forbids every mutation except one record content PATCH", async () => {
  const client = cloudflareClient(config, "read-token", "dns-token");
  for (const [resource, method, body] of [
    [`/zones/${config.zoneId}/dns_records`, "POST", { content: candidate }],
    [`/zones/${config.zoneId}/dns_records/${"e".repeat(32)}`, "PATCH", { content: candidate }],
    [`/zones/${config.zoneId}/dns_records/${config.recordId}`, "PATCH", { content: candidate, proxied: true }],
    [`/accounts/${config.accountId}/workers/domains/a-domain`, "DELETE", undefined],
  ]) await assert.rejects(client.api(resource, method, body), /only PATCH content/);
});
