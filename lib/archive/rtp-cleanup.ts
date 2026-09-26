import catalog from "./rtp-catalog.json";
import { LcfReferenceScan } from "./lcf-reference-scan";
export { LcfReferenceScan } from "./lcf-reference-scan";

export const RTP_CLEANUP_VERSION = "rtp-exact-static-v2";
export const RTP_CATALOG_SHA256 = catalog.sourceSha256;

export type RtpFile = { path: string; size: number; sha256: string };
export type RtpCleanupReport = {
  version: string;
  catalogSha256: string;
  status: "no_candidates" | "analyzed" | "preserved";
  candidateCount: number;
  excluded: RtpFile[];
  protectedDirectories: string[];
  reasons: string[];
};
export type ResourceReferenceReport = Omit<RtpCleanupReport, "version" | "catalogSha256">;

const fingerprints = new Set(catalog.entries.map(([path, size, hash]) => `${path}\0${size}\0${hash}`));
const normalize = (value: string) => value.replaceAll("\\", "/").normalize("NFC").toLowerCase();

export function isExactRtpFile(file: RtpFile): boolean {
  return fingerprints.has(`${normalize(file.path)}\0${file.size}\0${file.sha256}`);
}

export function validateRtpCleanupReport(value: unknown): asserts value is RtpCleanupReport | null | undefined {
  if (value == null) return;
  const report = value as RtpCleanupReport;
  if (report.version !== RTP_CLEANUP_VERSION || report.catalogSha256 !== RTP_CATALOG_SHA256 ||
      !["no_candidates", "analyzed", "preserved"].includes(report.status) ||
      !Number.isSafeInteger(report.candidateCount) || report.candidateCount < 0 ||
      !Array.isArray(report.excluded) || report.excluded.length > report.candidateCount ||
      !Array.isArray(report.protectedDirectories) || !report.protectedDirectories.every((v) => typeof v === "string") ||
      !Array.isArray(report.reasons) || report.reasons.length > 20 || !report.reasons.every((v) => typeof v === "string")) {
    throw new Error("RTP 分析记录无效或版本已更新，请重新选择游戏文件");
  }
  const paths = new Set<string>();
  for (const file of report.excluded) {
    if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string" ||
        !Number.isSafeInteger(file.size) || file.size < 0 || !isExactRtpFile(file) || paths.has(normalize(file.path))) {
      throw new Error("RTP 排除清单包含非原版资源或重复路径");
    }
    paths.add(normalize(file.path));
  }
  if (report.status !== "analyzed" && report.excluded.length) throw new Error("未完成分析不能排除 RTP");
}

/** RTP-only comparison tool; production uploads use ResourceReferenceScan. */
export class RtpReferenceScan extends LcfReferenceScan {
  constructor(files: readonly RtpFile[]) { super(files, isExactRtpFile); }
  override finish(): RtpCleanupReport {
    return { version: RTP_CLEANUP_VERSION, catalogSha256: RTP_CATALOG_SHA256, ...super.finish() };
  }
}
