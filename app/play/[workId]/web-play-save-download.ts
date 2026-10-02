import { localRequest } from "@/lib/browser/android-local";
import { parseSaveImports, saveArchiveBlob, saveArchiveFilename } from "./web-play-save-transfer";

type RuntimeWindow = Window & { Worker: typeof Worker };

/** Adapt the pinned runtime's save downloads without rewriting its versioned assets. */
export function interceptPlayerSaveDownloads(
  frame: RuntimeWindow,
  options: { workId: number; title: string; runtimeBasePath: string; nativeUrl?: string; signal: AbortSignal; onError: (error: unknown) => void },
): () => void {
  const NativeWorker = frame.Worker;
  const playerWorkerUrl = new URL(`${options.runtimeBasePath}/player-worker.js`, window.location.href).href;
  let exporting = false;
  const WorkerWithSaveDownloads = class extends NativeWorker {
    constructor(url: string | URL, workerOptions?: WorkerOptions) {
      super(url, workerOptions);
      if (new URL(String(url), frame.location.href).href !== playerWorkerUrl) return;
      this.addEventListener("message", event => {
        const data = event.data as { type?: string; filename?: string; bytes?: Uint8Array };
        if (data?.type !== "download" || typeof data.filename !== "string" || !/\.lsd$/i.test(data.filename)) return;
        // Do not let the runtime also download an unwrapped LSD or fall back after failure.
        event.stopImmediatePropagation();
        if (exporting || options.signal.aborted) return;
        exporting = true;
        void (async () => {
          if (!ArrayBuffer.isView(data.bytes) || data.bytes.byteLength > 16 * 1024 * 1024) throw new Error("存档下载数据无效或超过 16 MiB。");
          const bytes = new Uint8Array(data.bytes);
          const saves = await parseSaveImports([new File([bytes], data.filename!)], options.signal);
          options.signal.throwIfAborted();
          if (options.nativeUrl) {
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 0x8000) {
              binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
            }
            // This runs in the host/main frame, where the origin-scoped native bridge lives.
            await localRequest("exportSave", { url: options.nativeUrl, name: saves[0].name, bytes: btoa(binary) });
            return;
          }
          const url = URL.createObjectURL(saveArchiveBlob(saves));
          const link = document.createElement("a");
          link.href = url;
          link.download = saveArchiveFilename(options.title, options.workId);
          document.body.appendChild(link);
          try { link.click(); }
          finally {
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30_000);
          }
        })().catch(error => {
          if (!options.signal.aborted) options.onError(error);
        }).finally(() => { exporting = false; });
      }, { capture: true });
    }
  };
  frame.Worker = WorkerWithSaveDownloads;
  return () => { if (frame.Worker === WorkerWithSaveDownloads) frame.Worker = NativeWorker; };
}
