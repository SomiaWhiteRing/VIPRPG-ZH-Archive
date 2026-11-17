import { SearchComboBox } from "@/app/components/ui/search-combobox";
import { Button } from "@/app/components/ui/button";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import { creatorNameKey } from "@/lib/creator-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { useMessages } from "@/lib/i18n/react";
import { cn } from "@/lib/ui/cn";
import { useMemo } from "react";

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
  label,
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
  label?: string;
  suggestions: CreatorSuggestion[];
  value: CreatorSelection | null;
}) {
  const t = useMessages();
  const inputValue = value?.displayName ?? "";
  const identityLocked = value?.kind === "existing";
  const options = useMemo(
    () => (identityLocked ? [] : creatorOptions(suggestions, inputValue)),
    [identityLocked, inputValue, suggestions],
  );

  function choose(option: CreatorOption) {
    onChange({
      kind: "existing",
      creatorId: option.creator.id,
      name: option.creator.name,
      displayName: option.matchedName,
    });
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
    }
  }

  function unlockIdentity() {
    const displayName = value?.displayName ?? "";
    onChange(
      displayName ? { kind: "new", name: displayName, displayName } : null,
    );
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
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
      <SearchComboBox
        id={id}
        label={label ?? t("upload.staff.person")}
        query={inputValue}
        onQueryChange={changeDisplayName}
        disabled={disabled}
        invalid={invalid}
        descriptionId={errorId}
        placeholder={placeholder}
        items={options}
        getKey={(option) =>
          `${option.creator.id}:${creatorNameKey(option.matchedName)}`
        }
        getText={(option) => option.matchedName}
        onChoose={choose}
        isDefaultOption={(option) =>
          creatorNameKey(option.matchedName) === creatorNameKey(inputValue)
        }
        inputSuffix={
          compact && identityLocked ? (
            <Button
              className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-1.5 text-xs"
              disabled={disabled}
              title={t("upload.staff.linked", { name: value.name })}
              aria-label={t("upload.staff.replaceNamed", { name: value.name })}
              onClick={unlockIdentity}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("upload.staff.replace")}
            </Button>
          ) : identityLocked ? (
            <span />
          ) : undefined
        }
        renderItem={(option) => (
          <>
            <span>
              <strong>{option.matchedName}</strong>
              {option.matchedName !== option.creator.name ? (
                <span className="block text-xs text-muted">
                  {t("upload.staff.identity", { name: option.creator.name })}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted">
              {t("upload.staff.works", { count: option.creator.workCount })}
            </span>
          </>
        )}
      />
      {!compact ? (
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-2 text-xs text-muted">
          {value?.kind === "existing" ? (
            <>
              <span>{t("upload.staff.linked", { name: value.name })}</span>
              <Button
                disabled={disabled}
                onClick={unlockIdentity}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("upload.staff.replaceIdentity")}
              </Button>
            </>
          ) : value?.displayName.trim() ? (
            <span>{t("upload.staff.linkOnSave")}</span>
          ) : (
            <span>{t("upload.staff.aliasSearch")}</span>
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
