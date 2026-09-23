/** Swap this module's import for ./diagnostics/client to enable temporary tracing. */
export function createInstallWorker(): Worker {
  return new Worker(new URL("./web-play-install-worker.ts", import.meta.url), { type: "module" });
}

export function InstallDiagnosticsPanel() {
  return null;
}
