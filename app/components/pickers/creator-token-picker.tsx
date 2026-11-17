import { SearchComboBox } from "@/app/components/ui/search-combobox";
import {
  CreatorPicker,
  creatorOptions,
} from "@/app/components/pickers/creator-picker";
import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { Label } from "@/app/components/ui/label";
import { TokenChip, TokenDragPreview } from "@/app/components/ui/token-input";
import {
  tokenDragHandleClassName,
  useTokenReorder,
} from "@/app/components/ui/use-token-reorder";
import type { CreatorSelection, CreatorSuggestion } from "@/lib/creator-names";
import { creatorNameKey, creatorSelectionKey } from "@/lib/creator-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { creatorRoleLabel } from "@/lib/labels";
import { cn } from "@/lib/ui/cn";
import { useMemo, useRef, useState } from "react";

type CreatorTokenOption = { selection: CreatorSelection; meta: string };

export function CreatorTokenPicker({
  disabled = false,
  errorId,
  id,
  invalid = false,
  role,
  onChange,
  suggestions,
  values,
}: {
  disabled?: boolean;
  errorId?: string;
  id: string;
  invalid?: boolean;
  role: "author" | "translator";
  onChange: (values: CreatorSelection[]) => void;
  suggestions: CreatorSuggestion[];
  values: CreatorSelection[];
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const label = creatorRoleLabel(role, locale);
  const [query, setQuery] = useState("");
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
      meta: t("upload.staff.works", { count: option.creator.workCount }),
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
      matches.push({ selection, meta: t("upload.staff.create") });
    }
    return matches;
  }, [query, selectedKeys, suggestions, t]);
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

  const reorder = useTokenReorder(
    values,
    (next) => {
      setEditing(null);
      onChange(next);
    },
    disabled,
  );

  return (
    <>
      <div className={cn("grid gap-2", disabled && "opacity-60")}>
        <div className="relative" ref={reorder.container} {...reorder.containerProps}>
          <SearchComboBox
            id={id}
            query={query}
            onQueryChange={setQuery}
            disabled={disabled}
            items={options}
            isDefaultOption={(option) =>
              creatorNameKey(option.selection.displayName) === creatorNameKey(query)
            }
            label={label}
            placeholder={values.length ? t("upload.staff.addMore") : t("upload.staff.search", { role })}
            invalid={invalid}
            descriptionId={errorId}
            getKey={(option) =>
              `${creatorSelectionKey(option.selection)}:${option.selection.displayName}`
            }
            getText={(option) => option.selection.displayName}
            onChoose={(option) => add(option.selection)}
            onRemoveLast={() => {
              if (values.length) onChange(values.slice(0, -1));
            }}
            tokens={reorder.items.map(({ value, index }) => (
              <TokenChip
                {...reorder.chipProps(index)}
                className={reorder.preview?.index === index ? "opacity-25" : undefined}
                disabled={disabled}
                key={`${creatorSelectionKey(value)}:${index}`}
                label={value.displayName}
                onRemove={() =>
                  onChange(values.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Button
                  {...reorder.handleProps(index)}
                  aria-controls={`${id}-edit-dialog`}
                  aria-haspopup="dialog"
                  aria-label={t("upload.staff.editNamed", { role: label, name: value.displayName })}
                  aria-description={t("upload.staff.reorder")}
                  className={tokenDragHandleClassName}
                  disabled={disabled}
                  onClick={(event) => {
                    returnFocusRef.current = event.currentTarget;
                    setEditing({ index, selection: value });
                  }}
                  size="sm"
                  title={
                    value.kind === "existing"
                      ? t("upload.staff.linked", { name: value.name })
                      : value.name
                  }
                  type="button"
                  variant="ghost"
                >
                  <span className="truncate">{value.displayName}</span>
                </Button>
              </TokenChip>
            ))}
            renderItem={(option) => (
              <>
                <span>
                  {option.selection.displayName}
                  {option.selection.displayName !== option.selection.name ? (
                    <span className="block text-xs text-muted">
                      {t("upload.staff.identity", { name: option.selection.name })}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {option.meta}
                </span>
              </>
            )}
          />
        </div>
        <span className="text-xs text-muted">{t("upload.staff.enter")}</span>
      </div>
      {reorder.preview ? (
        <TokenDragPreview element={reorder.preview.element} {...reorder.preview.chip} />
      ) : null}

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
            <Dialog.Title>{t("upload.staff.edit", { role: label })}</Dialog.Title>
            <Dialog.Description className="sr-only">
              {t("upload.staff.editDescription", { role: label })}
            </Dialog.Description>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-edit-name`}>{t("upload.staff.credit", { role: label })}</Label>
              <CreatorPicker
                label={t("upload.staff.credit", { role: label })}
                disabled={disabled}
                id={`${id}-edit-name`}
                onChange={(selection) =>
                  setEditing((current) =>
                    current ? { ...current, selection } : null,
                  )
                }
                placeholder={t("upload.staff.search", { role })}
                suggestions={suggestions}
                value={editing?.selection ?? null}
              />
            </div>
            {duplicateEdit ? (
              <p className="text-sm text-red-700 dark:text-red-300" role="alert">
                {t("upload.staff.duplicate", { role: label })}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  {t("play.save.cancel")}
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
                {t("core.action.save")}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
