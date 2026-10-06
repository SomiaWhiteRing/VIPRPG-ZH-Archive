import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readTrialConfig, trialState, applyTrialRoute, assertTrialDeployment } from "./ingress-trial-config.mjs";

const startsAt = Date.parse("2026-10-06T12:00:00.000Z");
const expiresAt = startsAt + 24 * 60 * 60 * 1000;
const config = {
  hostname: "viprpg.org", worker: "viprpg-zh-archive", zoneId: "a".repeat(32), accountId: "b".repeat(32),
  trial: { id: "63e04c65-cc3b-470b-a73f-d1c459b5c0b0", startsAt: new Date(startsAt).toISOString(), expiresAt: new Date(expiresAt).toISOString() },
};
function target() {
  return { name: config.worker, vars: { APP_ORIGIN: "https://viprpg.org", OTHER: "retained" },
    routes: [{ pattern: "viprpg.org", custom_domain: true }], workers_dev: false,
    d1_databases: [{ binding: "DB", database_id: "database" }], r2_buckets: [{ binding: "ARCHIVE_BUCKET", bucket_name: "bucket" }],
    durable_objects: { bindings: [{ name: "VIEW_STATS", class_name: "ViewStats" }] }, triggers: { crons: ["0 1 * * *"] } };
}

test("environment configuration takes precedence; missing local configuration returns null", () => {
  const initial = process.cwd();
  const directory = fs.mkdtempSync(path.join(tmpdir(), "viprpg-ingress-trial-"));
  try {
    process.chdir(directory);
    assert.equal(readTrialConfig({}), null);
    fs.mkdirSync("output/main-ingress-trial", { recursive: true });
    fs.writeFileSync("output/main-ingress-trial/config.json", JSON.stringify(config));
    assert.deepEqual(readTrialConfig({}), config);
    const override = { ...config, worker: "explicit-worker" };
    assert.deepEqual(readTrialConfig({ MAIN_INGRESS_CONFIG_JSON: JSON.stringify(override) }), override);
    for (const value of ["invalid-json", "null", "[]", "123"])
      assert.throws(() => readTrialConfig({ MAIN_INGRESS_CONFIG_JSON: value }), /configuration JSON/);
  } finally {
    process.chdir(initial);
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("trial boundaries include the start and exclude the expiry", () => {
  assert.equal(trialState(null), null);
  assert.equal(trialState({}), null);
  assert.deepEqual(trialState(config, startsAt - 1), { active: false, expired: false, expiresAt });
  assert.deepEqual(trialState(config, startsAt), { active: true, expired: false, expiresAt });
  assert.equal(trialState(config, expiresAt - 1).active, true);
  assert.deepEqual(trialState(config, expiresAt), { active: false, expired: true, expiresAt });
  assert.equal(trialState(config, expiresAt + 1).expired, true);
  const offset = structuredClone(config);
  offset.trial.startsAt = "2026-10-06T20:00:00+08:00";
  offset.trial.expiresAt = "2026-10-07T20:00:00+08:00";
  assert.deepEqual(trialState(offset, startsAt), trialState(config, startsAt));
});

test("invalid identities, dates and trial duration cannot authorize an overlay", () => {
  const maximum = structuredClone(config);
  maximum.trial.expiresAt = new Date(expiresAt + 60_000).toISOString();
  assert.equal(trialState(maximum, startsAt).active, true);
  for (const expires of [startsAt, startsAt - 1, expiresAt + 60_001]) {
    const invalid = structuredClone(config);
    invalid.trial.expiresAt = new Date(expires).toISOString();
    assert.throws(() => trialState(invalid, startsAt), /Trial must last/);
  }
  for (const value of ["2026-02-30T12:00:00.000Z", "2026-10-06", "2026-10-06T12:00:00", "not-a-date", "2026-10-06T25:00:00Z"]) {
    const invalid = structuredClone(config);
    invalid.trial.startsAt = value;
    assert.throws(() => trialState(invalid, startsAt), /Invalid trial/);
  }
  assert.throws(() => trialState({ trial: { ...config.trial, id: "not-uuid" } }, startsAt), /UUID/);
  assert.throws(() => trialState(config, NaN), /clock/);
});

test("active overlay changes only the approved production routes", () => {
  const production = target(), before = structuredClone(production);
  assert.equal(applyTrialRoute(production, config, startsAt), production);
  assert.deepEqual(production.routes, [{ pattern: "https://viprpg.org/*", zone_id: config.zoneId }]);
  delete before.routes;
  const after = structuredClone(production);
  delete after.routes;
  assert.deepEqual(after, before);
  for (const mutation of [
    { hostname: "other.example" }, { worker: "another-worker" }, { zoneId: "bad-zone" }, { accountId: "bad-account" },
  ]) assert.throws(() => applyTrialRoute(target(), { ...config, ...mutation }, startsAt));
  const staging = target();
  staging.vars.APP_ORIGIN = "https://staging.viprpg.org";
  const unchanged = structuredClone(staging);
  assert.throws(() => applyTrialRoute(staging, config, startsAt), /production Worker/);
  assert.deepEqual(staging, unchanged);
});

test("absent, future and expired trials preserve the Custom Domain baseline", () => {
  for (const [metadata, now] of [[null, startsAt], [{}, startsAt], [config, startsAt - 1], [config, expiresAt], [config, expiresAt + 1]]) {
    const production = target(), before = structuredClone(production);
    assert.equal(applyTrialRoute(production, metadata, now), production);
    assert.deepEqual(production, before);
  }
});

test("deployment reserve prevents publishing a Route after a build crosses expiry", () => {
  const production = applyTrialRoute(target(), config, startsAt);
  assert.equal(assertTrialDeployment(production, config, expiresAt - 600_000), production);
  for (const now of [startsAt - 1, expiresAt - 599_999, expiresAt, expiresAt + 1])
    assert.throws(() => assertTrialDeployment(production, config, now), /at least ten minutes/);
  assert.throws(() => assertTrialDeployment(production, null, startsAt), /active trial/);
  assert.throws(() => assertTrialDeployment(production, { ...config, worker: "another-worker" }, startsAt), /production Worker/);
  const wrongZone = structuredClone(production);
  wrongZone.routes[0].zone_id = "c".repeat(32);
  assert.throws(() => assertTrialDeployment(wrongZone, config, startsAt), /approved HTTPS Route/);
  const baseline = target();
  assert.equal(assertTrialDeployment(baseline, config, expiresAt), baseline);
  assert.equal(assertTrialDeployment(baseline, null, startsAt), baseline);
});
