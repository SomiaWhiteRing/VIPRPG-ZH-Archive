import { spawnSync } from "node:child_process";

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

process.exit(result.status ?? 1);
