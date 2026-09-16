import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "jsonc-parser";

const config = parse(
  readFileSync(new URL("../wrangler.example.jsonc", import.meta.url), "utf8"),
);

// Keep the template's bindings while replacing deployment placeholders for local CI.
for (const [name, environment] of [
  ["local", config],
  ...Object.entries(config.env),
]) {
  environment.name = `viprpg-verify-${name}`;
  for (const binding of environment.d1_databases) {
    binding.database_name = `${environment.name}-${binding.binding.toLowerCase()}`;
    binding.database_id = "00000000-0000-0000-0000-000000000001";
    binding.remote = false;
  }
  for (const binding of environment.r2_buckets) {
    binding.bucket_name = `${environment.name}-archive`;
    binding.remote = false;
  }
  for (const [index, binding] of environment.ratelimits.entries()) {
    binding.namespace_id = String(index + 1);
  }
  environment.vars.APP_ORIGIN = "http://127.0.0.1:3000";
}

writeFileSync(
  process.argv[2] ?? new URL("../wrangler.jsonc", import.meta.url),
  `${JSON.stringify(config, null, 2)}\n`,
);
