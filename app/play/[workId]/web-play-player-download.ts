import { localRequest } from "@/lib/browser/android-local";
import { inspectImage, MAX_IMAGE_BYTES } from "@/lib/image-format";
import type { PlayerScreenshot } from "./web-play-player";
import { parseSaveImports, saveArchiveBlob, saveArchiveFilename } from "./web-play-save-transfer";

type RuntimeWindow = Window & { Worker: typeof Worker };

/** Route engine screenshots and saves through the site's existing storage paths. */
export function interceptPlayerDownloads(
  frame: RuntimeWindow,
  options: { workId: number; title: string; runtimeBasePath: string; nativeUrl?: string; signal: AbortSignal; onScreenshot: (image: PlayerScreenshot) => void; onError: (error: unknown) => void },
): () => void {
  const NativeWorker = frame.Worker;
  const playerWorkerUrl = new URL(`${options.runtimeBasePath}/player-worker.js`, window.location.href).href;
  let exporting = false;
  const WorkerWithPlayerDownloads = class extends NativeWorker {
    constructor(url: string | URL, workerOptions?: WorkerOptions) {
      super(url, workerOptions);
      if (new URL(String(url), frame.location.href).href !== playerWorkerUrl) return;
      this.addEventListener("message", event => {
        const data = event.data as { type?: string; filename?: string; bytes?: Uint8Array };
        if (data?.type !== "download" || typeof data.filename !== "string") return;
        const screenshot = /^screenshot_.+\.png$/i.test(data.filename);
        if (!screenshot && !/\.lsd$/i.test(data.filename)) return;
        // Suppress the runtime download even if the site's save operation fails.
        event.stopImmediatePropagation();
        if (options.signal.aborted) return;
        if (screenshot) {
          try {
            if (!ArrayBuffer.isView(data.bytes) || data.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("截图数据无效或过大。");
            const bytes = new Uint8Array(data.bytes);
            const image = inspectImage(bytes.buffer);
            if (image.format !== "png") throw new Error("截图必须为 PNG。");
            options.onScreenshot({ blob: new Blob([bytes], { type: "image/png" }), width: image.width, height: image.height });
          } catch (error) { options.onError(error); }
          return;
        }
        if (exporting) return;
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
  frame.Worker = WorkerWithPlayerDownloads;
  return () => { if (frame.Worker === WorkerWithPlayerDownloads) frame.Worker = NativeWorker; };
}
