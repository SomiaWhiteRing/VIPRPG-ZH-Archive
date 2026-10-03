import { runWrangler } from "./run-wrangler.mjs";
import { readFileSync, writeFileSync } from "node:fs";

await runWrangler(["types", "--env-interface", "CloudflareEnv", "cloudflare-env.d.ts"], {
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
});
const output = new URL("../cloudflare-env.d.ts", import.meta.url);
writeFileSync(output, readFileSync(output, "utf8").replace(/[\t ]+$/gm, ""));
