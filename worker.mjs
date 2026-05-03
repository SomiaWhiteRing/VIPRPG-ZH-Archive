import openNextWorker from "./.open-next/worker.js";
import {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";
import { maybeHandleArchiveDownload } from "./worker/archive-download.mjs";
import { runScheduledArchiveGc } from "./worker/archive-gc.mjs";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };

const worker = {
  async fetch(request, env, ctx) {
    const archiveDownloadResponse = await maybeHandleArchiveDownload(request, env, ctx);

    if (archiveDownloadResponse) {
      return archiveDownloadResponse;
    }

    return openNextWorker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runScheduledArchiveGc(env, {
        trigger: "scheduled",
        cron: controller.cron,
      })
        .then((report) => {
          console.log("Scheduled archive GC completed", JSON.stringify(report));
        })
        .catch((error) => {
          console.error("Scheduled archive GC failed", error?.message ?? error);
        }),
    );
  },
};

export default worker;
