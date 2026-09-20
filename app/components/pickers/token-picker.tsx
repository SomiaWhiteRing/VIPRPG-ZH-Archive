import {
  ComboboxOption,
  ComboboxOptions,
  handleComboboxNavigation,
} from "@/app/components/ui/combobox";

import { Button } from "@/app/components/ui/button";
import { TokenChip, TokenDragPreview, TokenInput } from "@/app/components/ui/token-input";
import { cn } from "@/lib/ui/cn";
import {
  moveDragItem,
  nearestDragSlot,
  readDragSlots,
  type DragSlot,
} from "@/lib/ui/drag-reorder";
import type { KeyboardEvent, ReactNode } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
export type TokenSuggestion = { value: string; meta: string };

type TokenOption = TokenSuggestion & { kind: "existing" | "create" };

export function TokenPicker({
  disabled = false,
  id,
  name,
  onChange,
  placeholder,
  recommendationLabel,
  showRecommendations = true,
  showSelectionCount = true,
  suggestions,
  recommendations = suggestions,
  values,
  maxValues,
  normalizeValue = normalizeToken,
  validateValue,
  onQueryChange,
  sortable = false,
  commitOnBlur = false,
  showHelp = true,
  singleLineRecommendations = false,
}: {
  disabled?: boolean;
  id: string;
  name?: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  recommendationLabel?: string;
  showRecommendations?: boolean;
  showSelectionCount?: boolean;
  suggestions: TokenSuggestion[];
  recommendations?: TokenSuggestion[];
  values: string[];
  maxValues?: number;
  normalizeValue?: (value: string) => string;
  validateValue?: (value: string) => string | null;
  onQueryChange?: (query: string) => void;
  sortable?: boolean;
  commitOnBlur?: boolean;
  showHelp?: boolean;
  singleLineRecommendations?: boolean;
}) {
  const sortContainer = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    value: string;
    original: string[];
    order: string[];
    slots: DragSlot[];
    x: number;
    y: number;
    chip: { left: number; top: number; width: number; height: number };
    moved: boolean;
  } | null>(null);
  const [preview, setPreview] = useState<{
    value: string;
    order: string[];
    original: string[];
    chip: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const atLimit = maxValues !== undefined && values.length >= maxValues;
  const selectedKeys = useMemo(
    () => new Set(values.map((value) => tokenKey(normalizeValue(value)))),
    [values, normalizeValue],
  );
  const options = useMemo<TokenOption[]>(() => {
    const normalizedQuery = tokenKey(normalizeValue(query));
    if (!normalizedQuery) return [];
    const matches: TokenOption[] = suggestions
      .filter((item) => !selectedKeys.has(tokenKey(normalizeValue(item.value))))
      .filter((item) =>
        tokenKey(normalizeValue(item.value)).includes(normalizedQuery),
      )
      .slice(0, 8)
      .map((item) => ({ ...item, kind: "existing" as const }));
    const normalizedValue = normalizeValue(query);
    const exactMatch = suggestions.some(
      (item) =>
        tokenKey(normalizeValue(item.value)) === tokenKey(normalizedValue),
    );
    if (
      normalizedValue &&
      !exactMatch &&
      !selectedKeys.has(tokenKey(normalizedValue))
    ) {
      matches.push({ value: normalizedValue, meta: "新建", kind: "create" });
    }
    return matches;
  }, [query, selectedKeys, suggestions, normalizeValue]);
  const recommended = recommendations
    .filter((item) => !selectedKeys.has(tokenKey(normalizeValue(item.value))))
    .slice(0, 6);
  const menuId = `${id}-options`;
  const menuOpen = open && !disabled && options.length > 0;
  const visiblePreview = !disabled && preview?.original === values ? preview : null;

  function cancelDrag() {
    drag.current = null;
    setPreview(null);
  }

  function add(rawValue: string, validateQuery = true) {
    if (disabled || atLimit) return;
    const validation =
      (validateQuery && query ? validateValue?.(query) : null) ??
      validateValue?.(rawValue);
    if (validation) {
      setError(validation);
      return;
    }
    const value = normalizeValue(rawValue);
    if (!value) return;
    if (!selectedKeys.has(tokenKey(value))) onChange([...values, value]);
    setQuery("");
    setActiveIndex(0);
    setOpen(false);
    setError(null);
    onQueryChange?.("");
  }

  function remove(value: string) {
    onChange(values.filter((item) => tokenKey(item) !== tokenKey(value)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (
      handleComboboxNavigation(event, {
        count: options.length,
        open: menuOpen,
        activeIndex,
        setOpen,
        setActiveIndex,
      })
    )
      return;
    if (event.key === "Enter") {
      event.preventDefault();
      const active = menuOpen ? options[activeIndex] : null;
      add(active?.value ?? query);
    } else if (event.key === "Backspace" && !query && values.length) {
      remove(values[values.length - 1]);
    }
  }

  return (
    <div
      className={cn("grid gap-2", disabled && "opacity-60")}
      onBlur={(event) => {
        if (!commitOnBlur || event.currentTarget.contains(event.relatedTarget))
          return;
        if (normalizeValue(query)) {
          const existing = [...suggestions, ...recommendations].find(
            (item) =>
              tokenKey(normalizeValue(item.value)) ===
              tokenKey(normalizeValue(query)),
          );
          add(existing?.value ?? query);
        }
      }}
    >
      {name ? (
        <input name={name} readOnly type="hidden" value={values.join("\n")} />
      ) : null}
      <div
        className="relative"
        ref={sortContainer}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || disabled || current.original !== values) return;
          if (
            !current.moved &&
            Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5
          ) return;
          current.moved = true;
          const bounds = event.currentTarget.getBoundingClientRect();
          const nearest = nearestDragSlot(
            current.slots,
            event.clientX - bounds.left,
            event.clientY - bounds.top,
          );
          current.order = moveDragItem(
            current.order,
            current.order.indexOf(current.value),
            nearest,
          );
          setPreview({
            value: current.value,
            order: current.order,
            original: values,
            chip: {
              ...current.chip,
              left: current.chip.left + event.clientX - current.x,
              top: current.chip.top + event.clientY - current.y,
            },
          });
        }}
        onPointerUp={() => {
          const current = drag.current;
          cancelDrag();
          if (current?.moved && !disabled && current.original === values)
            onChange(current.order);
        }}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onKeyDown={(event) => {
          if (event.key === "Escape" && drag.current) {
            event.preventDefault();
            event.stopPropagation();
            cancelDrag();
          }
        }}
      >
        <TokenInput
          aria-activedescendant={
            menuOpen && options[activeIndex]
              ? `${menuId}-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={menuId}
          aria-expanded={menuOpen}
          aria-describedby={error || atLimit ? `${id}-feedback` : undefined}
          disabled={disabled}
          id={id}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(Boolean(tokenKey(event.target.value)));
            setError(null);
            onQueryChange?.(event.target.value);
          }}
          onFocus={() => setOpen(Boolean(tokenKey(query)))}
          onKeyDown={onKeyDown}
          placeholder={values.length ? "继续添加" : placeholder}
          role="combobox"
          type="text"
          value={query}
        >
          {(visiblePreview?.order ?? values).map((value) => (
            <TokenChip
              data-sort-token=""
              className={visiblePreview?.value === value ? "opacity-25" : undefined}
              disabled={disabled}
              key={tokenKey(value)}
              label={value}
              onRemove={() => remove(value)}
            >
              {sortable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  className="min-h-7 min-w-0 shrink touch-none cursor-grab whitespace-normal rounded-none px-0 text-left text-xs text-primary hover:bg-transparent [overflow-wrap:anywhere] active:cursor-grabbing"
                  aria-label={`拖动排序 ${value}，也可按 Alt 加方向键调整`}
                  onPointerDown={(event) => {
                    if (disabled || event.button !== 0 || !event.isPrimary) return;
                    const container = sortContainer.current;
                    if (!container) return;
                    const chip = event.currentTarget.closest("[data-sort-token]");
                    if (!chip) return;
                    const bounds = chip.getBoundingClientRect();
                    event.preventDefault();
                    container.setPointerCapture(event.pointerId);
                    drag.current = {
                      value,
                      original: values,
                      order: values,
                      slots: readDragSlots(
                        container.querySelectorAll("[data-sort-token]"),
                      ),
                      x: event.clientX,
                      y: event.clientY,
                      chip: {
                        left: bounds.left,
                        top: bounds.top,
                        width: bounds.width,
                        height: bounds.height,
                      },
                      moved: false,
                    };
                  }}
                  onKeyDown={(event) => {
                    if (
                      !event.altKey ||
                      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
                    ) return;
                    event.preventDefault();
                    const from = values.indexOf(value);
                    const to = from +
                      (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
                    if (to >= 0 && to < values.length)
                      onChange(moveDragItem(values, from, to));
                  }}
                >
                  {value}
                </Button>
              ) : value}
            </TokenChip>
          ))}
        </TokenInput>
        {menuOpen ? (
          <ComboboxOptions id={menuId} activeIndex={activeIndex}>
            {options.map((option, index) => (
              <ComboboxOption
                selected={index === activeIndex}
                id={`${menuId}-${index}`}
                key={`${option.kind}-${tokenKey(option.value)}`}
                onClick={() => add(option.value)}
                disabled={atLimit}
              >
                <span>{option.value}</span>
                <span className="shrink-0 text-xs text-muted">
                  {option.meta}
                </span>
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        ) : null}
      </div>
      {error || atLimit ? (
        <p
          className="text-sm text-destructive"
          id={`${id}-feedback`}
          role="status"
        >
          {error ?? `最多选择 ${maxValues} 项`}
        </p>
      ) : null}
      {showHelp ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 text-xs text-muted",
            showSelectionCount && "justify-between",
          )}
        >
          {showSelectionCount ? <span>已选 {values.length} 项</span> : null}
          <span>输入后按 Enter 添加</span>
        </div>
      ) : null}
      {showRecommendations && recommended.length ? (
        <RecommendationRow singleLineOnMobile={singleLineRecommendations}>
          {recommendationLabel ? (
            <span className="mr-1 shrink-0 whitespace-nowrap text-xs text-muted">
              {recommendationLabel}
            </span>
          ) : null}
          {recommended.map((item) => (
            <Button
              className="min-h-7 shrink-0 rounded-full border-dashed px-2.5 text-xs font-normal text-muted hover:border-primary hover:text-primary"
              disabled={disabled || atLimit}
              key={tokenKey(item.value)}
              onClick={() => add(item.value, false)}
              onMouseDown={(event) => event.preventDefault()}
              size="sm"
              type="button"
              variant="outline"
            >
              + {item.value}
            </Button>
          ))}
        </RecommendationRow>
      ) : null}
      {visiblePreview ? (
        <TokenDragPreview label={visiblePreview.value} {...visiblePreview.chip} />
      ) : null}
    </div>
  );
}

function RecommendationRow({
  children,
  singleLineOnMobile,
}: {
  children: ReactNode;
  singleLineOnMobile: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container || !singleLineOnMobile) return;
    const mobile = window.matchMedia("(max-width: 639px)");
    const items = Array.from(container.children) as HTMLElement[];
    function fit() {
      if (!container) return;
      items.forEach((item) => item.style.removeProperty("display"));
      if (!mobile.matches) return;
      const gap = parseFloat(getComputedStyle(container).columnGap) || 0;
      let used = 0;
      let full = false;
      items.forEach((item, index) => {
        const style = getComputedStyle(item);
        const width = item.offsetWidth +
          (parseFloat(style.marginLeft) || 0) +
          (parseFloat(style.marginRight) || 0);
        used += width + (index ? gap : 0);
        full ||= used > container.clientWidth;
        if (full) item.style.display = "none";
      });
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    mobile.addEventListener("change", fit);
    document.fonts.addEventListener("loadingdone", fit);
    return () => {
      observer.disconnect();
      mobile.removeEventListener("change", fit);
      document.fonts.removeEventListener("loadingdone", fit);
      items.forEach((item) => item.style.removeProperty("display"));
    };
  }, [children, singleLineOnMobile]);
  return (
    <div ref={ref} className="flex flex-wrap items-center gap-1.5">
      {children}
    </div>
  );
}

function normalizeToken(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function tokenKey(value: string): string {
  return normalizeToken(value).toLocaleLowerCase();
}
