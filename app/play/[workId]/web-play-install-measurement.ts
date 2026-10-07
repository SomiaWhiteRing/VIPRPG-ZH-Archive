import type { InstallObserver, TraceFields } from "./web-play-install-observer";
import type { InstallMeasurement } from "@/lib/analytics";
import type { WebPlayInstallWorkerOutput } from "./web-play-types";

/** Opt-in aggregate measurement; no per-file records, errors, paths or payload buffers. */
export function createInstallMeasurement(): InstallObserver {
  const started = performance.now();
  let downloadStarted: number | null = null;
  let downloadMs: number | null = null;
  let status = "";
  let canceled = false;
  let networkMs = 0;
  let writeMs = 0;
  let bytes = 0;
  let retries = 0;
  return {
    event(kind: string, fields?: TraceFields) {
      if (kind === "installation") status = String(fields?.status ?? "");
      if (kind === "cancel.received") canceled = true;
      if (kind === "attempt.start" && Number(fields?.attempt) > 1) retries++;
      if (kind === "network.end") {
        if (downloadStarted !== null) downloadMs = (downloadMs ?? 0) + performance.now() - downloadStarted;
        downloadStarted = null;
        retries += Number(fields?.reconnects) || 0;
      }
    },
    async task<T>(kind: string, action: () => Promise<T>): Promise<T> {
      const network = kind === "network.headers" || kind === "network.read";
      const write = kind === "opfs.write" || kind === "opfs.write-index";
      if (!network && !write) return action();
      const start = performance.now();
      if (kind === "network.headers") downloadStarted = start;
      try {
        const value = await action();
        if (kind === "network.read") {
          const read = value as ReadableStreamReadResult<Uint8Array>;
          if (!read.done && read.value instanceof Uint8Array) bytes += read.value.byteLength;
        }
        return value;
      } finally {
        const elapsed = performance.now() - start;
        if (network) networkMs += elapsed;
        if (write) writeMs += elapsed;
      }
    },
    finish() {
      const measurement: InstallMeasurement = {
        outcome: status === "ready" ? "success" : status === "deleted" || canceled ? "cancel" : "error",
        duration_ms: Math.round(performance.now() - started),
        download_unpack_ms: downloadMs === null ? null : Math.round(downloadMs),
        network_wait_ms: Math.round(networkMs), write_ms: Math.round(writeMs),
        transferred_bytes: bytes, retry_count: retries,
      };
      postMessage({ type: "install-measurement", measurement } satisfies WebPlayInstallWorkerOutput);
    },
  };
}
