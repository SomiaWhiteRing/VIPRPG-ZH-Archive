import { isSharedPlayerPath } from "./shared-player";

// Both online play and downloads without the player use this identical ZIP/cache.
export const webPlayDownloadProfile = "web-play-v2";
// Keep published URLs usable by installed clients and in-progress downloads.
export const legacyWebPlayDownloadProfile = "web-play-v1";
export const shouldSkipWebPlayDownloadFile = isSharedPlayerPath;
