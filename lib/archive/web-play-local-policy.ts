export const webPlayLocalSkippedExtensions = ["dll", "exe", "txt"] as const;

const skippedExtensionSet = new Set<string>(webPlayLocalSkippedExtensions);

export function shouldSkipWebPlayLocalWrite(path: string): boolean {
  const fileName = path.split("/").at(-1) ?? "";
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex < 0 || dotIndex === fileName.length - 1) {
    return false;
  }

  return skippedExtensionSet.has(fileName.slice(dotIndex + 1).toLowerCase());
}
