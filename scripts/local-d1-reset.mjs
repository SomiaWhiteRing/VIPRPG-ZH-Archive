import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const databaseName = process.env.LOCAL_D1_DATABASE || "viprpg-archive-prod";
// ponytail: delete the generated local D1 directory so cyclic foreign keys do not
// make a table-by-table reset unreliable; this never touches remote databases.
rmSync(join(".wrangler", "state", "v3", "d1"), { recursive: true, force: true });

run("npx", [
  "wrangler",
  "d1",
  "migrations",
  "apply",
  databaseName,
  "--local",
]);

function run(command, args) {
  const result = spawnSync(command, args, {
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
