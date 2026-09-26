import { LcfReferenceScan, type ResourceFile, type ResourceReferenceReport } from "./lcf-reference-scan";
import { classifyArchivePath } from "./file-policy";

export const RESOURCE_CLEANUP_VERSION = "resources-static-v2";
export type ResourceCleanupReport = ResourceReferenceReport & { version: string };

const mediaDirectories = new Set("backdrop battle battle2 battlecharset battleweapon charset chipset faceset gameover monster movie music panorama picture sound system system2 title".split(" "));
const mediaExtension = /\.(?:png|bmp|xyz|jpg|jpeg|gif|wav|mid|midi|mp3|ogg|oga|flac|opus|wma|avi|mpg|mpeg)$/i;
const normalize = (path: string) => path.normalize("NFC").toLowerCase();

/** Only engine media can be removed. Core, runtime, font, config and text files
 * have implicit uses and never become candidates merely for lacking a reference. */
export function isResourceCleanupCandidate(file: Pick<ResourceFile, "path">): boolean {
  const parts = file.path.split("/");
  return !/[\\:]/.test(file.path) &&
    ![...file.path].some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127) && parts.length >= 2 &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..") &&
    mediaDirectories.has(parts[0].toLowerCase()) && mediaExtension.test(file.path) &&
    classifyArchivePath(file.path).included;
}

export class ResourceReferenceScan extends LcfReferenceScan {
  constructor(files: readonly ResourceFile[]) { super(files, isResourceCleanupCandidate); }
  override finish(): ResourceCleanupReport {
    return { version: RESOURCE_CLEANUP_VERSION, ...super.finish() };
  }
}

export function validateResourceCleanupReport(value: unknown): asserts value is ResourceCleanupReport | null | undefined {
  if (value == null) return;
  const report = value as ResourceCleanupReport;
  if (report.version !== RESOURCE_CLEANUP_VERSION ||
      !["no_candidates", "analyzed", "preserved"].includes(report.status) ||
      !Number.isSafeInteger(report.candidateCount) || report.candidateCount < 0 ||
      !Array.isArray(report.excluded) || report.excluded.length > report.candidateCount ||
      !Array.isArray(report.protectedDirectories) || !report.protectedDirectories.every((v) => typeof v === "string") ||
      !Array.isArray(report.reasons) || report.reasons.length > 20 || !report.reasons.every((v) => typeof v === "string") ||
      (report.status === "no_candidates") !== (report.candidateCount === 0)) {
    throw new Error("素材分析记录无效或版本已更新，请重新选择游戏文件");
  }
  const paths = new Set<string>();
  for (const file of report.excluded) {
    if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 ||
        !isResourceCleanupCandidate(file) || paths.has(normalize(file.path))) {
      throw new Error("素材排除清单包含不允许清理的文件或重复路径");
    }
    paths.add(normalize(file.path));
  }
  if (report.status !== "analyzed" && report.excluded.length) throw new Error("未完成分析不能排除素材");
}
