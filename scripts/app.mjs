import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const [command = "dev", ...args] = process.argv.slice(2);
const environmentIndex = args.indexOf("--env");
const environment =
  environmentIndex < 0 ? undefined : args.splice(environmentIndex, 2)[1];
if (environmentIndex >= 0 && environment !== "staging")
  throw new Error("Use --env staging, or omit --env for production");
const env = { ...process.env, CLOUDFLARE_ENV: environment ?? "" };
function run(cli, params) {
  const result = spawnSync(process.execPath, [resolve(cli), ...params], {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const router = "node_modules/@react-router/dev/bin.cjs";
const vite = "node_modules/vite/bin/vite.js";
if (command === "dev") run(router, ["dev", ...args]);
else if (command === "typegen") run(router, ["typegen"]);
else if (command === "build") run(router, ["build"]);
else if (command === "preview" || command === "deploy") {
  run(router, ["build"]);
  if (command === "preview") run(vite, ["preview", ...args]);
  else
    run("node_modules/wrangler/bin/wrangler.js", [
      "deploy",
      "--config",
      "build/server/wrangler.json",
      ...args,
    ]);
} else throw new Error(`Unknown app command: ${command}`);
