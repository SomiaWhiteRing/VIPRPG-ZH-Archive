"use client";

import { useMemo, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import { creatorNameKey } from "@/lib/creator-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { cn } from "@/lib/ui/cn";

type CreatorOption = {
  creator: CreatorSuggestion;
  matchedName: string;
  matchedKind: "规范名" | "别名";
};

export function CreatorPicker({
  compact = false,
  disabled = false,
  errorId,
  id,
  invalid = false,
  name,
  onChange,
  placeholder,
  suggestions,
  value,
}: {
  compact?: boolean;
  disabled?: boolean;
  errorId?: string;
  id: string;
  invalid?: boolean;
  name?: string;
  onChange: (value: CreatorSelection | null) => void;
  placeholder: string;
  suggestions: CreatorSuggestion[];
  value: CreatorSelection | null;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputValue = value?.displayName ?? "";
  const identityLocked = value?.kind === "existing";
  const options = useMemo(
    () => identityLocked ? [] : creatorOptions(suggestions, inputValue),
    [identityLocked, inputValue, suggestions],
  );
  const menuId = `${id}-options`;

  function choose(option: CreatorOption) {
    onChange({
      kind: "existing",
      creatorId: option.creator.id,
      name: option.creator.name,
      displayName: option.matchedName,
    });
    setOpen(false);
    setActiveIndex(0);
  }

  function changeDisplayName(rawValue: string) {
    if (value?.kind === "existing") {
      onChange({ ...value, displayName: rawValue });
    } else {
      onChange(rawValue ? { kind: "new", name: rawValue, displayName: rawValue, disambiguation: value?.kind === "new" ? value.disambiguation : "" } : null);
      setOpen(true);
      setActiveIndex(0);
    }
  }

  function unlockIdentity() {
    const displayName = value?.displayName ?? "";
    onChange(displayName
      ? { kind: "new", name: displayName, displayName }
      : null);
    setOpen(true);
    setActiveIndex(0);
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (identityLocked) return;
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % options.length);
    } else if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current - 1 + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && options[activeIndex]) choose(options[activeIndex]);
      else setOpen(false);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  return (
    <div className={cn("grid gap-1.5", disabled && "opacity-60")} onBlur={onBlur}>
      {name ? <input name={name} readOnly type="hidden" value={value ? JSON.stringify(normalizedSelection(value)) : ""} /> : null}
      <div className="relative">
        <Input
          className={compact && identityLocked ? "pr-12" : undefined}
          aria-activedescendant={open && options[activeIndex] ? `${menuId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={menuId}
          aria-describedby={errorId}
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          id={id}
          onChange={(event) => changeDisplayName(event.target.value)}
          onFocus={() => {
            if (!identityLocked) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          value={inputValue}
        />
        {compact && identityLocked ? (
          <Button className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-1.5 text-xs" disabled={disabled}
            title={`已关联：${value.name}`} aria-label={`更换人物，当前关联：${value.name}`}
            onClick={unlockIdentity} size="sm" type="button" variant="ghost">更换</Button>
        ) : null}
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
                  "flex min-h-10 w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left text-sm font-normal",
                  index === activeIndex && "bg-primary/10 text-primary",
                )}
                id={`${menuId}-${index}`}
                key={`${option.creator.id}-${creatorNameKey(option.matchedName)}`}
                onClick={() => choose(option)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                size="sm"
                type="button"
                variant="ghost"
              >
                <span>
                  <strong>{option.matchedName}</strong>
                  {option.matchedName !== option.creator.name ? (
                    <span className="block text-xs text-muted">身份：{option.creator.name}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-muted">{option.creator.disambiguation || `人物 #${option.creator.id}`}</span>
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {value?.kind === "new" ? <Input aria-label="同名区分说明" placeholder="同名区分说明（所属团队或代表作）"
        disabled={disabled} value={value.disambiguation ?? ""}
        onChange={(event) => onChange({ ...value, disambiguation: event.target.value })} /> : null}
      {!compact ? <div className="flex min-h-7 flex-wrap items-center justify-between gap-2 text-xs text-muted">
        {value?.kind === "existing" ? (
          <>
            <span>已关联：{value.name}</span>
            <Button disabled={disabled} onClick={unlockIdentity} size="sm" type="button" variant="ghost">
              更换身份
            </Button>
          </>
        ) : value?.displayName.trim() ? (
          <span>新建人物；如已收录，请从搜索结果选择。</span>
        ) : (
          <span>输入名称可搜索规范名和别名。</span>
        )}
      </div> : null}
    </div>
  );
}

function creatorOptions(
  suggestions: CreatorSuggestion[],
  query: string,
): CreatorOption[] {
  const queryKey = creatorNameKey(query);
  if (!queryKey) return suggestions.slice(0, 8).map((creator) => ({
    creator,
    matchedName: creator.name,
    matchedKind: "规范名",
  }));
  const matches = suggestions
    .flatMap((creator) => [
      { creator, matchedName: creator.name, matchedKind: "规范名" as const },
      ...creator.aliases.map((alias) => ({
        creator,
        matchedName: alias.name,
        matchedKind: "别名" as const,
      })),
    ]);
  const uniqueMatches = new Map<string, CreatorOption>();
  for (const option of matches) {
    const key = `${option.creator.id}:${creatorNameKey(option.matchedName)}`;
    if (!uniqueMatches.has(key)) uniqueMatches.set(key, option);
  }
  return [...uniqueMatches.values()]
    .filter((option) => creatorNameKey(option.matchedName).includes(queryKey))
    .sort((left, right) =>
      matchRank(creatorNameKey(left.matchedName), queryKey)
      - matchRank(creatorNameKey(right.matchedName), queryKey)
      || right.creator.workCount - left.creator.workCount
      || left.creator.name.localeCompare(right.creator.name),
    )
    .slice(0, 8);
}

function matchRank(value: string, query: string): number {
  return value === query ? 0 : value.startsWith(query) ? 1 : 2;
}

function normalizedSelection(value: CreatorSelection): CreatorSelection {
  const displayName = normalizeEntityName(value.displayName);
  const name = normalizeEntityName(value.name);
  return value.kind === "existing"
    ? { ...value, name, displayName }
    : { ...value, kind: "new", name, displayName };
}
