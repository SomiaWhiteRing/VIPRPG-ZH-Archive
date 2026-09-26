import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { readConfig, validateDeployment, validateIsolation, deploymentSummary, confirmProduction, migrationManifest } from "./deployment-config.mjs";

const { values } = parseArgs({ options: {
  plan: { type: "boolean" }, verify: { type: "boolean" }, apply: { type: "boolean" }, confirm: { type: "string" },
} });
if ([values.plan, values.verify, values.apply].filter(Boolean).length > 1)
  throw new Error("Choose only one of --plan, --verify or --apply");
const config = validateDeployment(readConfig(), "production");
validateIsolation(config);
const cli = resolve("node_modules/wrangler/bin/wrangler.js");
const env = { ...process.env, CLOUDFLARE_ENV: "", CI: "true", WRANGLER_SEND_METRICS: "false" };
function query(sql) {
  const result = spawnSync(process.execPath, [cli, "d1", "execute", "DB", "--remote", "--config", "wrangler.jsonc", "--json", "--command", sql], {
    env, encoding: "utf8", windowsHide: true, timeout: 60000,
  });
  if (result.error || result.status !== 0) throw new Error(`Cannot read production migration ledger: ${result.error?.message ?? result.stderr}`);
  const response = JSON.parse(result.stdout);
  if (!Array.isArray(response) || response.some((item) => item.success !== true)) throw new Error("Invalid D1 query result");
  return response.flatMap((item) => item.results);
}
// Wrangler migrations list creates its ledger; use SELECT for a genuinely read-only plan.
const hasLedger = query("SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'").length > 0;
const applied = hasLedger ? query("SELECT name FROM d1_migrations ORDER BY id").map((row) => row.name) : [];
const migrations = migrationManifest();
if (applied.some((name, index) => migrations[index]?.name !== name))
  throw new Error("Production migration history differs from this candidate; reconcile its baseline before deploying");
if (!hasLedger && query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'").length)
  throw new Error("Production contains tables without a migration ledger; review its existing data before initialization");
const pending = migrations.filter((migration) => !applied.includes(migration.name));
console.log(JSON.stringify({ ...deploymentSummary(config, "production"), applied, pending }, null, 2));
if (values.verify && pending.length) throw new Error("Pending production migrations require a separately approved --apply-migrations release or db:production:migrate -- --apply");
if (values.apply && pending.length) {
  await confirmProduction(values.confirm, "Apply the production D1 migrations listed above");
  const result = spawnSync(process.execPath, [cli, "d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.jsonc"], {
    env, stdio: "inherit", windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
