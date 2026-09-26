import { rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { runWrangler } from "./run-wrangler.mjs";

const databaseName = process.env.LOCAL_D1_DATABASE || "DB";
// Reset content IDs and their anonymous counters together. R2 is retained.
const localState = resolve(".wrangler", "state", "v3");
for (const kind of ["d1", "do"]) {
  const target = resolve(localState, kind);
  if (!target.startsWith(localState + sep)) throw new Error("Invalid local reset path");
  rmSync(target, { recursive: true, force: true });
}

await runWrangler([
  "d1",
  "migrations",
  "apply",
  databaseName,
  "--local",
]);
