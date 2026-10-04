export const WORK_REFERENCE_DURATIONS = [
  "nnkr（~5min）",
  "短篇（~30min）",
  "中篇（~2h）",
  "长篇（~10h）",
  "巨作（10h+）",
] as const;

export const WORK_REFERENCE_DURATION_MAX_LENGTH = 100;

export function normalizeWorkReferenceDuration(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("参考时长必须为文本。");
  const duration = value.trim();
  if (duration.length > WORK_REFERENCE_DURATION_MAX_LENGTH) {
    throw new Error(`参考时长最多 ${WORK_REFERENCE_DURATION_MAX_LENGTH} 字。`);
  }
  if (/[\r\n]/u.test(duration)) throw new Error("参考时长请填写为单行文本。");
  return duration || null;
}
