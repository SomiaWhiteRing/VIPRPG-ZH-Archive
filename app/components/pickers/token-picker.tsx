import { SearchComboBox } from "@/app/components/ui/search-combobox";
import { Button } from "@/app/components/ui/button";
import { TokenChip, TokenDragPreview } from "@/app/components/ui/token-input";
import {
  tokenDragHandleClassName,
  useTokenReorder,
} from "@/app/components/ui/use-token-reorder";
import { cn } from "@/lib/ui/cn";
import type { ReactNode } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
export type TokenSuggestion = { value: string; meta: string };

type TokenOption = TokenSuggestion & { kind: "existing" | "create" };

export function TokenPicker({
  disabled = false,
  id,
  name,
  onChange,
  placeholder,
  label,
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
  label: string;
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
  const reorder = useTokenReorder(values, onChange, disabled || !sortable);
  const [query, setQuery] = useState("");
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
      .sort((left, right) =>
        Number(tokenKey(normalizeValue(right.value)) === normalizedQuery) -
        Number(tokenKey(normalizeValue(left.value)) === normalizedQuery),
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
    setError(null);
    onQueryChange?.("");
  }

  function remove(value: string) {
    onChange(values.filter((item) => tokenKey(item) !== tokenKey(value)));
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
        ref={reorder.container}
        {...reorder.containerProps}
      >
        <SearchComboBox
          id={id}
          query={query}
          onQueryChange={(value) => {
            setQuery(value);
            setError(null);
            onQueryChange?.(value);
          }}
          disabled={disabled}
          items={options}
          isDefaultOption={(option) =>
            tokenKey(normalizeValue(option.value)) === tokenKey(normalizeValue(query))
          }
          label={label}
          placeholder={values.length ? "继续添加" : placeholder}
          descriptionId={error || atLimit ? `${id}-feedback` : undefined}
          getKey={(option) => `${option.kind}:${tokenKey(option.value)}`}
          getText={(option) => option.value}
          isItemDisabled={() => atLimit}
          onChoose={(option) => add(option.value)}
          onCommit={() => add(query)}
          onRemoveLast={() => {
            if (values.length) remove(values[values.length - 1]);
          }}
          tokens={reorder.items.map(({ value, index }) => (
            <TokenChip
              {...reorder.chipProps(index)}
              className={
                reorder.preview?.index === index ? "opacity-25" : undefined
              }
              disabled={disabled}
              key={tokenKey(value)}
              label={value}
              onRemove={() => remove(value)}
            >
              {sortable ? (
                <Button
                  {...reorder.handleProps(index)}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  className={tokenDragHandleClassName}
                  aria-label={`拖动排序 ${value}，也可按 Alt 加方向键调整`}
                >
                  {value}
                </Button>
              ) : (
                value
              )}
            </TokenChip>
          ))}
          renderItem={(option) => (
            <>
              <span>{option.value}</span>
              <span className="shrink-0 text-xs text-muted">{option.meta}</span>
            </>
          )}
        />
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
      {reorder.preview ? (
        <TokenDragPreview
          element={reorder.preview.element}
          {...reorder.preview.chip}
        />
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
        const width =
          item.offsetWidth +
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
