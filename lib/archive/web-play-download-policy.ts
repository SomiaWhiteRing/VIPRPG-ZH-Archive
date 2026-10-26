import { isSharedPlayerPath } from "./shared-player";

// Installation reads only the main file list; published profiles keep their bytes.
export const webPlayDownloadProfile = "web-play-v2";
// Keep published URLs usable by installed clients and in-progress downloads.
export const legacyWebPlayDownloadProfile = "web-play-v1";
// Ordinary downloads keep extras even when the shared player is omitted.
export const downloadWithoutPlayerProfile = "download-no-player-v1";
export const shouldSkipWebPlayDownloadFile = isSharedPlayerPath;
