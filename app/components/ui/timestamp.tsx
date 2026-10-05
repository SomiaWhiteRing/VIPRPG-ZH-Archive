import { useSyncExternalStore } from "react";
import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "@/app/root";
import { formatElapsedTimestamp, formatExactTimestamp, formatRelativeTimestamp, parseTimestamp } from "@/lib/format";
import { cn } from "@/lib/ui/cn";

const listeners = new Set<() => void>();
let now: number | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const getSnapshot = () => now;

export function Timestamp({ value, className, format = "relative" }: {
  value: string;
  className?: string;
  format?: "relative" | "duration";
}) {
  const serverTime = useRouteLoaderData<typeof rootLoader>("root")?.serverTime ?? null;
  // SSR and hydration share the serialized time before the live clock takes over.
  const currentTime = useSyncExternalStore(subscribe, getSnapshot, () => serverTime) ?? serverTime;
  const date = parseTimestamp(value);
  const exact = formatExactTimestamp(value);
  return (
    <time
      className={cn("font-mono text-xs tabular-nums", className)}
      dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}
      title={exact}
    >
      {currentTime === null ? null : format === "duration"
        ? formatElapsedTimestamp(value, currentTime)
        : formatRelativeTimestamp(value, currentTime)}
    </time>
  );
}
