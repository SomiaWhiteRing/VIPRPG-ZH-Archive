import fs from "node:fs";
import { parseArgs, parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { confirmProduction, readConfig, selectDeployment, validateDeployment } from "./deployment-config.mjs";

const { values } = parseArgs({ options: { plan: { type: "boolean" }, confirm: { type: "string" } } });
const hostname = "download.viprpg.org";
const worker = "viprpg-download";
const ip = "162.159.140.245";
const pattern = `https://${hostname}/*`;
const comment = "VIPRPG download relay";
const environment = { ...(fs.existsSync(".env.local") ? parseEnv(fs.readFileSync(".env.local", "utf8")) : {}), ...process.env };
const account = environment.CLOUDFLARE_ACCOUNT_ID?.trim();
const token = environment.CLOUDFLARE_API_TOKEN?.trim();
if (!account || !token) throw new Error("Cloudflare account and deployment token are required");
const target = validateDeployment(selectDeployment(readConfig(), "production"), "production");
const source = fs.readFileSync("worker/download-relay.mjs", "utf8");

async function api(path, method = "GET", body) {
  const multipart = body instanceof FormData;
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(!multipart ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  const raw = await r.text();
  if (r.ok && !raw.trim()) return null;
  const data = JSON.parse(raw);
  if (!r.ok || !data.success) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(data.errors)}`);
  return data.result;
}

const zones = await api("/zones?name=viprpg.org&status=active");
if (zones.length !== 1) throw new Error("Expected exactly one active viprpg.org zone");
if (zones[0].account?.id !== account) throw new Error("Download zone belongs to a different Cloudflare account");
const zone = zones[0].id;
const dns = await api(`/zones/${zone}/dns_records?name=${hostname}&per_page=100`);
const routes = await api(`/zones/${zone}/workers/routes`);
const domains = await api(`/accounts/${account}/workers/domains`);
const scripts = await api(`/accounts/${account}/workers/scripts`);
if (!scripts.some(x => x.id === target.name)) throw new Error("Configured production source Worker does not exist");
if (!domains.some(x => x.hostname === "viprpg.org" && x.service === target.name && x.enabled)) throw new Error("Production Custom Domain does not target the configured source Worker");
if (domains.some(x => x.hostname === hostname)) throw new Error("Download hostname already has a managed Custom Domain");
if (dns.length && (dns.length !== 1 || dns[0].type !== "A" || dns[0].proxied || dns[0].comment !== comment)) throw new Error("Download DNS is not owned by this relay");
const route = routes.find(x => x.pattern === pattern);
if (route && route.script !== worker) throw new Error("Download Route belongs to another Worker");
if (routes.some(x => x.pattern.includes(hostname) && x.pattern !== pattern)) throw new Error("Conflicting download Route");
if (scripts.some(x => x.id === worker)) {
  const settings = await api(`/accounts/${account}/workers/scripts/${worker}/settings`);
  if (settings.bindings?.length !== 1 || settings.bindings[0].type !== "service" || settings.bindings[0].name !== "ARCHIVE_SOURCE" || settings.bindings[0].service !== target.name)
    throw new Error("Existing relay Worker has unexpected bindings");
}
const plan = {
  worker, hostname, ip, dnsProxied: false, route: pattern, sourceWorker: target.name,
  sourceOrigin: target.vars.APP_ORIGIN,
  moduleSha256: createHash("sha256").update(source).digest("hex"),
  bindings: [{ type: "service", name: "ARCHIVE_SOURCE", service: target.name }],
  existing: { dns: dns[0]?.id ?? null, route: route?.id ?? null, worker: scripts.some(x => x.id === worker) },
  impact: "New public download-only ingress; existing apex DNS, main Worker bindings and data remain unchanged",
  rollback: "Disable native routing in the source and deploy previous source/installer commit; keep origin downloads available",
};
console.log(JSON.stringify(plan, null, 2));
if (!values.plan) {
  const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", windowsHide: true });
  if (status.status !== 0 || status.stdout.trim()) throw new Error("Commit the download relay candidate before deploying");
  await confirmProduction(values.confirm, `Deploy ${hostname} download ingress`);
  fs.mkdirSync("output/download-relay-deployment", { recursive: true });
  fs.writeFileSync("output/download-relay-deployment/plan.json", JSON.stringify({ ...plan, beforeDns: dns, beforeRoute: route }, null, 2));
  const form = new FormData();
  form.set("metadata", JSON.stringify({ main_module: "download-relay.mjs", compatibility_date: "2026-04-30", bindings: plan.bindings, observability: { enabled: true, head_sampling_rate: 1 } }));
  form.set("download-relay.mjs", new Blob([source], { type: "application/javascript+module" }), "download-relay.mjs");
  const deployed = await api(`/accounts/${account}/workers/scripts/${worker}`, "PUT", form);
  await api(`/accounts/${account}/workers/scripts/${worker}/subdomain`, "POST", { enabled: false, previews_enabled: false });
  const dnsRecord = await api(`/zones/${zone}/dns_records${dns.length ? `/${dns[0].id}` : ""}`, dns.length ? "PATCH" : "POST", { type: "A", name: hostname, content: ip, proxied: false, ttl: 60, comment });
  const workerRoute = route ?? await api(`/zones/${zone}/workers/routes`, "POST", { pattern, script: worker });
  const actualDns = await api(`/zones/${zone}/dns_records/${dnsRecord.id}`);
  const actualRoutes = await api(`/zones/${zone}/workers/routes`);
  if (actualDns.content !== ip || actualDns.proxied || !actualRoutes.some(x => x.id === workerRoute.id && x.script === worker)) throw new Error("Relay resource read-back mismatch");
  fs.writeFileSync("output/download-relay-deployment/result.json", JSON.stringify({ deployedAt: new Date().toISOString(), ...plan, zoneId: zone, deploymentId: deployed.deployment_id, dns: actualDns, route: workerRoute }, null, 2));
  console.log(`Deployed ${hostname} using service ${target.name}`);
}
