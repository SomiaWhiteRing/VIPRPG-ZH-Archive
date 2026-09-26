import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parse } from "jsonc-parser";

export const deploymentOrigins = {
  production: "https://viprpg.org",
  staging: "https://staging.viprpg.org",
};

export function readConfig(path = "wrangler.jsonc") {
  const errors = [];
  const config = parse(readFileSync(path, "utf8"), errors, { allowTrailingComma: true });
  if (errors.length || !config || Array.isArray(config) || typeof config !== "object")
    throw new Error(`Invalid Wrangler configuration: ${path}`);
  return config;
}

export function selectDeployment(config, environment) {
  if (!Object.hasOwn(deploymentOrigins, environment))
    throw new Error("Choose --env staging or --env production explicitly");
  const target = environment === "production" ? config : config.env?.staging;
  if (!target) throw new Error(`Missing ${environment} configuration`);
  return target;
}

export function validateDeployment(target, environment, directory = ".") {
  const origin = deploymentOrigins[environment];
  if (!origin) throw new Error("Unknown deployment environment");
  const concrete = (value) => typeof value === "string" && value.length > 0 && !/[<>]/.test(value);
  if (!concrete(target.name)) throw new Error("Configure the target Worker name");
  if (target.vars?.APP_ORIGIN !== origin || target.vars?.SITE_NOINDEX !== String(environment === "staging"))
    throw new Error(`${environment} requires APP_ORIGIN=${origin} and the matching SITE_NOINDEX`);
  if (target.workers_dev !== false || target.preview_urls !== false ||
      target.routes?.length !== 1 || target.routes[0].pattern !== new URL(origin).hostname ||
      target.routes[0].custom_domain !== true)
    throw new Error(`Configure only the ${origin} custom domain; disable workers_dev and preview_urls`);
  const database = target.d1_databases?.find((binding) => binding.binding === "DB");
  const bucket = target.r2_buckets?.find((binding) => binding.binding === "ARCHIVE_BUCKET");
  if (target.d1_databases?.length !== 1 || target.r2_buckets?.length !== 1 ||
      !concrete(database?.database_name) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(database?.database_id ?? "") ||
      database.database_id === "00000000-0000-0000-0000-000000000001" || !concrete(bucket?.bucket_name))
    throw new Error("Configure real DB and ARCHIVE_BUCKET resource identities");
  if (resolve(directory, database.migrations_dir ?? "migrations") !== resolve("migrations"))
    throw new Error("DB must use the repository migrations directory");
  if (database.migrations_table && database.migrations_table !== "d1_migrations")
    throw new Error("DB must use the d1_migrations ledger");
  const namespaces = ["AUTH_EMAIL_RATE_LIMITER", "VIEW_RATE_LIMITER"].map((name) =>
    target.ratelimits?.find((binding) => binding.name === name)?.namespace_id);
  if (namespaces.some((id) => !/^\d+$/.test(id ?? "")) || new Set(namespaces).size !== namespaces.length)
    throw new Error("Configure distinct numeric rate-limit namespaces");
  const views = target.durable_objects?.bindings?.find((binding) => binding.name === "VIEW_STATS");
  if (views?.class_name !== "ViewStats" || views.script_name)
    throw new Error("VIEW_STATS must belong to this Worker");
  if (target.vars.EMAIL_FROM !== "noreply@viprpg.org" ||
      !target.send_email?.find((binding) => binding.name === "EMAIL")?.allowed_sender_addresses?.includes(target.vars.EMAIL_FROM))
    throw new Error("Configure the noreply@viprpg.org EMAIL sender binding");
  return target;
}

export function validateIsolation(config) {
  const staging = config.env?.staging;
  if (!staging) return;
  for (const [left, right, label] of [
    [config.name, staging.name, "Worker"],
    [config.d1_databases?.find((binding) => binding.binding === "DB")?.database_id, staging.d1_databases?.find((binding) => binding.binding === "DB")?.database_id, "D1"],
    [config.r2_buckets?.find((binding) => binding.binding === "ARCHIVE_BUCKET")?.bucket_name, staging.r2_buckets?.find((binding) => binding.binding === "ARCHIVE_BUCKET")?.bucket_name, "R2"],
  ]) if (left && left === right) throw new Error(`Production and staging share ${label}`);
  const productionIds = new Set(config.ratelimits?.map((binding) => binding.namespace_id));
  if (staging.ratelimits?.some((binding) => productionIds.has(binding.namespace_id)))
    throw new Error("Production and staging share a rate-limit namespace");
}

export function migrationManifest() {
  const files = readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();
  if (!files.length || files.some((name) => !/^\d{4}_[a-z0-9_]+\.sql$/i.test(name)) ||
      new Set(files.map((name) => name.slice(0, 4))).size !== files.length)
    throw new Error("Migrations require distinct four-digit sequence numbers and SQL filenames");
  return files.map((name) => {
    const sql = readFileSync(resolve("migrations", name), "utf8");
    return { name, sha256: createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex") };
  });
}

export function deploymentSummary(target, environment) {
  return {
    environment, origin: target.vars.APP_ORIGIN, worker: target.name,
    database: target.d1_databases.map(({ binding, database_name, database_id }) => ({ binding, database_name, database_id })),
    buckets: target.r2_buckets.map(({ binding, bucket_name }) => ({ binding, bucket_name })),
    migrations: migrationManifest(),
  };
}

export async function confirmProduction(confirmation, operation) {
  if (confirmation === "viprpg.org") return;
  if (confirmation !== undefined || !process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(`${operation} requires explicit confirmation: --confirm viprpg.org (after owner approval)`);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(`${operation}: type viprpg.org to confirm the plan above: `);
    if (answer.trim() !== "viprpg.org") throw new Error("Production operation cancelled");
  } finally { terminal.close(); }
}
