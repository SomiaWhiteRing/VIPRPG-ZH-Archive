"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { Button } from "@/app/components/ui/button";
import { TokenChip, TokenInput } from "@/app/upload/token-input";
import type { UploadTaxonomySuggestion } from "@/app/upload/upload-types";
import { cn } from "@/lib/ui/cn";

type TokenOption = UploadTaxonomySuggestion & { kind: "existing" | "create" };

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
  values,
  maxValues,
  normalizeValue = normalizeToken,
  validateValue,
  onQueryChange,
  sortable = false,
}: {
  disabled?: boolean;
  id: string;
  name?: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  recommendationLabel?: string;
  showRecommendations?: boolean;
  showSelectionCount?: boolean;
  suggestions: UploadTaxonomySuggestion[];
  values: string[];
  maxValues?: number;
  normalizeValue?: (value: string) => string;
  validateValue?: (value: string) => string | null;
  onQueryChange?: (query: string) => void;
  sortable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const atLimit = maxValues !== undefined && values.length >= maxValues;
  const selectedKeys = useMemo(() => new Set(values.map(value => tokenKey(normalizeValue(value)))), [values,normalizeValue]);
  const options = useMemo<TokenOption[]>(() => {
    const normalizedQuery = tokenKey(normalizeValue(query));
    if (!normalizedQuery) return [];
    const matches: TokenOption[] = suggestions
      .filter((item) => !selectedKeys.has(tokenKey(normalizeValue(item.value))))
      .filter((item) => tokenKey(normalizeValue(item.value)).includes(normalizedQuery))
      .slice(0, 8)
      .map((item) => ({ ...item, kind: "existing" as const }));
    const normalizedValue = normalizeValue(query);
    const exactMatch = suggestions.some((item) => tokenKey(normalizeValue(item.value)) === tokenKey(normalizedValue));
    if (normalizedValue && !exactMatch && !selectedKeys.has(tokenKey(normalizedValue))) {
      matches.push({ value: normalizedValue, meta: "新建", kind: "create" });
    }
    return matches;
  }, [query, selectedKeys, suggestions,normalizeValue]);
  const recommended = suggestions
    .filter((item) => !selectedKeys.has(tokenKey(item.value)))
    .slice(0, 6);
  const menuId = `${id}-options`;
  const menuOpen = open && !disabled && options.length > 0;

  function add(rawValue: string) {
    if (disabled || atLimit) return;
    const validation = (query ? validateValue?.(query) : null) ?? validateValue?.(rawValue);
    if (validation) { setError(validation); return; }
    const value = normalizeValue(rawValue);
    if (!value || selectedKeys.has(tokenKey(value))) return;
    onChange([...values, value]);
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
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const active = menuOpen ? options[activeIndex] : null;
      add(active?.value ?? query);
      return;
    }
    if (event.key === "Backspace" && !query && values.length) {
      remove(values[values.length - 1]);
      return;
    }
    if (event.key === "Escape") setOpen(false);
  }

  return (
    <div className={cn("grid gap-2", disabled && "opacity-60")}>
      {name ? <input name={name} readOnly type="hidden" value={values.join("\n")} /> : null}
      <div className="relative">
        <TokenInput
          aria-activedescendant={menuOpen && options[activeIndex] ? `${menuId}-${activeIndex}` : undefined}
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
          {values.map((value) => (
            <TokenChip disabled={disabled} key={tokenKey(value)} label={value} onRemove={() => remove(value)}>
              {value}
            </TokenChip>
          ))}
        </TokenInput>
        {menuOpen ? (
          <div
            className="absolute inset-x-0 top-[calc(100%+0.25rem)] z-30 max-h-64 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-surface"
            id={menuId}
            role="listbox"
          >
            {options.map((option, index) => (
              <Button
                aria-selected={index === activeIndex}
                className={cn(
                  "flex min-h-9 w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left text-sm font-normal",
                  index === activeIndex && "bg-primary/10 text-primary",
                )}
                id={`${menuId}-${index}`}
                key={`${option.kind}-${tokenKey(option.value)}`}
                onClick={() => add(option.value)}
                disabled={atLimit}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                size="sm"
                tabIndex={-1}
                type="button"
                variant="ghost"
              >
                <span>{option.value}</span>
                <span className="shrink-0 text-xs text-muted">{option.meta}</span>
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {error || atLimit ? <p className="text-sm text-destructive" id={`${id}-feedback`} role="status">{error ?? `最多选择 ${maxValues} 项`}</p> : null}
      {sortable && values.length > 1 ? <div className="flex flex-wrap gap-1" aria-label="TAG 顺序">
        {values.map((value,index) => <Button className="min-h-9 text-xs" disabled={disabled || index===0} key={value} size="sm" type="button" variant="ghost" aria-label={`将 ${value} 前移`} onClick={()=>{const next=[...values];[next[index-1],next[index]]=[next[index],next[index-1]];onChange(next);}}>{value} ↑</Button>)}
      </div> : null}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 text-xs text-muted",
          showSelectionCount && "justify-between",
        )}
      >
        {showSelectionCount ? <span>已选 {values.length} 项</span> : null}
        <span>输入后按 Enter 添加</span>
      </div>
      {showRecommendations && recommended.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {recommendationLabel ? (
            <span className="mr-1 text-xs text-muted">{recommendationLabel}</span>
          ) : null}
          {recommended.map((item) => (
            <Button
              className="min-h-7 rounded-full border-dashed px-2.5 text-xs font-normal text-muted hover:border-primary hover:text-primary"
              disabled={disabled}
              key={tokenKey(item.value)}
              onClick={() => add(item.value)}
              size="sm"
              type="button"
              variant="outline"
            >
              + {item.value}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeToken(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function tokenKey(value: string): string {
  return normalizeToken(value).toLocaleLowerCase();
}
