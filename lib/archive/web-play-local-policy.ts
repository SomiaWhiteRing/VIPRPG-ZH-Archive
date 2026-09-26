// Bump when the filtered ZIP contents change so transport caches stay isolated.
export const webPlayDownloadProfile = "web-play-v1";

export const webPlayLocalSkippedExtensions = ["dll", "exe", "txt"] as const;

const skippedExtensionSet = new Set<string>(webPlayLocalSkippedExtensions);
// Preserve EasyRPG's root engine/patch detection files in both pack and index.
// They are detection data, not libraries executed by the browser.
const engineDetectionFiles = new Set([
  "accord.dll",
  "ultimate_rt_eb.dll",
  "harmony.dll",
  "dynloader.dll",
  "destiny.dll",
]);

export function shouldSkipWebPlayLocalWrite(path: string): boolean {
  if (engineDetectionFiles.has(path.toLowerCase())) {
    return false;
  }

  const fileName = path.split("/").at(-1) ?? "";
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return false;
  }

  return skippedExtensionSet.has(fileName.slice(dotIndex + 1).toLowerCase());
}
