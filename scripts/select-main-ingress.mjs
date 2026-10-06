import fs from "node:fs";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import https from "node:https";
import { publicRobots } from "../lib/crawl-policy.ts";
import { loadCandidates } from "./ingress-candidates.mjs";
import { createMeasurements } from "./ingress-measurements.mjs";
import { hostname, validateIngressConfig, assertOwnedState, healthyRounds, chooseIngress, applySelected } from "./ingress-policy.mjs";
import { trialState } from "./ingress-trial-config.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function cloudflareClient(config, readToken, dnsToken) {
  if (!readToken) throw Error("A read-only Cloudflare token is required");
  async function api(resource, method = "GET", body) {
    const expected = `/zones/${config.zoneId}/dns_records/${config.recordId}`;
    if (method !== "GET" && (method !== "PATCH" || resource !== expected || Object.keys(body ?? {}).join() !== "content" || !dnsToken))
      throw Error("Scheduler may only PATCH content of the registered DNS record");
    const response = await fetch(`https://api.cloudflare.com/client/v4${resource}`, {
      method, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${method === "GET" ? readToken : dnsToken}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok || data.success !== true) throw Error(`Cloudflare ${method} ${resource}: ${response.status} ${JSON.stringify(data.errors)}`);
    return data.result;
  }
  async function readState() {
    const zone = await api(`/zones/${config.zoneId}`);
    const dns = await api(`/zones/${config.zoneId}/dns_records?name=${hostname}&per_page=100`);
    const routes = await api(`/zones/${config.zoneId}/workers/routes`);
    const domains = await api(`/accounts/${config.accountId}/workers/domains`);
    const certificates = await api(`/zones/${config.zoneId}/ssl/certificate_packs`);
    return { zone, dns, routes, domains, certificates };
  }
  return { api, readState };
}

async function archiveReference(archivePath, directIp) {
  // Native HTTPS lookup override retains viprpg.org as Host/SNI and verifies its certificate.
  // GitHub's runner connects directly; this recovery path does not depend on the failed current DNS IP.
  const response = directIp ? await new Promise((resolve, reject) => {
    const request = https.get(`https://${hostname}${archivePath}`, {
      agent: false, signal: AbortSignal.timeout(20000),
      lookup: (_host, options, callback) => callback(null, options.all ? [{ address: directIp, family: 4 }] : directIp, 4),
      headers: { Range: "bytes=0-4095", "Accept-Encoding": "identity" },
    }, incoming => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, String(value));
      if (incoming.statusCode !== 206 || headers.get("content-length") !== "4096") {
        incoming.destroy(); reject(Error("Recovery ZIP reference did not return bounded Range 206")); return;
      }
      const chunks = [];
      let length = 0;
      incoming.on("data", chunk => {
        length += chunk.length;
        if (length > 4096) incoming.destroy(Error("Recovery ZIP Range is oversized"));
        else chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers })));
    });
    request.on("error", reject);
  }) : await fetch(`https://${hostname}${archivePath}`, {
    redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Range: "bytes=0-4095", "Accept-Encoding": "identity" },
  });
  const range = /^bytes 0-4095\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
  const etag = response.headers.get("etag");
  if (response.status !== 206 || !range || !/^"[^"\r\n]+"$/.test(etag ?? "") ||
      response.headers.get("content-length") !== "4096" || response.headers.get("content-encoding")) {
    await response.body?.cancel();
    throw Error("Published archive reference does not provide a strong ETag and the expected identity-encoded Range");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== 4096 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || Number(range[1]) < 4096)
    throw Error("Invalid reference ZIP bytes");
  return { path: archivePath, etag, start: 0, end: 4095, total: Number(range[1]),
    referenceSha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function runSelection({ config, apply = false, out, environment = process.env }) {
  const startedAt = Date.now();
  const trial = trialState(config);
  if (trial && !trial.active) return { outcome: "trial-inactive", hostname, expiresAt: new Date(trial.expiresAt).toISOString() };
  validateIngressConfig(config, apply);
  fs.mkdirSync(out, { recursive: true });
  const save = (name, data) => fs.writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
  if (apply && environment.MAIN_INGRESS_AUTO_ENABLED !== "true")
    throw Error("Enable the explicitly approved main-ingress policy before apply");
  const cf = cloudflareClient(config, environment.INGRESS_CF_READ_TOKEN, apply ? environment.INGRESS_CF_DNS_TOKEN : undefined);
  const beforeState = await cf.readState();
  save("initial-state", beforeState);
  if (beforeState.zone.id !== config.zoneId || beforeState.zone.name !== hostname || beforeState.zone.account?.id !== config.accountId)
    throw Error("Main-site zone/account mismatch");
  const managed = beforeState.domains.filter(x => x.hostname === hostname);
  let before;
  if (apply || config.recordId) before = assertOwnedState(beforeState, config);
  else if (managed.length !== 1 || managed[0].service !== config.worker || managed[0].enabled !== true)
    throw Error("Measurement-only baseline is not the registered main Custom Domain");
  const current = before?.content ?? hostname;
  const measured = {};
  const report = { createdAt: new Date().toISOString(), mode: apply ? "apply" : "report", hostname, current,
    scope: "Existing main DNS content only; no Worker, Route, certificate, deployment, DB, R2 or DO changes",
    limitations: "Six available carrier/city probes and small HTTPS transfers; not a nationwide or large-ZIP throughput guarantee" };
  save("report", report);
  const pool = await loadCandidates({ currentIp: before?.content, limit: 3, save });
  save("candidate-pool", pool);
  if (before && !pool.evidence.some(x => x.source === "current" && x.ip === current && x.ownershipVerified === true))
    throw Error("Current IP announcement could not be verified; refusing selection");
  const targets = [...new Set([current, ...pool.candidates])].slice(0, 4);
  if (targets.length < 2) throw Error("No verified alternative candidate");
  const measurements = createMeasurements({ hostname, expectedBody: publicRobots(`https://${hostname}`), budget: 120, save });
  let locations = await measurements.inventory();
  for (let round = 0; round < 2; round++) {
    for (const target of round === 0 ? targets : [...targets].reverse()) {
      const result = await measurements.measure(target, { locations });
      locations = result.locations;
      (measured[target] ??= []).push(result);
      save("measured", measured);
    }
  }
  const decision = chooseIngress(measured, current, before?.modified_on);
  Object.assign(report, { decision, measurementProbeTests: measurements.used() });
  save("report", report);
  if (!decision.change) return report;
  const reference = await archiveReference(config.archivePath, decision.currentHealthy ? undefined : decision.selected);
  save("archive-reference", reference);
  const rangeResults = {};
  for (let round = 0; round < 2; round++) {
    for (const target of [decision.selected, decision.fallback]) {
      const result = await measurements.measure(target, { locations, range: reference });
      (rangeResults[target] ??= []).push(result);
    }
  }
  save("range-validation", rangeResults);
  if (!Object.values(rangeResults).every(healthyRounds)) throw Error("Candidate/fallback ZIP Range validation failed; keep DNS");
  // A fast robots response must not hide a slower real archive response.
  if (decision.currentHealthy) {
    const selected = rangeResults[decision.selected];
    const baseline = rangeResults[decision.fallback];
    for (const asn of [4134, 4837, 9808]) {
      const average = rounds => rounds.flatMap(x => x.rows).filter(x => x.asn === asn).reduce((s, x) => s + (x.ingressMs ?? x.totalMs), 0) / 4;
      if (average(selected) > Math.max(average(baseline) * 1.1, average(baseline) + 50))
        throw Error(`Candidate regresses archive response on AS${asn}; keep DNS`);
    }
  }
  Object.assign(report, { archiveValidated: true, measurementProbeTests: measurements.used() });
  if (!apply) {
    report.migrationRequired = !before;
    report.outcome = "validated-recommendation-only";
    save("report", report);
    return report;
  }
  // Fresh mainland check inside the deployment mutex immediately precedes the write.
  for (const target of [decision.selected, decision.fallback]) {
    const fresh = await measurements.measure(target, { locations });
    if (!fresh.rows.every(x => x.valid) || fresh.rows.length !== 6) throw Error("Winner or fallback became unhealthy; keep DNS");
  }
  if (await measurements.remaining() < 36) throw Error("Insufficient free quota for post-check and rollback; keep DNS");
  if (measurements.used() + 24 > 120) throw Error("Insufficient local probe budget for post-check and rollback; keep DNS");
  if (Date.now() - startedAt > 10 * 60000) throw Error("Insufficient maintenance window for apply and rollback; keep DNS");
  if (config.trial && trialState(config).expiresAt - Date.now() < 10 * 60000)
    throw Error("Trial has insufficient time for DNS verification and rollback; keep DNS");
  const read = async () => assertOwnedState(await cf.readState(), config);
  const patch = content => {
    if (config.trial && !trialState(config).active) throw Error("Trial expired before DNS write; keep DNS");
    return cf.api(`/zones/${config.zoneId}/dns_records/${config.recordId}`, "PATCH", { content });
  };
  const verify = async expected => {
    // DNS caches can outlive TTL. Two bounded attempts allow propagation; a timeout never loops indefinitely.
    for (let attempt = 0; attempt < 2; attempt++) {
      await delay(60000);
      const result = await measurements.measure(hostname, { locations });
      save(`dns-verification-${expected}-${attempt}`, result);
      if (result.rows.length === 6 && result.rows.every(x => x.valid && x.resolvedAddress === expected)) return;
    }
    throw Error("Mainland normal-DNS HTTPS validation did not converge to the selected address");
  };
  report.receipt = await applySelected({ before, selected: decision.selected, fallback: decision.fallback, read, patch, verify, save });
  report.outcome = report.receipt.outcome;
  report.measurementProbeTests = measurements.used();
  save("report", report);
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { config: { type: "string" }, out: { type: "string", default: "output/main-ingress-selection" },
    apply: { type: "boolean", default: false }, confirm: { type: "string" } } });
  if (values.apply && values.confirm !== hostname) throw Error("Apply requires approved scope and --confirm viprpg.org");
  const environment = { ...(fs.existsSync(".env.local") ? parseEnv(fs.readFileSync(".env.local", "utf8")) : {}), ...process.env };
  const source = values.config ? fs.readFileSync(values.config, "utf8") : environment.MAIN_INGRESS_CONFIG_JSON;
  if (!source) throw Error("Provide --config or MAIN_INGRESS_CONFIG_JSON");
  try {
    const report = await runSelection({ config: JSON.parse(source), apply: values.apply, out: values.out, environment });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    fs.mkdirSync(values.out, { recursive: true });
    fs.writeFileSync(path.join(values.out, "failure.json"), JSON.stringify({ at: new Date().toISOString(), error: error.message,
      instruction: "Check the receipt: measurement failures preserve DNS; apply/post-check failures attempt verified fallback without overwriting a later change" }, null, 2));
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
