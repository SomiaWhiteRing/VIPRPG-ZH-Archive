import openNextWorker from "./.open-next/worker.js";
import {
  BucketCachePurge,
  DOQueueHandler,
  DOShardedTagCache,
} from "./.open-next/worker.js";
import { maybeHandleArchiveDownload } from "./worker/archive-download.mjs";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };

const worker = {
  async fetch(request, env, ctx) {
    const archiveDownloadResponse = await maybeHandleArchiveDownload(request, env, ctx);

    if (archiveDownloadResponse) {
      return archiveDownloadResponse;
    }

    return openNextWorker.fetch(request, env, ctx);
  },
};

export default worker;
