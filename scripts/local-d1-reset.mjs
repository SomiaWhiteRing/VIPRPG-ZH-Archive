import { rmSync } from "node:fs";
import { join } from "node:path";
import { runWrangler } from "./run-wrangler.mjs";

const databaseName = process.env.LOCAL_D1_DATABASE || "viprpg-archive-prod";
// ponytail: delete the generated local D1 directory so cyclic foreign keys do not
// make a table-by-table reset unreliable; this never touches remote databases.
rmSync(join(".wrangler", "state", "v3", "d1"), { recursive: true, force: true });

await runWrangler([
  "d1",
  "migrations",
  "apply",
  databaseName,
  "--local",
]);
