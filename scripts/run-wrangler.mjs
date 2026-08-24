import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const wranglerCli = fileURLToPath(new URL("../node_modules/wrangler/wrangler-dist/cli.js", import.meta.url));
const successPattern = /commands executed successfully|No migrations to apply|Upload complete|Resource location: local[\s\S]*success/i;

export function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerCli, ...args], {
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      stdio: ["inherit", "pipe", "pipe"],
    });
    let output = "";
    let successSeen = false;
    let idleTimer;

    const receive = (stream, chunk) => {
      const text = chunk.toString();
      stream.write(text);
      output = `${output}${text}`.slice(-20_000);
      successSeen ||= successPattern.test(output);
      clearTimeout(idleTimer);
      if (successSeen) {
        // ponytail: Wrangler 4.125 keeps local Windows handles open after success.
        // Remove this idle termination when the CLI exits cleanly upstream.
        idleTimer = setTimeout(() => child.kill(), 1_500);
      }
    };

    child.stdout.on("data", (chunk) => receive(process.stdout, chunk));
    child.stderr.on("data", (chunk) => receive(process.stderr, chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(idleTimer);
      if (code === 0 || (successSeen && signal)) {
        resolve();
        return;
      }
      reject(new Error(`Wrangler failed with ${signal ?? `exit code ${code ?? "unknown"}`}`));
    });
  });
}
