export const downloadZipBuilderVersion = "zip-store-v7-local-crc-no-descriptor";

// v2 objects may contain only a ZIP interval; older Workers must not read them.
export const downloadCachePrefix = "download-cache/v2/slots/";
export const downloadCacheMaxBytes = 256 * 1024 * 1024;
export const downloadCacheMinR2Gets = 128;
export const downloadCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
export function isDownloadCacheSlotKey(key: string): boolean {
  // Retire old full-ZIP slots through the same seven-day expiry sweep.
  return /^download-cache\/v[12]\/slots\/[0-9a-f]\.zip$/.test(key);
}
