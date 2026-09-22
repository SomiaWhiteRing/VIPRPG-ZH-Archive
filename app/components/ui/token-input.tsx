import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/lib/ui/cn";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ComponentProps, InputHTMLAttributes, ReactNode } from "react";
import {
  Children,
  Fragment,
  isValidElement,
  useLayoutEffect,
  useRef,
} from "react";

const tokenChipClassName =
  "inline-flex min-h-7 max-w-full select-none items-center gap-1 rounded-full bg-primary/10 px-2.5 text-xs font-semibold text-foreground";

export function TokenInput({
  children,
  field,
  preserveHoverRows = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  preserveHoverRows?: boolean;
  field?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!preserveHoverRows || !container) return;
    const hover = window.matchMedia("(hover: hover)");
    const breaks = Array.from(
      container.querySelectorAll<HTMLElement>(
        ":scope > [data-token-row-break]",
      ),
    ).filter((rowBreak) => rowBreak.nextElementSibling instanceof HTMLElement);
    const items = breaks.map(
      (rowBreak) => rowBreak.nextElementSibling as HTMLElement,
    );
    let lastWidth = 0;
    let disposed = false;

    function arrangeRows() {
      if (disposed || !container) return;
      lastWidth = container.getBoundingClientRect().width;
      if (!lastWidth) return;
      const style = getComputedStyle(container);
      const available =
        container.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const gap = parseFloat(style.columnGap) || 0;

      // Measure without the previous row's width cap. Hover growth is excluded
      // from wrapping, so animations never change which row an item belongs to.
      const measurements = items.map((item) => {
        item.style.removeProperty("max-width");
        item.style.removeProperty("min-width");
        const expansion = item.querySelector<HTMLElement>(
          "[data-token-hover-expansion]",
        );
        return {
          width:
            item instanceof HTMLInputElement
              ? parseFloat(getComputedStyle(item).minWidth)
              : item.getBoundingClientRect().width -
                (hover.matches
                  ? (expansion?.getBoundingClientRect().width ?? 0)
                  : 0),
          expansion: hover.matches
            ? (expansion?.getBoundingClientRect().height ?? 0)
            : 0,
        };
      });
      // Mouse hover and keyboard focus can expose two buttons at once.
      // Reserve their space once at the end of each row, not beside each chip.
      const reserve = measurements
        .map((item) => item.expansion)
        .sort((a, b) => b - a)
        .slice(0, 2)
        .reduce((sum, width) => sum + width, 0);
      const rowWidth = Math.max(0, available - reserve);
      let used = 0;
      items.forEach((item, index) => {
        const width = Math.min(measurements[index].width, rowWidth);
        const newRow = used > 0 && used + gap + width > rowWidth;
        breaks[index].hidden = !newRow;
        used = newRow || used === 0 ? width : used + gap + width;
        if (item instanceof HTMLInputElement) {
          item.style.minWidth = `${width}px`;
        } else {
          item.style.maxWidth = `${rowWidth}px`;
        }
      });
    }

    arrangeRows();
    const observer = new ResizeObserver(() => {
      if (container.getBoundingClientRect().width !== lastWidth) arrangeRows();
    });
    observer.observe(container);
    hover.addEventListener("change", arrangeRows);
    document.fonts.addEventListener("loadingdone", arrangeRows);
    void document.fonts.ready.then(arrangeRows);
    return () => {
      disposed = true;
      observer.disconnect();
      hover.removeEventListener("change", arrangeRows);
      document.fonts.removeEventListener("loadingdone", arrangeRows);
      items.forEach((item) => {
        item.style.removeProperty("max-width");
        item.style.removeProperty("min-width");
      });
    };
  }, [children, preserveHoverRows]);

  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
        preserveHoverRows && "gap-y-0",
      )}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("button") && props.id) {
          document.getElementById(props.id)?.focus();
        }
      }}
      ref={containerRef}
    >
      {preserveHoverRows
        ? Children.toArray(children).map((child, index) => (
            <Fragment
              key={isValidElement(child) ? (child.key ?? index) : index}
            >
              <span
                aria-hidden="true"
                className="h-1.5 basis-full shrink-0"
                data-token-row-break=""
                hidden
              />
              {child}
            </Fragment>
          ))
        : children}
      {preserveHoverRows ? (
        <span
          aria-hidden="true"
          className="h-1.5 basis-full shrink-0"
          data-token-row-break=""
          hidden
        />
      ) : null}
      {field ?? (
        <Input
          {...props}
          className="h-auto min-h-7 min-w-40 flex-1 border-0 bg-transparent px-1 py-0 text-sm shadow-none outline-none placeholder:text-muted focus-visible:border-0 focus-visible:ring-0"
        />
      )}
    </div>
  );
}

export function TokenChip({
  children,
  className,
  disabled,
  label,
  onRemove,
  ...props
}: ComponentProps<"span"> & {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span {...props} className={cn(tokenChipClassName, className)}>
      {children}
      <Button
        aria-label={`移除 ${label}`}
        className="size-4 min-h-0 shrink-0 rounded-full p-0 hover:bg-primary/15"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X className="size-3" />
      </Button>
    </span>
  );
}

export function TokenDragPreview({
  label,
  left,
  top,
  width,
  height,
}: {
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[100] select-none rounded-full bg-card shadow-lg ring-1 ring-primary/20"
      style={{
        transform: `translate3d(${left}px, ${top}px, 0)`,
        width,
        height,
      }}
    >
      <span className={cn(tokenChipClassName, "h-full w-full")}>
        <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          <X className="size-3" />
        </span>
      </span>
    </div>,
    document.body,
  );
}
