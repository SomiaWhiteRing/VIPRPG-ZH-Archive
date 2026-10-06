export const downloadZipBuilderVersion = "zip-store-v8-local-crc-no-descriptor";

// Deployment and cold ZIP generation share one invocation budget. Keep room for
// manifest/player metadata, cache operations, D1, and failure observability.
export const downloadSubrequestLimit = 30_000;
export const downloadSubrequestReserve = 64;

// 32 x 64 MiB + 8 x 256 MiB = 4 GiB. Each variant has one candidate per tier;
// choose by stored interval size, so even a large ZIP's small tail can qualify.
export const downloadCachePrefix = "download-cache/v3/slots/";
export const downloadCacheSmallMaxBytes = 64 * 1024 * 1024;
export const downloadCacheMaxBytes = 256 * 1024 * 1024;
export const downloadCacheMinR2Gets = 128;
export const downloadCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
export function isDownloadCacheSlotKey(key: string): boolean {
  // Retire old full-ZIP slots through the same seven-day expiry sweep.
  return /^download-cache\/v[12]\/slots\/[0-9a-f]\.zip$/.test(key) ||
    /^download-cache\/v3\/slots\/(?:small\/[01][0-9a-f]|large\/[0-7])\.zip$/.test(key);
}
