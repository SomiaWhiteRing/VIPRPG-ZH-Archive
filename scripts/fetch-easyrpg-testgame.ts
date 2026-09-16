import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { zipSync } from "fflate";
import { classifyArchivePath } from "../lib/archive/file-policy";

// Official EasyRPG test suite; pin the revision so a regression is reproducible.
const revision = "4bbedb73492c80b79d8290e0b06ea86875b0bdc8";
const suite = "TestGame-EasyRPG/";
const destination = resolve(process.argv[2] ?? "output/easyrpg/testgame.zip");
type Entry = { type: string; path: string; sha: string };

async function download(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "VIPRPG-regression" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response;
}

const tree = (await (
  await download(
    `https://api.github.com/repos/EasyRPG/TestGame/git/trees/${revision}?recursive=1`,
  )
).json()) as { tree: Entry[]; truncated: boolean };
assert.equal(tree.truncated, false);
const entries = tree.tree.filter(
  (entry) => entry.type === "blob" && entry.path.startsWith(suite),
);
const files: Record<string, Uint8Array> = {};
const included = entries.filter(
  (entry) =>
    !/\.(exe|dll)$/i.test(entry.path) &&
    classifyArchivePath(entry.path.slice(suite.length)).included,
);
for (let index = 0; index < included.length; index += 4) {
  const results = await Promise.allSettled(
    included.slice(index, index + 4).map(async (entry) => {
      const response = await download(
        `https://raw.githubusercontent.com/EasyRPG/TestGame/${revision}/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      const hash = createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      assert.equal(hash, entry.sha, `Git blob hash: ${entry.path}`);
      files[entry.path.slice(suite.length)] = bytes;
    }),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}
assert.ok(files["RPG_RT.ldb"] && files["RPG_RT.lmt"]);
mkdirSync(dirname(destination), { recursive: true });
const zip = zipSync(files, { level: 0 });
writeFileSync(destination, zip);
writeFileSync(
  `${destination}.json`,
  JSON.stringify(
    {
      repository: "https://github.com/EasyRPG/TestGame",
      revision,
      suite,
      license: `https://github.com/EasyRPG/TestGame/blob/${revision}/COPYING`,
      zipSha256: createHash("sha256").update(zip).digest("hex"),
      included,
      excluded: entries
        .filter((entry) => !included.includes(entry))
        .map((entry) => entry.path),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Verified ${included.length} official game data files at ${revision}: ${destination}`,
);
