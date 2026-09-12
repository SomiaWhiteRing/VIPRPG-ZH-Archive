import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const wranglerCli = fileURLToPath(new URL("../node_modules/wrangler/wrangler-dist/cli.js", import.meta.url));
const successPattern = /commands executed successfully|No migrations to apply|Upload complete|Resource location: local[\s\S]*success/i;

export function runWrangler(args) {
  const isMigration = args[0] === "d1" && args[1] === "migrations" && args[2] === "apply";
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
      // A successful SQL batch is only one step of a multi-file migration.
      // Wait for the final status table before applying the Windows exit workaround.
      const statusTable = output.slice(output.lastIndexOf("┌"));
      successSeen = isMigration
        ? /No migrations to apply/i.test(output) ||
          (statusTable.includes("└") && statusTable.includes("✅") && !/[🕒❌]/u.test(statusTable))
        : successSeen || successPattern.test(output);
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
