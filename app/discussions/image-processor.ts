"use client";

export function createImageProcessor() {
  let worker: Worker | undefined;
  let disposed = false;
  let rejectCurrent: ((error: Error) => void) | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    process(file: File): Promise<File> {
      const task = queue.then(() => new Promise<File>((resolve, reject) => {
        if (disposed) { reject(new Error("图片处理已取消。")); return; }
        worker ??= new Worker(new URL("./image-process.worker.ts", import.meta.url), { type: "module" });
        rejectCurrent = reject;
        worker.onmessage = ({ data }: MessageEvent<{ file?: File; error?: string }>) => {
          rejectCurrent = undefined;
          if (data.file) resolve(data.file);
          else reject(new Error(data.error ?? "图片处理失败。"));
        };
        worker.onerror = () => {
          worker?.terminate();
          worker = undefined;
          rejectCurrent = undefined;
          reject(new Error("图片处理失败，可能超出浏览器处理能力。请重试或选择其他图片。"));
        };
        worker.postMessage(file);
      }));
      queue = task.catch(() => undefined);
      return task;
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = undefined;
      rejectCurrent?.(new Error("图片处理已取消。"));
      rejectCurrent = undefined;
    },
  };
}
