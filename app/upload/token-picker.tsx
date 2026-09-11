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
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedKeys = useMemo(() => new Set(values.map(tokenKey)), [values]);
  const options = useMemo<TokenOption[]>(() => {
    const normalizedQuery = tokenKey(query);
    if (!normalizedQuery) return [];
    const matches: TokenOption[] = suggestions
      .filter((item) => !selectedKeys.has(tokenKey(item.value)))
      .filter((item) => tokenKey(item.value).includes(normalizedQuery))
      .slice(0, 8)
      .map((item) => ({ ...item, kind: "existing" as const }));
    const normalizedValue = normalizeToken(query);
    const exactMatch = suggestions.some((item) => tokenKey(item.value) === tokenKey(normalizedValue));
    if (normalizedValue && !exactMatch && !selectedKeys.has(tokenKey(normalizedValue))) {
      matches.push({ value: normalizedValue, meta: "新建", kind: "create" });
    }
    return matches;
  }, [query, selectedKeys, suggestions]);
  const recommended = suggestions
    .filter((item) => !selectedKeys.has(tokenKey(item.value)))
    .slice(0, 6);
  const menuId = `${id}-options`;
  const menuOpen = open && !disabled && options.length > 0;

  function add(rawValue: string) {
    const value = normalizeToken(rawValue);
    if (!value || selectedKeys.has(tokenKey(value))) return;
    onChange([...values, value]);
    setQuery("");
    setActiveIndex(0);
    setOpen(false);
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
          disabled={disabled}
          id={id}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(Boolean(tokenKey(event.target.value)));
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
