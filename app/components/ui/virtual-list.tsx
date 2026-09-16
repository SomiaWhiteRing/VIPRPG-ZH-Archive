"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/ui/cn";

export type VirtualListHandle = {
  scrollToKey: (key: string) => void;
};

export type VirtualListStickyItem = {
  index: number;
  endIndex: number;
  ancestors: number[];
};

type VirtualListProps = {
  ref?: Ref<VirtualListHandle>;
  itemKeys: string[];
  anchorKeys?: string[][];
  estimateHeight: (index: number) => number;
  measurementGroup: (index: number) => string;
  renderItem: (index: number) => ReactNode;
  label: string;
  className?: string;
  scrollOffset?: number;
  stickyItems?: VirtualListStickyItem[];
};

const OVERSCAN = 3;
const NAVIGATION_DURATION_MS = 400;

export function VirtualList({ ref, itemKeys, anchorKeys, estimateHeight, measurementGroup, renderItem, label, className, scrollOffset = 0, stickyItems }: VirtualListProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef<number | null>(null);
  const navigationFrameRef = useRef<number | null>(null);
  const navigationRef = useRef<{ key: string; startedAt: number; duration: number; progress: number } | null>(null);
  const navigationStepRef = useRef<(time: number) => void>(() => {});
  const anchorRef = useRef<{ key: string; offset: number } | null>(null);
  const recordViewportRef = useRef<() => void>(() => {});
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [measurementWidth, setMeasurementWidth] = useState(0);
  const positions = useMemo(() => {
    const samples = new Map<string, { total: number; count: number }>();
    itemKeys.forEach((key, index) => {
      const height = heights[key];
      if (height === undefined) return;
      const group = measurementGroup(index);
      const sample = samples.get(group) ?? { total: 0, count: 0 };
      sample.total += height;
      sample.count++;
      samples.set(group, sample);
    });
    const offsets = [0];
    for (let index = 0; index < itemKeys.length; index++) {
      const sample = samples.get(measurementGroup(index));
      // Use the initial estimate only until this kind of row has been measured.
      const height = heights[itemKeys[index]] ?? (sample ? sample.total / sample.count : estimateHeight(index));
      offsets.push(offsets[index] + height);
    }
    return offsets;
  }, [itemKeys, estimateHeight, measurementGroup, heights]);
  const keyPositions = useMemo(() => new Map(itemKeys.map((key, index) => [key, index])), [itemKeys]);
  const anchorPositions = useMemo(() => new Map(itemKeys.flatMap((key, index) =>
    (anchorKeys?.[index] ?? [key]).map((anchor) => [anchor, index] as const))), [itemKeys, anchorKeys]);
  const stickyByIndex = useMemo(() => new Map(stickyItems?.map((item) => [item.index, item])), [stickyItems]);
  const stickyOffset = useCallback((index: number) => {
    const ancestors = stickyByIndex.get(index)?.ancestors
      ?? stickyItems?.filter((item) => item.index < index && item.endIndex > index).map((item) => item.index)
      ?? [];
    return ancestors.reduce((height, ancestor) => height + positions[ancestor + 1] - positions[ancestor], 0);
  }, [positions, stickyByIndex, stickyItems]);

  const recordViewport = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const top = scrollOffset - element.getBoundingClientRect().top;
    const height = Math.max(0, window.innerHeight - scrollOffset);
    const index = findItem(positions, top);
    // Do not pull the page into the list while the user is above or below it.
    if (!navigationRef.current) {
      const anchor = anchorRef.current;
      const anchoredIndex = anchor ? anchorPositions.get(anchor.key) : undefined;
      // A programmatic correction must retain the exact member, including navigation below sticky headings.
      if (!anchor || anchoredIndex === undefined || Math.abs(top - positions[anchoredIndex] - anchor.offset) > 1) {
        const key = anchorKeys?.[index]?.[0] ?? itemKeys[index];
        anchorRef.current = top >= 0 && top < positions[itemKeys.length] && key ? { key, offset: top - positions[index] } : null;
      }
    }
    setViewport((current) => current.top === top && current.height === height ? current : { top, height });
  }, [itemKeys, anchorKeys, anchorPositions, positions, scrollOffset]);

  useLayoutEffect(() => { recordViewportRef.current = recordViewport; }, [recordViewport]);

  const cancelNavigation = useCallback(() => {
    if (navigationFrameRef.current !== null) cancelAnimationFrame(navigationFrameRef.current);
    navigationFrameRef.current = null;
    navigationRef.current = null;
    anchorRef.current = null;
  }, []);

  // Each frame uses the latest measured positions without restarting the clock.
  useLayoutEffect(() => {
    navigationStepRef.current = (time) => {
      navigationFrameRef.current = null;
      const navigation = navigationRef.current;
      const element = viewportRef.current;
      const index = navigation ? anchorPositions.get(navigation.key) : undefined;
      if (!navigation || !element || index === undefined) {
        cancelNavigation();
        return;
      }
      const elapsed = navigation.duration === 0 ? 1 : Math.max(0, Math.min(1, (time - navigation.startedAt) / navigation.duration));
      const progress = elapsed < 0.5 ? 4 * elapsed ** 3 : 1 - (-2 * elapsed + 2) ** 3 / 2;
      const offset = -stickyOffset(index);
      const start = window.scrollY + element.getBoundingClientRect().top;
      const target = Math.max(0, Math.min(start + positions[index] + offset - scrollOffset, document.documentElement.scrollHeight - window.innerHeight));
      // Spread measurement corrections over the remaining animation instead of jumping to a revised path.
      const fraction = elapsed === 1 ? 1 : (progress - navigation.progress) / (1 - navigation.progress);
      window.scrollTo({ top: window.scrollY + (target - window.scrollY) * fraction, behavior: "instant" });
      navigation.progress = progress;
      recordViewport();
      if (elapsed === 1) {
        navigationRef.current = null;
        anchorRef.current = { key: navigation.key, offset };
      } else {
        navigationFrameRef.current = requestAnimationFrame((nextTime) => navigationStepRef.current(nextTime));
      }
    };
  }, [cancelNavigation, anchorPositions, anchorKeys, positions, recordViewport, scrollOffset, stickyOffset]);

  useImperativeHandle(ref, () => ({
    scrollToKey(key) {
      const index = anchorPositions.get(key) ?? keyPositions.get(key);
      if (index === undefined) return;
      cancelNavigation();
      navigationRef.current = {
        key: anchorPositions.has(key) ? key : anchorKeys?.[index]?.[0] ?? key,
        startedAt: performance.now(),
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : NAVIGATION_DURATION_MS,
        progress: 0,
      };
      navigationFrameRef.current = requestAnimationFrame((time) => navigationStepRef.current(time));
    },
  }), [cancelNavigation, keyPositions, anchorPositions, anchorKeys]);

  // Keep the same visible item anchored when measured heights replace estimates.
  // Browser scroll anchoring is disabled below so it does not apply a second correction.
  useLayoutEffect(() => {
    const element = viewportRef.current;
    const anchor = anchorRef.current;
    const index = anchor ? anchorPositions.get(anchor.key) : undefined;
    if (!navigationRef.current && element && anchor && index !== undefined) {
      const start = window.scrollY + element.getBoundingClientRect().top;
      const top = start + positions[index] + anchor.offset - scrollOffset;
      if (Math.abs(window.scrollY - top) > 0.5) window.scrollTo({ top, behavior: "instant" });
    }
    const frame = requestAnimationFrame(() => recordViewportRef.current());
    return () => cancelAnimationFrame(frame);
  }, [anchorPositions, positions, recordViewport, scrollOffset]);

  useEffect(() => {
    const interrupt = () => { if (navigationRef.current) cancelNavigation(); };
    const interruptOnKey = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Escape"].includes(event.key)) interrupt();
    };
    window.addEventListener("wheel", interrupt, { passive: true });
    window.addEventListener("touchstart", interrupt, { passive: true });
    window.addEventListener("pointerdown", interrupt, { passive: true });
    window.addEventListener("keydown", interruptOnKey);
    return () => {
      cancelNavigation();
      window.removeEventListener("wheel", interrupt);
      window.removeEventListener("touchstart", interrupt);
      window.removeEventListener("pointerdown", interrupt);
      window.removeEventListener("keydown", interruptOnKey);
    };
  }, [cancelNavigation]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    if (widthRef.current === null) widthRef.current = element.clientWidth;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => recordViewportRef.current());
    };
    const observer = new ResizeObserver(() => {
      if (widthRef.current !== element.clientWidth) {
        widthRef.current = element.clientWidth;
        // Text wrapping changes all row estimates at this width, including unmounted rows.
        setHeights({});
        setMeasurementWidth(element.clientWidth);
      }
      schedule();
    });
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const measure = useCallback((key: string, height: number) => {
    if (height <= 0) return;
    setHeights((current) => Math.abs((current[key] ?? 0) - height) < 0.5 ? current : { ...current, [key]: height });
  }, []);

  const first = Math.max(0, findItem(positions, viewport.top) - OVERSCAN);
  const end = Math.min(itemKeys.length, findItem(positions, viewport.top + viewport.height) + OVERSCAN + 1);

  return (
    <div
      aria-label={label}
      className={cn("[overflow-anchor:none] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", stickyItems && "relative isolate", className)}
      ref={viewportRef}
      role="region"
      tabIndex={0}
    >
      <div aria-hidden style={{ height: positions[first] }} />
      {itemKeys.slice(first, end).map((key, offset) => stickyByIndex.has(first + offset) ? (
        <div aria-hidden key={key} style={{ height: positions[first + offset + 1] - positions[first + offset] }} />
      ) : (
        <MeasuredItem itemKey={key} key={key} onMeasure={measure} measurementWidth={measurementWidth}>
          {renderItem(first + offset)}
        </MeasuredItem>
      ))}
      <div aria-hidden style={{ height: positions[itemKeys.length] - positions[end] }} />
      {/* Keep headings mounted within their full subtree bounds so native sticky positioning survives row virtualization. */}
      {stickyItems?.map((item) => (
        <div
          className="pointer-events-none absolute inset-x-0"
          key={itemKeys[item.index]}
          style={{ top: positions[item.index], height: positions[item.endIndex] - positions[item.index], zIndex: 20 - item.ancestors.length }}
        >
          <div className="pointer-events-auto sticky" style={{ top: scrollOffset + stickyOffset(item.index) }}>
            <MeasuredItem itemKey={itemKeys[item.index]} onMeasure={measure} measurementWidth={measurementWidth}>
              {renderItem(item.index)}
            </MeasuredItem>
          </div>
        </div>
      ))}
    </div>
  );
}

function MeasuredItem({ itemKey, children, onMeasure, measurementWidth }: { itemKey: string; children: ReactNode; onMeasure: (key: string, height: number) => void; measurementWidth: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => onMeasure(itemKey, element.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const frame = requestAnimationFrame(measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [itemKey, onMeasure, measurementWidth]);
  return <div className="flow-root" ref={ref}>{children}</div>;
}

function findItem(positions: number[], offset: number): number {
  let low = 0;
  let high = Math.max(0, positions.length - 2);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (positions[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}
