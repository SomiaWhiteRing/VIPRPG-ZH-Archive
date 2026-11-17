import { translate } from "@/lib/i18n/core";
import type { UiLocale } from "@/lib/i18n/locale";

export function createImageProcessor() {
  let worker: Worker | undefined;
  let disposed = false;
  let rejectCurrent: (() => void) | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    process(file: File, locale: UiLocale): Promise<File> {
      const task = queue.then(
        () =>
          new Promise<File>((resolve, reject) => {
            if (disposed) {
              reject(new Error(translate(locale, "image.process.canceled")));
              return;
            }
            worker ??= new Worker(
              new URL("./image-process.worker.ts", import.meta.url),
              { type: "module" },
            );
            rejectCurrent = () => reject(new Error(translate(locale, "image.process.canceled")));
            worker.onmessage = ({
              data,
            }: MessageEvent<{ file?: File; error?: string }>) => {
              rejectCurrent = undefined;
              if (data.file) resolve(data.file);
              else reject(new Error(data.error ?? translate(locale, "image.processFailed")));
            };
            worker.onerror = () => {
              worker?.terminate();
              worker = undefined;
              rejectCurrent = undefined;
              reject(
                new Error(
                  translate(locale, "image.process.browserFailed"),
                ),
              );
            };
            worker.postMessage({ file, locale });
          }),
      );
      queue = task.catch(() => undefined);
      return task;
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = undefined;
      rejectCurrent?.();
      rejectCurrent = undefined;
    },
  };
}
