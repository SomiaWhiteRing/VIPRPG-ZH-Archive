import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

const PREVIEW_LINES = 8;

export function WorkDescription({ description }: { description: string }) {
  const contentId = useId();
  const contentRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState<{ full: number; preview: number } | null>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    function measure() {
      if (!content) return;
      const full = content.getBoundingClientRect().height;
      const preview = parseFloat(getComputedStyle(content).lineHeight) * PREVIEW_LINES;
      setSize((previous) =>
        previous?.full === full && previous.preview === preview
          ? previous
          : { full, preview },
      );
    }

    measure();
    // Observe the uncut paragraph so wrapping and font changes update both heights.
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [description]);

  const collapsible = size !== null && size.full > size.preview + 1;
  const collapsed = collapsible && !expanded;

  return (
    <div>
      <div
        className="work-description-viewport"
        data-collapsed={collapsed}
        id={contentId}
        style={{ height: size ? (collapsed ? size.preview : size.full) : undefined }}
      >
        <p ref={contentRef} className="m-0 whitespace-pre-wrap leading-[1.85] wrap-anywhere">
          {description}
        </p>
      </div>
      {collapsible ? (
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="mt-2 inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-sm px-1 text-sm font-medium text-secondary hover:text-primary"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "收起简介" : "展开全部"}
          <ChevronDown
            aria-hidden
            className="transition-transform duration-300 motion-reduce:transition-none"
            size={16}
            style={{ transform: expanded ? "rotate(180deg)" : undefined }}
          />
        </button>
      ) : null}
    </div>
  );
}
