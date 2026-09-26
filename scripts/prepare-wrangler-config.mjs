import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parse } from "jsonc-parser";
import { readConfig, selectDeployment, validateDeployment, validateIsolation } from "./deployment-config.mjs";

const { values } = parseArgs({ options: { env: { type: "string" } } });
const template = readConfig("wrangler.example.jsonc");
const base = selectDeployment(template, values.env);
const source = process.env.WRANGLER_CONFIG_JSONC;
if (!source) throw new Error("WRANGLER_CONFIG_JSONC is required");
const errors = [];
const resources = parse(source, errors, { allowTrailingComma: true });
if (errors.length || !resources || Array.isArray(resources) || typeof resources !== "object")
  throw new Error("Invalid WRANGLER_CONFIG_JSONC");
// Select from a full local config, or use an environment's own resource object.
const selected = values.env === "staging" && resources.env ? resources.env.staging : resources;
if (!selected) throw new Error(`Missing deployment environment: ${values.env}`);
const infrastructure = ["name", "routes", "workers_dev", "preview_urls", "d1_databases", "r2_buckets",
  "send_email", "ratelimits", "vars", "triggers", "observability", "limits", "placement"];
const target = structuredClone(base);
for (const key of infrastructure) if (Object.hasOwn(selected, key)) target[key] = selected[key];
for (const required of base.ratelimits) {
  const actual = target.ratelimits?.find((binding) => binding.name === required.name);
  if (actual) actual.simple = required.simple;
}
validateDeployment(target, values.env);
if (resources.env) validateIsolation(resources);
// Vite validates the top-level config even when staging is selected. Leave no
// remote bindings in that unselected config, rather than invalid placeholders.
if (values.env === "staging") {
  template.env.staging = target;
  template.name = "viprpg-deployment-disabled";
  for (const key of ["d1_databases", "r2_buckets", "send_email", "ratelimits", "routes"]) template[key] = [];
  template.durable_objects = { bindings: [] };
  template.triggers = { crons: [] };
  template.vars = { APP_ORIGIN: "http://127.0.0.1:3000", EMAIL_FROM: "noreply@viprpg.org", SITE_NOINDEX: "true" };
} else {
  delete target.env;
  Object.assign(template, target);
  delete template.env;
}
writeFileSync("wrangler.jsonc", `${JSON.stringify(template, null, 2)}\n`);
console.log(`Prepared ${values.env}: ${target.name} at ${target.vars.APP_ORIGIN}`);
