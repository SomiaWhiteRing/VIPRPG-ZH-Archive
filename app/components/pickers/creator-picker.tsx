import {
  ComboboxOption,
  ComboboxOptions,
  handleComboboxNavigation,
} from "@/app/components/ui/combobox";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import { creatorNameKey } from "@/lib/creator-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { cn } from "@/lib/ui/cn";
import type { KeyboardEvent } from "react";
import { useMemo, useState } from "react";

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
    () => (identityLocked ? [] : creatorOptions(suggestions, inputValue)),
    [identityLocked, inputValue, suggestions],
  );
  const menuId = `${id}-options`;
  const menuOpen = open && !disabled && options.length > 0;

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
      onChange(
        rawValue
          ? { kind: "new", name: rawValue, displayName: rawValue }
          : null,
      );
      setOpen(Boolean(creatorNameKey(rawValue)));
      setActiveIndex(0);
    }
  }

  function unlockIdentity() {
    const displayName = value?.displayName ?? "";
    onChange(
      displayName ? { kind: "new", name: displayName, displayName } : null,
    );
    setOpen(Boolean(creatorNameKey(displayName)));
    setActiveIndex(0);
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (identityLocked) return;
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
      if (menuOpen && options[activeIndex]) choose(options[activeIndex]);
      else setOpen(false);
    }
  }

  return (
    <div className={cn("grid gap-1.5", disabled && "opacity-60")}>
      {name ? (
        <input
          name={name}
          readOnly
          type="hidden"
          value={value ? JSON.stringify(normalizedSelection(value)) : ""}
        />
      ) : null}
      <div className="relative">
        <Input
          className={compact && identityLocked ? "pr-12" : undefined}
          aria-activedescendant={
            menuOpen && options[activeIndex]
              ? `${menuId}-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={menuId}
          aria-describedby={errorId}
          aria-expanded={menuOpen}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          id={id}
          onBlur={() => setOpen(false)}
          onChange={(event) => changeDisplayName(event.target.value)}
          onFocus={() => {
            setOpen(!identityLocked && Boolean(creatorNameKey(inputValue)));
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          value={inputValue}
        />
        {compact && identityLocked ? (
          <Button
            className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-1.5 text-xs"
            disabled={disabled}
            title={`已关联：${value.name}`}
            aria-label={`更换人物，当前关联：${value.name}`}
            onClick={unlockIdentity}
            size="sm"
            type="button"
            variant="ghost"
          >
            更换
          </Button>
        ) : null}
        {menuOpen ? (
          <ComboboxOptions id={menuId} activeIndex={activeIndex}>
            {options.map((option, index) => (
              <ComboboxOption
                selected={index === activeIndex}
                className="min-h-10"
                id={`${menuId}-${index}`}
                key={`${option.creator.id}-${creatorNameKey(option.matchedName)}`}
                onClick={() => choose(option)}
              >
                <span>
                  <strong>{option.matchedName}</strong>
                  {option.matchedName !== option.creator.name ? (
                    <span className="block text-xs text-muted">
                      身份：{option.creator.name}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {option.creator.workCount} 部作品
                </span>
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        ) : null}
      </div>
      {!compact ? (
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-2 text-xs text-muted">
          {value?.kind === "existing" ? (
            <>
              <span>已关联：{value.name}</span>
              <Button
                disabled={disabled}
                onClick={unlockIdentity}
                size="sm"
                type="button"
                variant="ghost"
              >
                更换身份
              </Button>
            </>
          ) : value?.displayName.trim() ? (
            <span>保存时关联同名人物，未收录则新建。</span>
          ) : (
            <span>支持别名搜索</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function creatorOptions(
  suggestions: CreatorSuggestion[],
  query: string,
): CreatorOption[] {
  const queryKey = creatorNameKey(query);
  if (!queryKey) return [];
  const matches = suggestions.flatMap((creator) => [
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
    .sort(
      (left, right) =>
        matchRank(creatorNameKey(left.matchedName), queryKey) -
          matchRank(creatorNameKey(right.matchedName), queryKey) ||
        right.creator.workCount - left.creator.workCount ||
        left.creator.name.localeCompare(right.creator.name),
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
