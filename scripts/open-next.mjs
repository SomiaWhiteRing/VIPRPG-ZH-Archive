import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const env = { ...process.env };

if (process.platform === "win32") {
  const tempDir = env.OPEN_NEXT_TMP_DIR || "C:\\tmp\\viprpg-open-next";
  mkdirSync(tempDir, { recursive: true });
  env.TEMP = tempDir;
  env.TMP = tempDir;
}

const args = process.argv.slice(2).map((arg) => JSON.stringify(arg)).join(" ");
const result = spawnSync(`npx opennextjs-cloudflare ${args}`, {
  env,
  shell: true,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
