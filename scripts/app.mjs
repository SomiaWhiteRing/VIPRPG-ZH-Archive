import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { readConfig, selectDeployment, validateDeployment, validateIsolation, deploymentSummary, confirmProduction } from "./deployment-config.mjs";

const [command = "dev", ...args] = process.argv.slice(2);
const { values, positionals } = parseArgs({ args, strict: false, allowPositionals: true, options: {
  env: { type: "string" }, plan: { type: "boolean" }, confirm: { type: "string" },
  "apply-migrations": { type: "boolean" },
} });
const environment = values.env;
if (environment !== undefined && !["staging", "production"].includes(environment))
  throw new Error("Choose --env staging or --env production");
const env = { ...process.env, CLOUDFLARE_ENV: environment === "staging" ? "staging" : "" };
function run(cli, params) {
  const result = spawnSync(process.execPath, [resolve(cli), ...params], { env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const router = "node_modules/@react-router/dev/bin.cjs";
const vite = "node_modules/vite/bin/vite.js";
const passthrough = args.filter((arg) => !arg.startsWith("--env="));
const environmentIndex = passthrough.indexOf("--env");
if (environmentIndex >= 0) passthrough.splice(environmentIndex, 2);
if (command === "dev") run(router, ["dev", ...passthrough]);
else if (command === "typegen") run(router, ["typegen"]);
else if (command === "build") run(router, ["build"]);
else if (command === "preview") {
  run(router, ["build"]);
  run(vite, ["preview", ...passthrough]);
} else if (command === "deploy") {
  if (positionals.length || Object.keys(values).some((key) => !["env", "plan", "confirm", "apply-migrations"].includes(key)))
    throw new Error("Deploy accepts only --env, --plan, --confirm and --apply-migrations");
  const config = readConfig();
  const target = validateDeployment(selectDeployment(config, environment), environment);
  validateIsolation(config);
  const summary = deploymentSummary(target, environment);
  console.log(JSON.stringify({ ...summary, applyMigrations: values["apply-migrations"] === true }, null, 2));
  if (!values.plan) {
    if (environment === "production") {
      const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", windowsHide: true });
      if (status.status !== 0 || status.stdout.trim()) throw new Error("Commit the production candidate before deploying");
    }
    run(router, ["build"]);
    // Vite has already selected the environment; never append another --env here.
    env.CLOUDFLARE_ENV = "";
    const built = readConfig("build/server/wrangler.json");
    validateDeployment(built, environment, "build/server");
    if (JSON.stringify(deploymentSummary(built, environment)) !== JSON.stringify(summary))
      throw new Error("Built Worker resources differ from the selected deployment");
    if (environment === "production") {
      run("scripts/production-migrations.mjs", ["--plan"]);
      await confirmProduction(values.confirm, values["apply-migrations"] ? "Deploy production and apply pending migrations" : "Deploy production code only");
      run("scripts/production-migrations.mjs", values["apply-migrations"] ? ["--apply", "--confirm", "viprpg.org"] : ["--verify"]);
    } else if (values["apply-migrations"]) {
      run("node_modules/wrangler/bin/wrangler.js", ["d1", "migrations", "apply", "DB", "--remote", "--env", "staging", "--config", "wrangler.jsonc"]);
    }
    run("node_modules/wrangler/bin/wrangler.js", ["deploy", "--config", "build/server/wrangler.json"]);
  }
} else throw new Error(`Unknown app command: ${command}`);
