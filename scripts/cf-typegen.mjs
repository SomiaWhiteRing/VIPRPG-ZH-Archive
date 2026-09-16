import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const result = spawnSync(
  "npx wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts",
  {
    env: {
      ...process.env,
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    },
    shell: true,
    stdio: "inherit",
  },
);

if (result.status === 0) {
  const output = new URL("../cloudflare-env.d.ts", import.meta.url);
  writeFileSync(output, readFileSync(output, "utf8").replace(/[\t ]+$/gm, ""));
}

process.exit(result.status ?? 1);
