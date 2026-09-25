import { readFile, writeFile } from "node:fs/promises";

const id = process.env.STATUS_D1_DATABASE_ID;
if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
  throw new Error("STATUS_D1_DATABASE_ID must be a D1 database UUID");
}

const config = await readFile("wrangler.jsonc", "utf8");
if (!config.includes("STATUS_DATABASE_ID")) {
  throw new Error("D1 ID placeholder was not found");
}
await writeFile("wrangler.jsonc", config.replace("STATUS_DATABASE_ID", id));
