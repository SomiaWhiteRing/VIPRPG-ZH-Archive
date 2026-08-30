"use client";

import { useMemo, useState, type FocusEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
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
  suggestions,
  values,
}: {
  disabled?: boolean;
  id: string;
  name?: string;
  onChange: (values: string[]) => void;
  placeholder: string;
  recommendationLabel: string;
  suggestions: UploadTaxonomySuggestion[];
  values: string[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedKeys = useMemo(() => new Set(values.map(tokenKey)), [values]);
  const options = useMemo<TokenOption[]>(() => {
    const normalizedQuery = tokenKey(query);
    const matches: TokenOption[] = suggestions
      .filter((item) => !selectedKeys.has(tokenKey(item.value)))
      .filter((item) => !normalizedQuery || tokenKey(item.value).includes(normalizedQuery))
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

  function add(rawValue: string) {
    const value = normalizeToken(rawValue);
    if (!value || selectedKeys.has(tokenKey(value))) return;
    onChange([...values, value]);
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  function remove(value: string) {
    onChange(values.filter((item) => tokenKey(item) !== tokenKey(value)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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
      const active = open ? options[activeIndex] : null;
      add(active?.value ?? query);
      return;
    }
    if (event.key === "Backspace" && !query && values.length) {
      remove(values[values.length - 1]);
      return;
    }
    if (event.key === "Escape") setOpen(false);
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  return (
    <div className={cn("grid gap-2", disabled && "opacity-60")} onBlur={onBlur}>
      {name ? <input name={name} readOnly type="hidden" value={values.join("\n")} /> : null}
      <div className="relative">
        <div
          className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
          onClick={() => document.getElementById(id)?.focus()}
        >
          {values.map((value) => (
            <span
              className="inline-flex min-h-7 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-xs font-semibold text-primary"
              key={tokenKey(value)}
            >
              {value}
              <Button
                aria-label={`移除 ${value}`}
                className="size-4 min-h-0 rounded-full p-0 hover:bg-primary/15"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  remove(value);
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X className="size-3" />
              </Button>
            </span>
          ))}
          <Input
            aria-activedescendant={open && options[activeIndex] ? `${menuId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            aria-controls={menuId}
            aria-expanded={open}
            className="h-auto min-h-7 min-w-40 flex-1 border-0 bg-transparent px-1 py-0 text-sm shadow-none outline-none placeholder:text-muted focus-visible:border-0 focus-visible:ring-0"
            disabled={disabled}
            id={id}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={values.length ? "继续添加" : placeholder}
            role="combobox"
            type="text"
            value={query}
          />
        </div>
        {open && !disabled && options.length ? (
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
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>已选 {values.length} 项</span>
        <span>输入后按 Enter 添加</span>
      </div>
      {recommended.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted">{recommendationLabel}</span>
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
