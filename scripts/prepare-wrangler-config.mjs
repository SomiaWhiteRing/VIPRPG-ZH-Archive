import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "jsonc-parser";

// Deployment resources stay private; application entry and asset routing follow the repository.
const source = process.env.WRANGLER_CONFIG_JSONC;
if (!source) throw new Error("WRANGLER_CONFIG_JSONC is required");
const errors = [];
const resourceConfig = parse(source, errors, { allowTrailingComma: true });
if (errors.length || !resourceConfig || typeof resourceConfig !== "object")
  throw new Error("Invalid WRANGLER_CONFIG_JSONC");
const template = parse(
  readFileSync(new URL("../wrangler.example.jsonc", import.meta.url), "utf8"),
);
const infrastructure = [
  "name",
  "routes",
  "workers_dev",
  "preview_urls",
  "d1_databases",
  "r2_buckets",
  "send_email",
  "ratelimits",
  "vars",
  "triggers",
  "observability",
  "limits",
  "placement",
];
function configure(resources, base) {
  const result = { ...base };
  for (const key of infrastructure)
    if (key in resources) result[key] = resources[key];
  return result;
}
const result = configure(resourceConfig, template);
result.env = Object.fromEntries(
  Object.entries(template.env).map(([name, base]) => {
    const resources = resourceConfig.env?.[name];
    if (!resources) throw new Error(`Missing deployment environment: ${name}`);
    return [name, configure(resources, base)];
  }),
);
writeFileSync(
  new URL("../wrangler.jsonc", import.meta.url),
  `${JSON.stringify(result, null, 2)}\n`,
);
