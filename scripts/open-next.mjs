import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const env = { ...process.env };

if (process.platform === "win32") {
  const tempDir = env.OPEN_NEXT_TMP_DIR || "C:\\tmp\\viprpg-open-next";
  const preload = new URL("./win32-fs-cp-sync-workaround.mjs", import.meta.url);
  mkdirSync(tempDir, { recursive: true });
  env.TEMP = tempDir;
  env.TMP = tempDir;
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import ${JSON.stringify(preload.href)}`]
    .filter(Boolean)
    .join(" ");
}

const args = process.argv.slice(2).map((arg) => JSON.stringify(arg)).join(" ");
const result = spawnSync(`npx opennextjs-cloudflare ${args}`, {
  env,
  shell: true,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
