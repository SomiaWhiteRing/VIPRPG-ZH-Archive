export function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

export const DISPLAY_TIME_ZONE = "Asia/Shanghai";

const timestampFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function parseTimestamp(value: string): Date {
  // Database timestamps without an offset are stored in UTC.
  const normalized = value.trim().replace(" ", "T");
  return new Date(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
      ? normalized
      : `${normalized}Z`,
  );
}

function timestampParts(date: Date) {
  return Object.fromEntries(
    timestampFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
}

export function formatDateKey(date: Date): string {
  const p = timestampParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function formatExactTimestamp(value: string): string {
  const date = parseTimestamp(value);
  if (Number.isNaN(date.getTime())) return value;
  const p = timestampParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} (UTC+08:00)`;
}

export function formatRelativeTimestamp(value: string, now: number): string {
  const date = parseTimestamp(value);
  if (Number.isNaN(date.getTime())) return value;
  const p = timestampParts(date);
  const year = timestampParts(new Date(now)).year;
  if (p.year !== year) return `${p.year}-${p.month}-${p.day}`;
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  return `${p.month}-${p.day}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDate(value: string | null, options?: { time?: boolean }): string {
  if (!value) {
    return "";
  }
  const date = parseTimestamp(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: DISPLAY_TIME_ZONE,
    dateStyle: "medium",
    ...(options?.time !== false && { timeStyle: "short" }),
  }).format(date);
}

export function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatNullableDuration(ms: number | null): string {
  return ms === null ? "n/a" : formatDuration(ms);
}
