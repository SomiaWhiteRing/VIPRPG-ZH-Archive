import { isAndroidClient } from "./client-environment";

type FileExportBridge = {
  postMessage: (message: string) => void;
  onmessage: ((event: { data: string }) => void) | null;
};

const chunkSize = 192 * 1024;
let androidExports = Promise.resolve();

async function androidWrite(bridge: FileExportBridge, command: string) {
  const prefix = `${crypto.randomUUID()}:`;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Android file export timed out")), 120_000);
      bridge.onmessage = ({ data }) => {
        if (!data.startsWith(prefix)) return;
        if (data === prefix + "saved") resolve();
        else reject(new Error("Android could not save the generated file"));
      };
      bridge.postMessage(prefix + command);
    });
  } finally {
    clearTimeout(timeout);
    bridge.onmessage = null;
  }
}

export async function saveGeneratedFile(blob: Blob, filename: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!isAndroidClient()) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    return;
  }

  const bridge = (window as Window & { VIPRPGFileExport?: FileExportBridge }).VIPRPGFileExport;
  if (!bridge || typeof bridge.postMessage !== "function") throw new Error("Android file export requires a newer app");
  const current = androidExports.then(async () => {
    signal?.throwIfAborted();
    try {
      await androidWrite(bridge, `open:${filename}`);
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
        signal?.throwIfAborted();
        let binary = "";
        for (let start = 0; start < bytes.length; start += 8192) {
          binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
        }
        await androidWrite(bridge, `data:${btoa(binary)}`);
      }
      signal?.throwIfAborted();
      await androidWrite(bridge, "close");
    } catch (error) {
      try { bridge.postMessage(`${crypto.randomUUID()}:abort`); } catch { /* The WebView may have closed. */ }
      throw error;
    }
  });
  androidExports = current.catch(() => {});
  await current;
}
