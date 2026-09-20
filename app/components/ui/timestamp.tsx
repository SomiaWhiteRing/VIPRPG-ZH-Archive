import { useSyncExternalStore } from "react";
import { formatExactTimestamp, formatRelativeTimestamp, parseTimestamp } from "@/lib/format";
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
const getServerSnapshot = () => null;

export function Timestamp({ value, className }: { value: string; className?: string }) {
  const currentTime = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const date = parseTimestamp(value);
  const exact = formatExactTimestamp(value);
  return (
    <time
      className={cn("font-mono text-xs tabular-nums", className)}
      dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}
      title={exact}
    >
      {currentTime === null ? exact : formatRelativeTimestamp(value, currentTime)}
    </time>
  );
}
