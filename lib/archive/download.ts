export const downloadZipBuilderVersion = "zip-store-v7-local-crc-no-descriptor";

export const downloadCachePrefix = "download-cache/v1/slots/";
export const downloadCacheMaxBytes = 64 * 1024 * 1024;
export const downloadCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
export function isDownloadCacheSlotKey(key: string): boolean {
  return /^download-cache\/v1\/slots\/[0-9a-f]\.zip$/.test(key);
}
