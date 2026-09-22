import { SearchComboBox } from "@/app/components/ui/search-combobox";
import type { CharacterNameInput } from "@/app/components/characters/character-create-dialog";
import { CharacterCreateDialog } from "@/app/components/characters/character-create-dialog";
import { badgeVariants } from "@/app/components/ui/badge";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import * as Dialog from "@/app/components/ui/dialog";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FaceSheetGrid } from "@/app/components/ui/face-sheet-grid";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { TokenChip, TokenDragPreview } from "@/app/components/ui/token-input";
import {
  tokenDragHandleClassName,
  useTokenReorder,
} from "@/app/components/ui/use-token-reorder";
import type {
  CharacterCreditSelection,
  CharacterFaceSheet,
  CharacterNameLanguage,
  CharacterPortrait as CharacterPortraitValue,
  CharacterRoleKey,
  CharacterSelection,
  CharacterSuggestion,
} from "@/lib/character-names";
import {
  CHARACTER_ROLE_LABELS,
  characterNameKey,
  characterSelectionKey,
  characterSelectionLabel,
  isCharacterRoleKey,
} from "@/lib/character-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { inspectCharacterFaceSheetFile } from "@/lib/ui/character-face-sheet";
import { cn } from "@/lib/ui/cn";
import { Pencil, X } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type ExistingOption = {
  kind: "existing";
  selection: Extract<CharacterSelection, { kind: "existing" }>;
  defaultPortrait: CharacterPortraitValue | null;
  meta: string;
  rank: number;
  workCount: number;
};
type CreateOption = { kind: "create"; query: string };
type CharacterOption = ExistingOption | CreateOption;
const EMPTY_FACE_SHEET_FILES: Record<number, File[]> = {};
const CHARACTER_ROLE_OPTIONS = Object.entries(CHARACTER_ROLE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export function CharacterPicker({
  disabled = false,
  id,
  name,
  onChange,
  onFaceSheetFilesChange,
  onFaceSheetFilesRemove,
  faceSheetFiles = EMPTY_FACE_SHEET_FILES,
  suggestions,
  values,
}: {
  disabled?: boolean;
  id: string;
  name?: string;
  onChange: (
    values: CharacterCreditSelection[],
    reorderedIndices?: number[],
  ) => void;
  onFaceSheetFilesChange?: (index: number, files: File[]) => void;
  onFaceSheetFilesRemove?: (index: number) => void;
  faceSheetFiles?: Record<number, File[]>;
  suggestions: CharacterSuggestion[];
  values: CharacterCreditSelection[];
}) {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createQuery, setCreateQuery] = useState("");
  const [portraitIndex, setPortraitIndex] = useState<number | null>(null);
  const [aliasEdit, setAliasEdit] = useState<{
    index: number;
    value: string;
    roleKey: CharacterRoleKey;
  } | null>(null);
  const createReturnFocusRef = useRef<HTMLElement | null>(null);
  const portraitReturnFocusRef = useRef<HTMLElement | null>(null);
  const aliasReturnFocusRef = useRef<HTMLElement | null>(null);
  const [portraitErrors, setPortraitErrors] = useState<Record<number, string>>(
    {},
  );
  const suggestionsById = useMemo(
    () => new Map(suggestions.map((suggestion) => [suggestion.id, suggestion])),
    [suggestions],
  );
  const options = useMemo<CharacterOption[]>(() => {
    const queryKey = characterNameKey(query);
    if (!queryKey) return [];
    const matches = suggestions
      .map((suggestion) => optionForSuggestion(suggestion, queryKey))
      .filter((option): option is ExistingOption => Boolean(option))
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          right.workCount - left.workCount ||
          characterSelectionLabel(left.selection).localeCompare(
            characterSelectionLabel(right.selection),
            "zh-CN",
          ),
      )
      .slice(0, 8);
    const exactMatch = suggestions.some((suggestion) =>
      characterNames(suggestion).some(
        (item) => characterNameKey(item.name) === queryKey,
      ),
    );
    return exactMatch
      ? matches
      : [
          ...matches,
          { kind: "create" as const, query: normalizeEntityName(query) },
        ];
  }, [query, suggestions]);
  const selectedCharacterIds = new Set(
    values.flatMap((credit) =>
      credit.selection.kind === "existing"
        ? [credit.selection.characterId]
        : [],
    ),
  );
  const recommended = suggestions
    .filter((item) => !selectedCharacterIds.has(item.id))
    .slice(0, 6);
  const activeCredit =
    portraitIndex === null ? null : (values[portraitIndex] ?? null);
  const activeSuggestion =
    activeCredit?.selection.kind === "existing"
      ? (suggestionsById.get(activeCredit.selection.characterId) ?? null)
      : null;

  function addExisting(
    selection: Extract<CharacterSelection, { kind: "existing" }>,
  ) {
    onChange([
      ...values,
      { selection, roleKey: "main", portrait: null, faceSheetBlobSha256s: [] },
    ]);
    setQuery("");
  }

  function remove(index: number) {
    onFaceSheetFilesRemove?.(index);
    setPortraitErrors((current) => removeIndexedValue(current, index));
    setPortraitIndex((current) => {
      if (current === null || current < index) return current;
      return current === index ? null : current - 1;
    });
    setAliasEdit((current) => {
      if (!current || current.index < index) return current;
      return current.index === index
        ? null
        : { ...current, index: current.index - 1 };
    });
    onChange(values.filter((_, itemIndex) => itemIndex !== index));
  }

  function saveAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || !aliasEdit) return;
    const displayName = normalizeEntityName(aliasEdit.value);
    if (!displayName || !values[aliasEdit.index]) return;
    onChange(
      values.map((credit, index) =>
        index === aliasEdit.index
          ? {
              ...credit,
              selection: { ...credit.selection, displayName },
              roleKey: aliasEdit.roleKey,
            }
          : credit,
      ),
    );
    setAliasEdit(null);
  }

  function updatePortrait(
    index: number,
    portrait: CharacterCreditSelection["portrait"],
  ) {
    onChange(
      values.map((item, itemIndex) =>
        itemIndex === index ? { ...item, portrait } : item,
      ),
    );
  }

  function startCreate(rawQuery: string) {
    const activeElement = document.activeElement;
    createReturnFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
    const originalName = normalizeEntityName(rawQuery);
    setCreateQuery(originalName);
    setCreateOpen(true);
  }

  function addNewCharacter({ originalName, displayName }: CharacterNameInput) {
    const selection: CharacterSelection = {
      kind: "new",
      originalName,
      primaryName: displayName,
      displayName,
    };
    onChange([
      ...values,
      { selection, roleKey: "main", portrait: null, faceSheetBlobSha256s: [] },
    ]);
    setQuery("");
    portraitReturnFocusRef.current = document.getElementById(id);
    setPortraitIndex(values.length);
  }

  async function addFaceSheetFiles(
    index: number,
    files: File[],
  ): Promise<string[]> {
    if (!onFaceSheetFilesChange || !files.length) return [];
    try {
      const existing = await Promise.all(
        (faceSheetFiles[index] ?? []).map(async (file) => ({
          file,
          ...(await inspectNamedFaceSheet(file)),
        })),
      );
      const added = await Promise.all(
        files.map(async (file) => ({
          file,
          ...(await inspectNamedFaceSheet(file)),
        })),
      );
      const uniqueSheets = [
        ...new Map(
          [...existing, ...added].map((sheet) => [sheet.sha256, sheet]),
        ).values(),
      ];
      const hashes = uniqueSheets.map((sheet) => sheet.sha256);
      onFaceSheetFilesChange(
        index,
        uniqueSheets.map((sheet) => sheet.file),
      );
      onChange(
        values.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                faceSheetBlobSha256s: hashes,
                portrait:
                  item.portrait ??
                  (item.selection.kind === "existing" &&
                  suggestionsById.get(item.selection.characterId)
                    ?.defaultPortrait
                    ? null
                    : { blobSha256: added[0].sha256, row: 0, column: 0 }),
              }
            : item,
        ),
      );
      setPortraitErrors((current) => omitKey(current, index));
      return added.map((sheet) => sheet.sha256);
    } catch (error) {
      setPortraitErrors((current) => ({
        ...current,
        [index]:
          error instanceof Error ? error.message : "无法读取脸图素材表。",
      }));
      return [];
    }
  }

  function removeFaceSheetFile(index: number, file: File, sha256: string) {
    const nextFiles = (faceSheetFiles[index] ?? []).filter(
      (item) => item !== file,
    );
    onFaceSheetFilesChange?.(index, nextFiles);
    onChange(
      values.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              faceSheetBlobSha256s: item.faceSheetBlobSha256s.filter(
                (hash) => hash !== sha256,
              ),
              portrait:
                item.portrait?.blobSha256 === sha256 ? null : item.portrait,
            }
          : item,
      ),
    );
    setPortraitErrors((current) => omitKey(current, index));
  }

  const reorder = useTokenReorder(
    values,
    (next) => {
      const indices = next.map((credit) => values.indexOf(credit));
      setPortraitErrors((current) => Object.fromEntries(
        indices.flatMap((oldIndex, index) =>
          current[oldIndex] ? [[index, current[oldIndex]]] : [],
        ),
      ));
      setPortraitIndex((current) => current === null ? null : indices.indexOf(current));
      setAliasEdit((current) => current === null ? null : {
        ...current, index: indices.indexOf(current.index),
      });
      onChange(next, indices);
    },
    disabled,
  );

  return (
    <>
      <div className={cn("grid gap-2", disabled && "opacity-60")}>
        {name ? (
          <input
            name={name}
            readOnly
            type="hidden"
            value={JSON.stringify(values)}
          />
        ) : null}
        <div className="relative" ref={reorder.container} {...reorder.containerProps}>
          <SearchComboBox
            id={id}
            query={query}
            onQueryChange={setQuery}
            disabled={disabled}
            items={options}
            enterSelectsFirst
            label="登场角色"
            placeholder={
              values.length ? "添加更多" : "本作的主要角色（或更多）"
            }
            preserveHoverRows
            itemClassName="min-h-12"
            getKey={(option) =>
              option.kind === "create"
                ? `create:${option.query}`
                : option.selection.characterId
            }
            getText={(option) =>
              option.kind === "create"
                ? `新增角色“${option.query}”`
                : option.selection.displayName
            }
            onChoose={(option) =>
              option.kind === "create"
                ? startCreate(option.query)
                : addExisting(option.selection)
            }
            onRemoveLast={() => {
              if (values.length) remove(values.length - 1);
            }}
            tokens={reorder.items.map(({ value: credit, index }) => {
              const selection = credit.selection;
              const label = selection.displayName;
              const suggestion =
                selection.kind === "existing"
                  ? (suggestionsById.get(selection.characterId) ?? null)
                  : null;
              const files = faceSheetFiles[index] ?? [];
              const missingPortrait = !hasPortrait(credit, suggestion);
              return (
                <TokenChip
                  {...reorder.chipProps(index)}
                  className={cn(
                    missingPortrait && "bg-red-700/10",
                    reorder.preview?.index === index && "opacity-25",
                  )}
                  disabled={disabled}
                  key={`${characterSelectionKey(selection)}:${index}`}
                  label={label}
                  onRemove={() => remove(index)}
                >
                  <Button
                    aria-controls={`${id}-portrait-dialog`}
                    aria-expanded={portraitIndex === index}
                    aria-haspopup="dialog"
                    aria-label={`选择 ${label} 的头像`}
                    className="group/portrait relative size-6 min-h-0 cursor-pointer overflow-hidden rounded-sm p-0 hover:bg-transparent"
                    disabled={disabled}
                    onClick={(event) => {
                      portraitReturnFocusRef.current = event.currentTarget;
                      setPortraitIndex(index);
                    }}
                    size="icon"
                    title={`${label} · ${portraitStatus(credit, suggestion, files)}`}
                    type="button"
                    variant="ghost"
                  >
                    <LocalPortraitPreview
                      credit={credit}
                      files={files}
                      portrait={resolvePortrait(credit, suggestion)}
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 grid place-items-center bg-black/55 text-white opacity-0 transition-opacity group-hover/portrait:opacity-100 group-focus-visible/portrait:opacity-100 motion-reduce:transition-none"
                    >
                      <Pencil className="size-3.5" />
                    </span>
                  </Button>
                  <span className="group/character-name inline-flex min-w-0 items-center">
                    <Button
                      {...reorder.handleProps(index)}
                      className={tokenDragHandleClassName}
                      aria-label={`拖动排序 ${label}，也可按 Alt 加方向键调整`}
                      disabled={disabled}
                      type="button"
                      variant="ghost"
                      size="sm"
                    >
                      <span className="truncate">{label}</span>
                    </Button>
                    <span
                      className={cn(
                        badgeVariants({ variant: "neutral" }),
                        "ml-1.5 min-h-5 shrink-0 px-1.5 py-0 text-[10px] font-normal text-secondary",
                      )}
                    >
                      {CHARACTER_ROLE_LABELS[credit.roleKey]}
                    </span>
                    {!disabled ? (
                      <Button
                        aria-controls={`${id}-alias-dialog`}
                        aria-expanded={aliasEdit?.index === index}
                        aria-haspopup="dialog"
                        aria-label={`编辑 ${label} 的详细信息`}
                        data-token-hover-expansion=""
                        className="pointer-events-none size-5 min-h-0 w-0 shrink-0 -translate-x-1 cursor-pointer overflow-hidden rounded-sm p-0 text-current opacity-0 transition-[width,opacity,transform] group-hover/character-name:pointer-events-auto group-hover/character-name:w-5 group-hover/character-name:translate-x-0 group-hover/character-name:opacity-100 group-focus-within/character-name:pointer-events-auto group-focus-within/character-name:w-5 group-focus-within/character-name:translate-x-0 group-focus-within/character-name:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:w-5 [@media(hover:none)]:translate-x-0 [@media(hover:none)]:opacity-100 motion-reduce:transition-none"
                        onClick={(event) => {
                          aliasReturnFocusRef.current =
                            event.detail === 0
                              ? event.currentTarget
                              : document.getElementById(id);
                          setAliasEdit({
                            index,
                            value: selection.displayName,
                            roleKey: credit.roleKey,
                          });
                        }}
                        size="icon"
                        title="编辑详细信息"
                        type="button"
                        variant="ghost"
                      >
                        <Pencil className="size-3" />
                      </Button>
                    ) : null}
                  </span>
                  {missingPortrait ? (
                    <span className="shrink-0 font-normal text-red-700">待选头像</span>
                  ) : null}
                </TokenChip>
              );
            })}
            renderItem={(option) => (
              <>
                {option.kind === "create" ? (
                  <>
                    <span>新增角色“{option.query}”</span>
                    <span className="shrink-0 text-xs text-muted">
                      填写中文名
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex min-w-0 items-center gap-2">
                      <CharacterPortrait
                        className="size-9 rounded-md text-sm"
                        displayName={option.selection.displayName}
                        portrait={option.defaultPortrait}
                        size={36}
                        toneKey={option.selection.characterId}
                      />
                      <span className="truncate">
                        {option.selection.displayName}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {option.meta}
                    </span>
                  </>
                )}
              </>
            )}
          />
        </div>

        <span className="text-xs text-muted">输入后按 Enter 添加</span>
        {recommended.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted">常用角色</span>
            {recommended.map((item) => (
              <Button
                className="min-h-8 rounded-full border-dashed px-2.5 text-xs font-normal text-muted hover:border-primary hover:text-primary"
                disabled={disabled}
                key={item.id}
                onClick={() =>
                  addExisting({
                    kind: "existing",
                    characterId: item.id,
                    originalName: item.originalName,
                    displayName: item.primaryName,
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <CharacterPortrait
                  className="size-6 rounded-sm text-[11px]"
                  displayName={item.primaryName}
                  portrait={item.defaultPortrait}
                  size={24}
                  toneKey={item.id}
                />
                {item.primaryName}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <Dialog.Root
        open={aliasEdit !== null}
        onOpenChange={(nextOpen) => !nextOpen && setAliasEdit(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content
            className="left-1/2 top-1/2 grid w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg p-5"
            id={`${id}-alias-dialog`}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const returnFocus = aliasReturnFocusRef.current?.isConnected
                ? aliasReturnFocusRef.current
                : document.getElementById(id);
              returnFocus?.focus();
            }}
          >
            <Dialog.Title>编辑详细信息</Dialog.Title>
            <Dialog.Description className="sr-only">
              设置角色在本作品中的名称和身份，随作品保存。
            </Dialog.Description>
            <form className="grid gap-4" onSubmit={saveAlias}>
              <div className="grid gap-2">
                <Label
                  className="flex items-baseline gap-2"
                  htmlFor={`${id}-alias-name`}
                >
                  登场名称
                  <span className="text-xs font-normal text-muted">
                    仅用于本作
                  </span>
                </Label>
                <Input
                  disabled={disabled}
                  id={`${id}-alias-name`}
                  onChange={(event) =>
                    setAliasEdit((current) =>
                      current
                        ? { ...current, value: event.target.value }
                        : null,
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.nativeEvent.isComposing || event.keyCode === 229)
                    ) {
                      event.preventDefault();
                    }
                  }}
                  required
                  value={aliasEdit?.value ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-alias-role`}>身份</Label>
                <SelectField
                  disabled={disabled}
                  id={`${id}-alias-role`}
                  onValueChange={(roleKey) => {
                    if (isCharacterRoleKey(roleKey)) {
                      setAliasEdit((current) =>
                        current ? { ...current, roleKey } : null,
                      );
                    }
                  }}
                  options={CHARACTER_ROLE_OPTIONS}
                  required
                  value={aliasEdit?.roleKey ?? "main"}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    取消
                  </Button>
                </Dialog.Close>
                <Button
                  disabled={
                    disabled || !normalizeEntityName(aliasEdit?.value ?? "")
                  }
                  type="submit"
                >
                  保存
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={Boolean(activeCredit)}
        onOpenChange={(nextOpen) => !nextOpen && setPortraitIndex(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content
            className="inset-0 flex h-dvh w-full flex-col overflow-hidden sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(720px,90dvh)] sm:w-[min(64rem,calc(100vw-1rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg"
            id={`${id}-portrait-dialog`}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const returnFocus = portraitReturnFocusRef.current?.isConnected
                ? portraitReturnFocusRef.current
                : document.getElementById(id);
              returnFocus?.focus();
            }}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-3 pt-[max(.75rem,env(safe-area-inset-top))]">
              <div>
                <Dialog.Title>选择本作头像</Dialog.Title>
                <Dialog.Description className="mt-0.5 text-sm text-muted">
                  {activeCredit?.selection.displayName ?? ""}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button
                  aria-label="关闭头像选择"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-4" />
                </Button>
              </Dialog.Close>
            </div>
            {activeCredit ? (
              <PortraitSelectionWorkbench
                credit={activeCredit}
                disabled={disabled}
                files={faceSheetFiles[portraitIndex ?? -1] ?? []}
                key={`${characterSelectionKey(activeCredit.selection)}:${portraitIndex}`}
                onChoose={(blobSha256, row, column) =>
                  updatePortrait(portraitIndex ?? -1, {
                    blobSha256,
                    row,
                    column,
                  })
                }
                onRemoveUpload={(file, sha256) =>
                  removeFaceSheetFile(portraitIndex ?? -1, file, sha256)
                }
                onUpload={
                  onFaceSheetFilesChange
                    ? (files) => addFaceSheetFiles(portraitIndex ?? -1, files)
                    : null
                }
                onUseDefault={() => updatePortrait(portraitIndex ?? -1, null)}
                portraitError={portraitErrors[portraitIndex ?? -1] ?? null}
                suggestion={activeSuggestion}
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {reorder.preview ? (
        <TokenDragPreview element={reorder.preview.element} {...reorder.preview.chip} />
      ) : null}
      <CharacterCreateDialog
        description={
          <>
            未找到“{createQuery}
            ”。若日语名已存在，将关联已有角色；否则随作品创建新角色。中文名作为初始登场名称，之后可单独修改。
          </>
        }
        initialOriginalName={createQuery}
        onCreate={addNewCharacter}
        onOpenChange={setCreateOpen}
        open={createOpen}
        returnFocus={() =>
          createReturnFocusRef.current?.isConnected
            ? createReturnFocusRef.current
            : document.getElementById(id)
        }
        submitLabel="加入本次上传"
        submittingLabel="加入中…"
        title="添加角色名称"
      />
    </>
  );
}

type PortraitGridSheet = {
  id: number;
  blobSha256: string;
  width: number;
  height: number;
  src?: string;
  label: string;
  file?: File;
};

function PortraitSelectionWorkbench({
  credit,
  disabled,
  files,
  onChoose,
  onRemoveUpload,
  onUpload,
  onUseDefault,
  portraitError,
  suggestion,
}: {
  credit: CharacterCreditSelection;
  disabled: boolean;
  files: File[];
  onChoose: (blobSha256: string, row: number, column: number) => void;
  onRemoveUpload: (file: File, sha256: string) => void;
  onUpload: ((files: File[]) => Promise<string[]>) | null;
  onUseDefault: () => void;
  portraitError: string | null;
  suggestion: CharacterSuggestion | null;
}) {
  const previews = useLocalFaceSheets(files);
  const [uploading, setUploading] = useState(false);
  const [locateHash, setLocateHash] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const located = useRef<string | null>(null);
  const sheetsByHash = new Map<string, PortraitGridSheet>();
  for (const preview of previews) {
    sheetsByHash.set(preview.sha256, {
      ...preview,
      id: 0,
      blobSha256: preview.sha256,
      label: preview.file.name,
    });
  }
  for (const sheet of suggestion?.faceSheets ?? []) {
    if (!sheetsByHash.has(sheet.blobSha256)) {
      sheetsByHash.set(sheet.blobSha256, { ...sheet, label: faceSheetName(sheet) });
    }
  }
  const sheets = [...sheetsByHash.values()];
  const effectivePortrait = credit.portrait ?? suggestion?.defaultPortrait ?? null;
  const selectedSheet = effectivePortrait
    ? sheetsByHash.get(effectivePortrait.blobSha256)
    : undefined;
  const portrait = effectivePortrait && selectedSheet
    ? {
        ...effectivePortrait,
        faceSheetId: selectedSheet.id,
        width: selectedSheet.width,
        height: selectedSheet.height,
      }
    : resolvePortrait(credit, suggestion);
  const targetHash = locateHash ?? effectivePortrait?.blobSha256;
  const busy = disabled || uploading;

  useLayoutEffect(() => {
    const container = viewport.current;
    if (!container || !targetHash || located.current === targetHash) return;
    const target = container.querySelector<HTMLElement>(
      `[data-face-sheet="${targetHash}"]`,
    );
    if (!target) return;
    const bounds = container.getBoundingClientRect();
    const itemBounds = target.getBoundingClientRect();
    if (itemBounds.top < bounds.top)
      container.scrollTop += itemBounds.top - bounds.top;
    else if (itemBounds.bottom > bounds.bottom) {
      container.scrollTop += Math.min(
        itemBounds.top - bounds.top,
        itemBounds.bottom - bounds.bottom,
      );
    }
    located.current = targetHash;
  });

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] sm:grid-rows-1">
      <section
        aria-label="角色脸图"
        className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] border-b border-border sm:border-b-0 sm:border-r"
      >
        <header className="flex min-h-[65px] flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div>
            <strong className="text-sm">角色脸图</strong>
            <span className="ml-2 text-xs tabular-nums text-muted">{sheets.length} 张</span>
          </div>
          {onUpload ? (
            <Label
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "cursor-pointer",
                busy && "pointer-events-none opacity-50",
              )}
            >
              {uploading ? "正在读取…" : "添加脸图"}
              <input
                accept="image/png"
                className="sr-only"
                disabled={busy}
                multiple
                type="file"
                onChange={(event) => {
                  const nextFiles = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  if (!nextFiles.length) return;
                  setUploading(true);
                  void onUpload(nextFiles)
                    .then((hashes) => {
                      if (hashes[0]) {
                        located.current = null;
                        setLocateHash(hashes[0]);
                      }
                    })
                    .finally(() => setUploading(false));
                }}
              />
            </Label>
          ) : null}
          {portraitError ? (
            <p role="alert" className="w-full text-xs font-semibold text-red-700">
              {portraitError}
            </p>
          ) : null}
        </header>
        <div ref={viewport} className="min-h-0 overflow-auto p-3 [overflow-anchor:none]">
          <FaceSheetGrid
            sheets={sheets}
            highlightedBlob={effectivePortrait?.blobSha256}
            disabled={busy}
            onSelectCell={(sheet, row, column) => {
              setLocateHash(null);
              onChoose(sheet.blobSha256, row, column);
            }}
            cellState={(sheet, row, column) => {
              const selected =
                effectivePortrait?.blobSha256 === sheet.blobSha256 &&
                effectivePortrait.row === row &&
                effectivePortrait.column === column;
              return { selected, highlighted: selected };
            }}
            renderFooter={(sheet) => (
              <div className="mt-1 flex min-h-6 items-center gap-1">
                <span
                  className="min-w-0 flex-1 truncate text-xs text-muted"
                  title={sheet.label}
                >
                  {sheet.label}
                </span>
                {sheet.file && onUpload ? (
                  <Button
                    aria-label={`移除 ${sheet.label}`}
                    className="size-6 min-h-0 shrink-0 p-0"
                    disabled={busy}
                    size="icon"
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setLocateHash(null);
                      if (sheet.file) onRemoveUpload(sheet.file, sheet.blobSha256);
                    }}
                  >
                    <X className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            )}
          />
          {files.length > previews.length ? (
            <p role="status" className="text-sm text-muted">正在读取脸图…</p>
          ) : null}
          {!sheets.length && !files.length ? (
            <EmptyState title={onUpload ? "暂无脸图，可添加脸图素材表" : "暂无可用脸图"} variant="plain" />
          ) : null}
        </div>
      </section>
      <section
        aria-label="本作头像预览"
        className="flex min-w-0 items-center gap-3 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:flex-col sm:justify-center sm:gap-4 sm:p-4"
      >
        <CharacterPortrait
          className="size-24 shrink-0 rounded-md"
          displayName={credit.selection.displayName}
          portrait={portrait}
          previewSrc={selectedSheet?.src}
          size={96}
          toneKey={
            credit.selection.kind === "existing"
              ? credit.selection.characterId
              : credit.selection.originalName
          }
        />
        <div className="grid min-w-0 gap-2 sm:justify-items-center sm:text-center" aria-live="polite">
          <strong className="text-sm">
            {credit.portrait
              ? "本作头像"
              : suggestion?.defaultPortrait
                ? "角色默认头像"
                : "未选择头像"}
          </strong>
          {effectivePortrait ? (
            <p className="m-0 text-xs text-muted">
              第 {effectivePortrait.row + 1} 行，第 {effectivePortrait.column + 1} 列
            </p>
          ) : null}
          {selectedSheet ? (
            <p className="m-0 max-w-full truncate text-xs text-muted" title={selectedSheet.label}>
              {selectedSheet.label}
            </p>
          ) : null}
          <Button
            disabled={busy || !suggestion?.defaultPortrait}
            onClick={() => {
              located.current = null;
              setLocateHash(null);
              onUseDefault();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            沿用角色默认头像
          </Button>
        </div>
      </section>
    </div>
  );
}

function faceSheetName(sheet: CharacterFaceSheet): string {
  return sheet.sourcePageTitle || sheet.sourceSectionTitle || `素材表 #${sheet.id}`;
}

function resolvePortrait(
  credit: CharacterCreditSelection,
  suggestion: CharacterSuggestion | null,
): CharacterPortraitValue | null {
  if (!credit.portrait) return suggestion?.defaultPortrait ?? null;
  const sheet = suggestion?.faceSheets.find(
    (item) => item.blobSha256 === credit.portrait?.blobSha256,
  );
  return sheet
    ? {
        faceSheetId: sheet.id,
        blobSha256: sheet.blobSha256,
        width: sheet.width,
        height: sheet.height,
        row: credit.portrait.row,
        column: credit.portrait.column,
      }
    : null;
}

function hasPortrait(
  credit: CharacterCreditSelection,
  suggestion: CharacterSuggestion | null,
): boolean {
  return Boolean(credit.portrait || suggestion?.defaultPortrait);
}

function portraitStatus(
  credit: CharacterCreditSelection,
  suggestion: CharacterSuggestion | null,
  files: File[],
): string {
  const localIndex = credit.portrait
    ? credit.faceSheetBlobSha256s.indexOf(credit.portrait.blobSha256)
    : -1;
  const localFile = localIndex >= 0 ? (files[localIndex] ?? null) : null;
  if (localFile && credit.portrait) {
    return `新上传：${localFile.name} · 第 ${credit.portrait.row + 1} 行，第 ${credit.portrait.column + 1} 列`;
  }
  if (credit.portrait)
    return `本作指定：第 ${credit.portrait.row + 1} 行，第 ${credit.portrait.column + 1} 列`;
  if (suggestion?.defaultPortrait) return "沿用角色默认头像";
  if (files.length) return `已添加 ${files.length} 张素材表，尚未选择头像`;
  return "尚未选择头像";
}

function optionForSuggestion(
  suggestion: CharacterSuggestion,
  queryKey: string,
): ExistingOption | null {
  const match = characterNames(suggestion)
    .map((name) => ({
      ...name,
      rank: matchRank(characterNameKey(name.name), queryKey),
    }))
    .filter((name) => name.rank < 3)
    .sort(
      (left, right) => left.rank - right.rank || left.order - right.order,
    )[0];
  if (!match) return null;
  const displayName =
    match.language === "zh" ? match.name : suggestion.primaryName;
  return {
    kind: "existing",
    selection: {
      kind: "existing",
      characterId: suggestion.id,
      originalName: suggestion.originalName,
      displayName,
    },
    defaultPortrait: suggestion.defaultPortrait,
    meta: `${suggestion.workCount} 部作品`,
    rank: match.rank,
    workCount: suggestion.workCount,
  };
}

function characterNames(suggestion: CharacterSuggestion): Array<{
  name: string;
  language: CharacterNameLanguage;
  order: number;
}> {
  return [
    { name: suggestion.originalName, language: "ja", order: 0 },
    { name: suggestion.primaryName, language: "zh", order: 1 },
    ...suggestion.aliases.map((alias, index) => ({
      ...alias,
      order: index + 2,
    })),
  ];
}

function matchRank(value: string, query: string): number {
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  return value.includes(query) ? 2 : 3;
}

function LocalPortraitPreview({
  credit,
  files,
  portrait,
}: {
  credit: CharacterCreditSelection;
  files: File[];
  portrait: CharacterPortraitValue | null;
}) {
  const previews = useLocalFaceSheets(files);
  const preview =
    previews.find((item) => item.sha256 === credit.portrait?.blobSha256) ??
    null;
  const localPortrait =
    preview && credit.portrait?.blobSha256 === preview.sha256
      ? {
          faceSheetId: 0,
          blobSha256: preview.sha256,
          width: preview.width,
          height: preview.height,
          row: credit.portrait.row,
          column: credit.portrait.column,
        }
      : portrait;
  const selection = credit.selection;
  return (
    <CharacterPortrait
      className="size-6 shrink-0 rounded-sm text-[11px]"
      displayName={selection.displayName}
      portrait={localPortrait}
      previewSrc={preview?.src ?? null}
      size={24}
      toneKey={
        selection.kind === "existing"
          ? selection.characterId
          : selection.originalName
      }
    />
  );
}

function useLocalFaceSheets(
  files: File[],
): Array<ReturnType<typeof localFaceSheetPreview>> {
  const [previews, setPreviews] = useState<
    Array<ReturnType<typeof localFaceSheetPreview>>
  >([]);
  useEffect(() => {
    let active = true;
    const pending = files.map((file) => ({
      file,
      src: URL.createObjectURL(file),
    }));
    void Promise.all(
      pending.map(async ({ file, src }) =>
        localFaceSheetPreview(
          file,
          src,
          await inspectCharacterFaceSheetFile(file),
        ),
      ),
    )
      .then((nextPreviews) => {
        if (active) setPreviews(nextPreviews);
      })
      .catch(() => {
        if (active) setPreviews([]);
      });
    return () => {
      active = false;
      pending.forEach(({ src }) => URL.revokeObjectURL(src));
    };
  }, [files]);
  return previews.filter((preview) => files.includes(preview.file));
}

function localFaceSheetPreview(
  file: File,
  src: string,
  sheet: Awaited<ReturnType<typeof inspectCharacterFaceSheetFile>>,
) {
  return { file, src, ...sheet };
}

async function inspectNamedFaceSheet(file: File) {
  try {
    return await inspectCharacterFaceSheetFile(file);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "无法读取脸图素材表。";
    throw new Error(`无法添加“${file.name}”：${detail}`);
  }
}

function omitKey<T>(value: Record<number, T>, key: number): Record<number, T> {
  if (!(key in value)) return value;
  const next = { ...value };
  delete next[key];
  return next;
}

function removeIndexedValue<T>(
  value: Record<number, T>,
  removedIndex: number,
): Record<number, T> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([rawIndex, item]) => {
      const index = Number(rawIndex);
      if (index === removedIndex) return [];
      return [[index > removedIndex ? index - 1 : index, item]];
    }),
  );
}
