import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { readTrialConfig, trialState } from "./ingress-trial-config.mjs";
import { coveringRoutes, hostname, ownerComment, routePattern } from "./ingress-policy.mjs";

function validateConfig(config) {
  if (!config || config.hostname !== hostname || config.worker !== "viprpg-zh-archive") throw Error("Only the approved viprpg.org Worker can be restored");
  for (const field of ["accountId", "zoneId", "recordId", "routeId"])
    if (!/^[a-f0-9]{32}$/i.test(config[field] ?? "")) throw Error(`Invalid restoration ${field}`);
}

function ownedRecord(record, config) {
  return record?.id === config.recordId && record.name === hostname && record.type === "A"
    && isIP(record.content) === 4 && record.proxied === false && record.ttl === 60 && record.comment === ownerComment;
}

function inspect(state, config) {
  if (state.zone.id !== config.zoneId || state.zone.name !== hostname || state.zone.status !== "active" || state.zone.account?.id !== config.accountId)
    throw Error("Restoration zone/account identity mismatch");
  const domains = state.domains.filter(domain => domain.hostname === hostname);
  if (domains.length > 1 || domains.some(domain => domain.service !== config.worker || domain.zone_id !== config.zoneId || domain.enabled === false))
    throw Error("Main Custom Domain has an unexpected Worker, zone or disabled binding");
  const domain = domains[0];
  const record = state.dns.find(record => record.id === config.recordId);
  if (record && !ownedRecord(record, config)) throw Error("Registered trial DNS record no longer has the approved ownership attributes");
  const addresses = state.dns.filter(record => record.name === hostname && ["A", "AAAA", "CNAME"].includes(record.type));
  const managed = addresses.filter(record => domain && record.proxied === true && record.meta?.read_only === true && record.meta?.origin_worker_id === domain.id);
  if (addresses.some(record => record.id !== config.recordId && !managed.includes(record)))
    throw Error("Unrelated main-host A/AAAA/CNAME records block restoration; no DNS records will be overwritten");
  const routes = coveringRoutes(state.routes);
  if (routes.some(route => route.id !== config.routeId || route.pattern !== routePattern || route.script !== config.worker))
    throw Error("Main trial Route identity changed or a conflicting Route exists");
  const route = state.routes.find(route => route.id === config.routeId);
  if (route && (route.pattern !== routePattern || route.script !== config.worker)) throw Error("Registered Route no longer targets the approved main Worker");
  return { domain, record, route, restored: Boolean(domain && !record && managed.length) };
}

export async function checkRestoredHealth(config, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`https://${hostname}/api/health`, {
        redirect: "error", headers: { "User-Agent": "VIPRPG-Ingress-Restoration/1.0", "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
      });
      const body = await response.json();
      if (response.status === 200 && body.ok === true && body.service === config.worker) return;
    } catch { /* DNS propagation and deployment readiness may require a short retry. */ }
    await delay(Math.max(0, Math.min(1000, deadline - Date.now())));
  }
  throw Error("Restored main HTTPS health did not confirm ok:true and the approved service within 30 seconds");
}

/** Injected api/health/save make restoration checks testable without real network access. */
export async function restoreMainIngress({ config, restore = false, confirm, api, health = checkRestoredHealth, save = async () => {}, now = Date.now(), domainWaitMs = 30000 }) {
  validateConfig(config);
  const trial = trialState(config, now);
  if (!trial) throw Error("An approved bounded trial identity is required for restoration");
  if (restore && (confirm !== hostname || !trial.expired)) throw Error("Restoration requires --confirm viprpg.org and an expired trial");
  if (typeof api !== "function") throw Error("Cloudflare API transport is required");
  if (!Number.isInteger(domainWaitMs) || domainWaitMs < 0 || domainWaitMs > 30000) throw Error("Domain propagation wait must be bounded to 30 seconds");
  const read = async deadline => {
    const get = resource => {
      const remaining = deadline === undefined ? 15000 : deadline - Date.now();
      if (remaining <= 0) throw Error("Custom Domain propagation verification deadline expired; keep Route");
      return api(resource, "GET", undefined, { timeoutMs: Math.min(15000, remaining) });
    };
    return {
      zone: await get(`/zones/${config.zoneId}`),
      domains: await get(`/accounts/${config.accountId}/workers/domains`),
      dns: await get(`/zones/${config.zoneId}/dns_records?name=${hostname}&per_page=100`),
      routes: await get(`/zones/${config.zoneId}/workers/routes`),
    };
  };
  let state = await read();
  let current = inspect(state, config);
  await save("before", { at: new Date(now).toISOString(), trial: config.trial, state });
  const plan = { hostname, worker: config.worker, trialExpired: trial.expired, originalDomainId: config.originalDomainId ?? null,
    deleteTrialDnsRecord: current.record?.id ?? null, restoreCustomDomain: !current.restored, deleteTrialRouteAfterHealth: current.route?.id ?? null };
  await save("plan", plan);
  if (!restore) return { mode: "plan", ...plan };

  async function observedWrite(resource, method, body, verified, label) {
    let error;
    try { await api(resource, method, body); } catch (failure) { error = failure; }
    // A lost response is not evidence that a mutation failed. Never blindly retry.
    const deadline = Date.now() + (method === "PUT" ? domainWaitMs : 0);
    do {
      state = await read(method === "PUT" && domainWaitMs > 0 ? deadline : undefined);
      current = inspect(state, config);
      if (verified(current) || Date.now() >= deadline) break;
      await delay(Math.max(0, Math.min(1000, deadline - Date.now())));
    } while (Date.now() < deadline);
    await save(label, { at: new Date().toISOString(), state, outcomeUncertain: Boolean(error) });
    if (!verified(current)) throw Error(`${label} did not confirm the intended state; keep the trial Route and inspect Cloudflare`);
  }

  if (!current.restored) {
    if (current.record) {
      state = await read();
      current = inspect(state, config);
      if (current.record) await observedWrite(`/zones/${config.zoneId}/dns_records/${config.recordId}`, "DELETE", undefined,
        value => !value.record, "after-trial-dns-delete");
    }
    if (!current.restored) await observedWrite(`/accounts/${config.accountId}/workers/domains`, "PUT",
      { hostname, service: config.worker, zone_id: config.zoneId }, value => value.restored, "after-domain-restore");
  }
  state = await read();
  current = inspect(state, config);
  if (!current.restored) throw Error("Custom Domain and its managed DNS have not both been restored");
  await health(config);
  await save("healthy", { at: new Date().toISOString(), hostname, worker: config.worker });
  // Recheck immediately before deleting only this trial's Route; keep unrelated routes intact.
  state = await read();
  current = inspect(state, config);
  if (!current.restored) throw Error("Managed main-host state changed after health verification; keep Route");
  if (current.route) await observedWrite(`/zones/${config.zoneId}/workers/routes/${config.routeId}`, "DELETE", undefined,
    value => value.restored && !value.route, "after-trial-route-delete");
  const result = { mode: "restored", hostname, worker: config.worker, trialId: config.trial.id, routeRemoved: !current.route };
  await save("result", result);
  return result;
}

export function createRestorationApi(config, token) {
  validateConfig(config);
  if (!token) throw Error("A Cloudflare credential must be explicitly supplied in the environment");
  const domainPath = `/accounts/${config.accountId}/workers/domains`;
  const reads = new Set([`/zones/${config.zoneId}`, domainPath,
    `/zones/${config.zoneId}/dns_records?name=${hostname}&per_page=100`, `/zones/${config.zoneId}/workers/routes`]);
  const deletes = new Set([`/zones/${config.zoneId}/dns_records/${config.recordId}`, `/zones/${config.zoneId}/workers/routes/${config.routeId}`]);
  return async (resource, method = "GET", body, { timeoutMs = 15000 } = {}) => {
    const allowed = method === "GET" && reads.has(resource) && body === undefined
      || method === "DELETE" && deletes.has(resource) && body === undefined
      || method === "PUT" && resource === domainPath && body && Object.keys(body).length === 3
        && body.hostname === hostname && body.service === config.worker && body.zone_id === config.zoneId;
    if (!allowed) throw Error("Restoration API permits only scoped reads, the owned trial deletes and the exact main Custom Domain PUT");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw Error("Invalid restoration API timeout");
    const response = await fetch(`https://api.cloudflare.com/client/v4${resource}`, {
      method, redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok || data.success !== true) throw Error(`Cloudflare ${method} ${resource}: HTTP ${response.status}`);
    return data.result;
  };
}

async function main() {
  const { values } = parseArgs({ options: { plan: { type: "boolean" }, restore: { type: "boolean" }, confirm: { type: "string" }, out: { type: "string" } } });
  if (values.plan && values.restore) throw Error("Choose --plan or --restore");
  const config = readTrialConfig();
  validateConfig(config);
  const trial = trialState(config);
  if (values.restore && trial && !trial.expired) {
    if (values.confirm !== hostname) throw Error("Restoration requires --confirm viprpg.org");
    console.log(JSON.stringify({ mode: "trial-active", expiresAt: new Date(trial.expiresAt).toISOString() }));
    return;
  }
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.INGRESS_CF_RESTORE_TOKEN
    || (values.restore ? process.env.INGRESS_CF_DNS_TOKEN : process.env.INGRESS_CF_READ_TOKEN);
  if (!token) throw Error("A Cloudflare credential must be explicitly supplied in the environment");
  const out = values.out || process.env.MAIN_INGRESS_RESTORE_OUT || "output/main-ingress-restoration";
  fs.mkdirSync(out, { recursive: true });
  const save = (name, data) => fs.writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
  const api = createRestorationApi(config, token);
  try {
    console.log(JSON.stringify(await restoreMainIngress({ config, restore: values.restore === true, confirm: values.confirm, api, save })));
  } catch (error) {
    save("failure", { at: new Date().toISOString(), message: error.message });
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
