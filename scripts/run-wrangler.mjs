import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const wranglerCli = fileURLToPath(new URL("../node_modules/wrangler/wrangler-dist/cli.js", import.meta.url));

export function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...args], {
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0 && signal === null) {
        resolve();
        return;
      }
      reject(new Error(`Wrangler failed with ${signal ?? `exit code ${code ?? "unknown"}`}`));
    });
  });
}
