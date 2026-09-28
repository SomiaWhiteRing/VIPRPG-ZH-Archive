import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isSharedPlayerPath } from "../lib/archive/shared-player.ts";

// Offline, reviewable projection backfill. Never connects to or writes a database.
export function playerSizeBackfillSql(bytes) {
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.schema !== "viprpg-archive.manifest.v1" || !Array.isArray(manifest.files)) {
    throw new Error("Invalid archive manifest");
  }
  let total = 0;
  let player = 0;
  for (const file of manifest.files) {
    if (typeof file.path !== "string" || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error("Invalid manifest file");
    total += file.size;
    if (isSharedPlayerPath(file.path)) player += file.size;
  }
  if (!Number.isSafeInteger(total)) throw new Error("Invalid manifest total");
  const sha = createHash("sha256").update(bytes).digest("hex");
  return `UPDATE archive_versions SET embedded_player_size_bytes=${player} WHERE manifest_sha256='${sha}' AND total_size_bytes=${total};`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [output, ...paths] = process.argv.slice(2);
  if (!output || !paths.length) throw new Error("Usage: node scripts/archive-player-size-backfill.mjs output.sql manifest.json [...]");
  const sql = [...new Set(paths.map((path) => playerSizeBackfillSql(readFileSync(path))))];
  writeFileSync(output, sql.join("\n") + "\n");
  console.log(`Prepared ${sql.length} manifest projections: ${output}`);
}
