import { isIP } from "node:net";

export const hostname = "viprpg.org";
export const routePattern = `https://${hostname}/*`;
export const ownerComment = "VIPRPG main ingress";
export const carriers = [4134, 4837, 9808];
export const holdMs = 12 * 60 * 60 * 1000;

export function validateIngressConfig(config, apply = false) {
  for (const field of ["accountId", "zoneId"])
    if (!/^[a-f0-9]{32}$/.test(config[field] ?? "")) throw Error(`Invalid ${field}`);
  if (config.hostname !== hostname || typeof config.worker !== "string" || !/^[a-z0-9-]+$/.test(config.worker))
    throw Error("Only the explicitly configured viprpg.org Worker is allowed");
  if (!/^\/api\/archive-versions\/\d+\/download\?profile=web-play-v2&download_source=origin$/.test(config.archivePath ?? ""))
    throw Error("Configure an existing published archive version with origin bypass");
  if (apply && !/^[a-f0-9]{32}$/.test(config.recordId ?? ""))
    throw Error("Register the approved DNS record ID before enabling apply");
  return config;
}

export function coveringRoutes(routes) {
  return routes.filter(({ pattern }) => {
    if (typeof pattern !== "string") return true;
    const host = pattern.replace(/^(?:https?|\*):\/\//i, "").split("/")[0];
    const expression = host.split("*").map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${expression}$`, "i").test(hostname);
  });
}

// Wrangler replaces Route IDs on deployment. Match the exact, unique main Route
// in the already verified zone, then use its current ID for scoped operations.
export function resolveMainRoute(routes, config) {
  const matches = coveringRoutes(routes);
  if (matches.length > 1 || matches.some(route => route.pattern !== routePattern || route.script !== config.worker ||
      !/^[a-f0-9]{32}$/i.test(route.id ?? "")))
    throw Error("Main Route identity or conflict mismatch");
  return matches[0];
}

export function assertOwnedState(state, config, now = Date.now()) {
  if (state.zone.id !== config.zoneId || state.zone.name !== hostname || state.zone.account?.id !== config.accountId || state.zone.status !== "active")
    throw Error("Zone/account identity mismatch");
  const records = state.dns.filter(x => ["A", "AAAA", "CNAME"].includes(x.type));
  const record = records[0];
  if (records.length !== 1 || record.id !== config.recordId || record.name !== hostname || record.type !== "A" ||
      record.proxied !== false || record.ttl !== 60 || record.comment !== ownerComment || isIP(record.content) !== 4)
    throw Error("Expected the single registered, owned gray A record with TTL 60; stop on extra A/AAAA/CNAME");
  if (state.domains.some(x => x.hostname === hostname)) throw Error("Managed Custom Domain is still present");
  if (!resolveMainRoute(state.routes, config))
    throw Error("Main Route identity or conflict mismatch");
  const certificate = state.certificates.some(pack => pack.status === "active" && pack.hosts?.includes(hostname) &&
    pack.certificates?.some(cert => cert.status === "active" && Date.parse(cert.expires_on) > now + 7 * 86400000));
  if (!certificate) throw Error("No active main-site certificate with at least seven days remaining");
  return record;
}

function validCoverage(round) {
  return Array.isArray(round?.rows) && round.rows.length === 6 &&
    carriers.every(asn => {
      const rows = round.rows.filter(x => x.country === "CN" && x.asn === asn);
      return rows.length === 2 && new Set(rows.map(x => x.city)).size === 2;
    }) && new Set(round.rows.map(x => x.probeKey)).size === 6;
}

export function healthyRounds(rounds) {
  return rounds?.length === 2 && rounds.every(round => validCoverage(round) &&
    round.rows.every(row => row.valid === true && Number.isFinite(row.totalMs) && row.totalMs > 0));
}

function responseTime(row) { return row.ingressMs ?? row.totalMs; }

function carrierTimes(round) {
  return carriers.map(asn => round.rows.filter(row => row.asn === asn).reduce((sum, row) => sum + responseTime(row), 0) / 2);
}

function score(rounds) {
  const values = rounds.flatMap(carrierTimes);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// A common outage, missing result or changed probe set cannot authorize a change.
export function chooseIngress(measured, current, modifiedOn, now = Date.now()) {
  if (Object.values(measured).some(rounds => rounds.some(round => round.rows?.some(row => row.status === "offline"))))
    return { change: false, reason: "measurement-probe-offline" };
  const baseline = measured[current];
  if (!baseline?.every(validCoverage) || baseline.length !== 2)
    return { change: false, reason: "incomplete-current-coverage" };
  const keys = baseline[0].rows.map(row => row.probeKey).sort().join("|");
  const matches = rounds => rounds.every(round => round.rows.map(row => row.probeKey).sort().join("|") === keys);
  if (!matches(baseline)) return { change: false, reason: "probe-set-changed" };
  const healthy = Object.entries(measured).filter(([target, rounds]) => target !== current && healthyRounds(rounds) && matches(rounds));
  const currentHealthy = healthyRounds(baseline);
  const failedKeys = round => round.rows.filter(row => !row.valid).map(row => row.probeKey).sort().join("|");
  if (!currentHealthy && (failedKeys(baseline[0]) !== failedKeys(baseline[1]) || !failedKeys(baseline[0])))
    return { change: false, reason: "current-failure-not-repeatable" };
  const eligible = healthy.filter(([, rounds]) => rounds.every((round, i) => {
    const healthyNodes = baseline[i].rows.filter(row => row.valid);
    if (!currentHealthy) return round.rows.every(row => responseTime(row) <= 5000) && healthyNodes.every(old => {
      const row = round.rows.find(x => x.probeKey === old.probeKey);
      return responseTime(row) <= Math.max(responseTime(old) * 1.3, responseTime(old) + 100);
    });
    const before = carrierTimes(baseline[i]);
    const after = carrierTimes(round);
    const beforeMean = before.reduce((a, b) => a + b) / 3;
    const afterMean = after.reduce((a, b) => a + b) / 3;
    return afterMean <= beforeMean * 0.8 && beforeMean - afterMean >= 50 &&
      after.every((time, index) => time <= Math.max(before[index] * 1.1, before[index] + 50)) &&
      round.rows.every(row => {
        const old = baseline[i].rows.find(x => x.probeKey === row.probeKey);
        return responseTime(row) <= Math.max(responseTime(old) * 1.3, responseTime(old) + 100);
      });
  })).sort((a, b) => score(a[1]) - score(b[1]));
  if (!eligible.length) return { change: false, reason: "no-stable-three-carrier-improvement", currentHealthy };
  const selected = eligible[0][0];
  // Recovery also needs a separately validated fallback, rather than reverting to a dead IP.
  const fallback = currentHealthy ? current : eligible.find(([target]) => target !== selected)?.[0];
  if (!fallback) return { change: false, reason: "no-healthy-rollback-address", currentHealthy };
  if (currentHealthy && modifiedOn && (!Number.isFinite(Date.parse(modifiedOn)) || now - Date.parse(modifiedOn) < holdMs))
    return { change: false, reason: "minimum-twelve-hour-hold", recommendation: selected, currentHealthy };
  return { change: true, reason: currentHealthy ? "stable-improvement" : "verified-recovery", selected, fallback,
    currentHealthy, currentMs: currentHealthy ? score(baseline) : null, selectedMs: score(measured[selected]) };
}

export function sameRecord(left, right) {
  return ["id", "name", "type", "content", "proxied", "ttl", "comment", "modified_on"].every(key => left[key] === right[key]);
}

// Separate from transport: test that a failed check can never overwrite a later human change.
export async function applySelected({ before, selected, fallback, read, patch, verify, save }) {
  if (isIP(selected) !== 4 || isIP(fallback) !== 4 || selected === fallback) throw Error("Invalid selection/fallback");
  const fresh = await read();
  if (!sameRecord(before, fresh)) throw Error("DNS changed during measurement; discard stale selection");
  await save("before-write", { before, selected, fallback });
  let acknowledged;
  try {
    // Cloudflare has no conditional DNS PATCH here; read/compare plus job concurrency reduces, but does not eliminate, external-writer races.
    acknowledged = await patch(selected);
    const after = await read();
    if (after.content !== selected) throw Error("DNS read-back mismatch");
    if (!acknowledged || !sameRecord(acknowledged, after)) throw Error("DNS changed after PATCH acknowledgement");
    await save("after-write", { before, after, fallback });
    await verify(selected);
    return { outcome: "applied", before: before.content, after: selected, fallback };
  } catch (error) {
    if (!acknowledged) throw Error(`PATCH outcome unconfirmed; inspect DNS before any manual recovery: ${error.message}`);
    const actual = await read();
    if (actual.content !== selected || !sameRecord(acknowledged, actual))
      throw Error(`Update failed; DNS changed since this write, refusing rollback: ${error.message}`);
    await patch(fallback);
    const restored = await read();
    if (restored.content !== fallback) throw Error("Rollback read-back failed");
    await save("rollback", { original: before.content, fallback, restored, failure: error.message });
    await verify(fallback);
    throw Error(`Selection failed; verified fallback ${fallback} restored: ${error.message}`);
  }
}
