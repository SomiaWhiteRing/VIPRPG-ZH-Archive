import {
  ComboboxOption,
  ComboboxOptions,
  handleComboboxNavigation,
} from "@/app/components/ui/combobox";

import {
  CreatorPicker,
  creatorOptions,
} from "@/app/components/pickers/creator-picker";
import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { Label } from "@/app/components/ui/label";
import { TokenChip, TokenInput } from "@/app/components/ui/token-input";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import { creatorNameKey, creatorSelectionKey } from "@/lib/creator-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { cn } from "@/lib/ui/cn";
import type { KeyboardEvent } from "react";
import { useMemo, useRef, useState } from "react";

type CreatorTokenOption = { selection: CreatorSelection; meta: string };

export function CreatorTokenPicker({
  disabled = false,
  errorId,
  id,
  invalid = false,
  label,
  onChange,
  suggestions,
  values,
}: {
  disabled?: boolean;
  errorId?: string;
  id: string;
  invalid?: boolean;
  label: "作者" | "译者";
  onChange: (values: CreatorSelection[]) => void;
  suggestions: CreatorSuggestion[];
  values: CreatorSelection[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [editing, setEditing] = useState<{
    index: number;
    selection: CreatorSelection | null;
  } | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const selectedKeys = useMemo(
    () => new Set(values.map(creatorSelectionKey)),
    [values],
  );
  const options = useMemo<CreatorTokenOption[]>(() => {
    const matches: CreatorTokenOption[] = creatorOptions(
      suggestions.filter(
        (creator) => !selectedKeys.has(`existing:${creator.id}`),
      ),
      query,
    ).map((option) => ({
      selection: {
        kind: "existing",
        creatorId: option.creator.id,
        name: option.creator.name,
        displayName: option.matchedName,
      },
      meta: `${option.creator.workCount} 部作品`,
    }));
    const name = normalizeEntityName(query);
    const selection: CreatorSelection = {
      kind: "new",
      name,
      displayName: name,
    };
    const nameKey = creatorNameKey(name);
    const exactMatch = suggestions.some(
      (creator) =>
        creatorNameKey(creator.name) === nameKey ||
        creator.aliases.some((alias) => creatorNameKey(alias.name) === nameKey),
    );
    if (
      name &&
      !exactMatch &&
      !selectedKeys.has(creatorSelectionKey(selection))
    ) {
      matches.push({ selection, meta: "新建" });
    }
    return matches;
  }, [query, selectedKeys, suggestions]);
  const menuId = `${id}-options`;
  const menuOpen = open && !disabled && options.length > 0;
  const editingSelection = editing?.selection;
  const duplicateEdit =
    editingSelection &&
    values.some(
      (value, index) =>
        index !== editing?.index &&
        creatorSelectionKey(value) === creatorSelectionKey(editingSelection),
    );

  function add(selection: CreatorSelection) {
    if (selectedKeys.has(creatorSelectionKey(selection))) return;
    onChange([...values, selection]);
    setQuery("");
    setActiveIndex(0);
    setOpen(false);
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
      const active = menuOpen
        ? options[activeIndex]
        : query.trim()
          ? options[0]
          : null;
      if (active) add(active.selection);
    } else if (event.key === "Backspace" && !query && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  function saveEdit() {
    if (disabled || !editing?.selection || duplicateEdit) return;
    const selection = {
      ...editing.selection,
      name: normalizeEntityName(editing.selection.name),
      displayName: normalizeEntityName(editing.selection.displayName),
    };
    if (!selection.name || !selection.displayName) return;
    onChange(
      values.map((value, index) =>
        index === editing.index ? selection : value,
      ),
    );
    setEditing(null);
  }

  return (
    <>
      <div className={cn("grid gap-2", disabled && "opacity-60")}>
        <div className="relative">
          <TokenInput
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
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setOpen(Boolean(creatorNameKey(event.target.value)));
            }}
            onFocus={() => setOpen(Boolean(creatorNameKey(query)))}
            onKeyDown={onKeyDown}
            placeholder={values.length ? "继续添加" : `搜索或新建${label}`}
            role="combobox"
            value={query}
          >
            {values.map((value, index) => (
              <TokenChip
                disabled={disabled}
                key={`${creatorSelectionKey(value)}:${index}`}
                label={value.displayName}
                onRemove={() =>
                  onChange(values.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Button
                  aria-controls={`${id}-edit-dialog`}
                  aria-haspopup="dialog"
                  aria-label={`编辑${label} ${value.displayName}`}
                  className="h-auto min-h-7 min-w-0 px-0 text-xs font-semibold hover:bg-transparent"
                  disabled={disabled}
                  onClick={(event) => {
                    returnFocusRef.current = event.currentTarget;
                    setOpen(false);
                    setEditing({ index, selection: value });
                  }}
                  size="sm"
                  title={
                    value.kind === "existing"
                      ? `已关联：${value.name}`
                      : value.name
                  }
                  type="button"
                  variant="ghost"
                >
                  <span className="truncate">{value.displayName}</span>
                </Button>
              </TokenChip>
            ))}
          </TokenInput>
          {menuOpen ? (
            <ComboboxOptions id={menuId} activeIndex={activeIndex}>
              {options.map((option, index) => (
                <ComboboxOption
                  selected={index === activeIndex}
                  id={`${menuId}-${index}`}
                  key={`${creatorSelectionKey(option.selection)}:${option.selection.displayName}`}
                  onClick={() => add(option.selection)}
                >
                  <span>
                    {option.selection.displayName}
                    {option.selection.displayName !== option.selection.name ? (
                      <span className="block text-xs text-muted">
                        身份：{option.selection.name}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {option.meta}
                  </span>
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          ) : null}
        </div>
        <span className="text-xs text-muted">输入后按 Enter 添加</span>
      </div>

      <Dialog.Root
        open={editing !== null}
        onOpenChange={(nextOpen) => !nextOpen && setEditing(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content
            className="left-1/2 top-1/2 grid w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg p-5"
            id={`${id}-edit-dialog`}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = returnFocusRef.current?.isConnected
                ? returnFocusRef.current
                : document.getElementById(id);
              target?.focus();
            }}
          >
            <Dialog.Title>编辑{label}</Dialog.Title>
            <Dialog.Description className="sr-only">
              修改{label}署名或关联人物。
            </Dialog.Description>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-edit-name`}>{label}署名</Label>
              <CreatorPicker
                disabled={disabled}
                id={`${id}-edit-name`}
                onChange={(selection) =>
                  setEditing((current) =>
                    current ? { ...current, selection } : null,
                  )
                }
                placeholder={`搜索或新建${label}`}
                suggestions={suggestions}
                value={editing?.selection ?? null}
              />
            </div>
            {duplicateEdit ? (
              <p className="text-sm text-red-700" role="alert">
                该{label}已添加。
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  取消
                </Button>
              </Dialog.Close>
              <Button
                disabled={
                  disabled ||
                  !editing?.selection?.name.trim() ||
                  !editing.selection.displayName.trim() ||
                  Boolean(duplicateEdit)
                }
                onClick={saveEdit}
                type="button"
              >
                保存
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
