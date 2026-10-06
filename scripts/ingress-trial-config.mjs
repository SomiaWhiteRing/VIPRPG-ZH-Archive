import fs from "node:fs";

const productionOrigin = "https://viprpg.org";
const trialRoutePattern = `${productionOrigin}/*`;
const maximumTrialMs = 24 * 60 * 60 * 1000 + 60_000;
const deploymentReserveMs = 10 * 60 * 1000;

export function readTrialConfig(env = process.env) {
  const localPath = "output/main-ingress-trial/config.json";
  const source = env.MAIN_INGRESS_CONFIG_JSON || (fs.existsSync(localPath) ? fs.readFileSync(localPath, "utf8") : null);
  if (source === null) return null;
  try {
    const config = JSON.parse(source);
    if (!config || typeof config !== "object" || Array.isArray(config)) throw Error();
    return config;
  } catch {
    throw Error("Invalid main ingress trial configuration JSON");
  }
}

function timestamp(value, field) {
  const match = typeof value === "string" && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const parsed = match ? Date.parse(value) : NaN;
  if (!match || !Number.isFinite(parsed)) throw Error(`Invalid trial ${field} ISO timestamp`);
  const offset = match[3] === "Z" ? 0 : (match[3][0] === "+" ? 1 : -1) *
    (Number(match[3].slice(1, 3)) * 60 + Number(match[3].slice(4, 6))) * 60_000;
  if (new Date(parsed + offset).toISOString() !== `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`)
    throw Error(`Invalid trial ${field} calendar date`);
  return parsed;
}

export function trialState(config, now = Date.now()) {
  if (config?.trial === undefined || config?.trial === null) return null;
  const trial = config.trial;
  if (!trial || typeof trial !== "object" || Array.isArray(trial) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(trial.id ?? ""))
    throw Error("Trial requires a valid UUID identity");
  if (!Number.isFinite(now)) throw Error("Invalid trial clock");
  const startsAt = timestamp(trial.startsAt, "startsAt");
  const expiresAt = timestamp(trial.expiresAt, "expiresAt");
  if (expiresAt <= startsAt || expiresAt - startsAt > maximumTrialMs)
    throw Error("Trial must last longer than zero and no more than 24 hours plus one minute");
  return { active: startsAt <= now && now < expiresAt, expired: now >= expiresAt, expiresAt };
}

function assertIdentity(target, config) {
  if (target.vars?.APP_ORIGIN !== productionOrigin || config.hostname !== "viprpg.org" ||
      typeof config.worker !== "string" || !config.worker || target.name !== config.worker)
    throw Error("Trial route must target the configured viprpg.org production Worker");
  for (const field of ["zoneId", "accountId"])
    if (typeof config[field] !== "string" || !/^[a-f0-9]{32}$/i.test(config[field])) throw Error(`Invalid trial ${field}`);
}

export function applyTrialRoute(target, config, now = Date.now()) {
  const state = trialState(config, now);
  if (!state?.active) return target;
  assertIdentity(target, config);
  target.routes = [{ pattern: trialRoutePattern, zone_id: config.zoneId }];
  return target;
}

export function assertTrialDeployment(target, config, now = Date.now()) {
  const route = target.routes?.find(candidate => candidate?.pattern === trialRoutePattern && candidate.custom_domain !== true);
  if (!route) return target;
  const state = trialState(config, now);
  if (!state?.active || state.expiresAt - now < deploymentReserveMs)
    throw Error("Trial Route deployment requires an active trial with at least ten minutes remaining");
  assertIdentity(target, config);
  if (target.routes.length !== 1 || route.zone_id !== config.zoneId)
    throw Error("Trial deployment must retain its single approved HTTPS Route and zone");
  return target;
}
