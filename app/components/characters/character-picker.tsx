import { SearchComboBox } from "@/app/components/ui/search-combobox";
import type { CharacterNameInput } from "@/app/components/characters/character-create-dialog";
import { CharacterCreateDialog } from "@/app/components/characters/character-create-dialog";
import { badgeVariants } from "@/app/components/ui/badge";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import * as Dialog from "@/app/components/ui/dialog";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FaceSheetCanvas } from "@/app/components/ui/face-sheet-canvas";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { TokenChip } from "@/app/components/ui/token-input";
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
import { useEffect, useMemo, useRef, useState } from "react";

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
  onChange: (values: CharacterCreditSelection[]) => void;
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
        <div className="relative">
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
            tokens={values.map((credit, index) => {
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
                  className={
                    missingPortrait ? "bg-red-700/10 text-red-700" : undefined
                  }
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
                    <span className="truncate">{label}</span>
                    <span
                      className={cn(
                        badgeVariants({ variant: "secondary" }),
                        "ml-1.5 min-h-5 shrink-0 px-1.5 py-0 text-[10px] font-normal",
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
                    <span className="shrink-0 font-normal">待选头像</span>
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
              设置角色在本作品中的别名和身份，随作品保存。
            </Dialog.Description>
            <form className="grid gap-4" onSubmit={saveAlias}>
              <div className="grid gap-2">
                <Label
                  className="flex items-baseline gap-2"
                  htmlFor={`${id}-alias-name`}
                >
                  别名
                  <span className="text-xs font-normal text-muted">
                    在本作中的名称
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
            className="left-1/2 top-1/2 grid h-[min(720px,calc(100vh-2rem))] w-[min(96vw,72rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg"
            id={`${id}-portrait-dialog`}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const returnFocus = portraitReturnFocusRef.current?.isConnected
                ? portraitReturnFocusRef.current
                : document.getElementById(id);
              returnFocus?.focus();
            }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
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
                onChooseExisting={(sheet, row, column) =>
                  updatePortrait(portraitIndex ?? -1, {
                    blobSha256: sheet.blobSha256,
                    row,
                    column,
                  })
                }
                onChooseUploaded={(row, column, blobSha256) =>
                  onChange(
                    values.map((item, itemIndex) =>
                      itemIndex === portraitIndex
                        ? { ...item, portrait: { blobSha256, row, column } }
                        : item,
                    ),
                  )
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

      <CharacterCreateDialog
        description={
          <>
            未找到“{createQuery}
            ”。若日语名已存在，中文名会成为该角色的别名；否则随作品创建新角色。
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

function PortraitSelectionWorkbench({
  credit,
  disabled,
  files,
  onChooseExisting,
  onChooseUploaded,
  onRemoveUpload,
  onUpload,
  onUseDefault,
  portraitError,
  suggestion,
}: {
  credit: CharacterCreditSelection;
  disabled: boolean;
  files: File[];
  onChooseExisting: (
    sheet: CharacterFaceSheet,
    row: number,
    column: number,
  ) => void;
  onChooseUploaded: (row: number, column: number, blobSha256: string) => void;
  onRemoveUpload: (file: File, sha256: string) => void;
  onUpload: ((files: File[]) => Promise<string[]>) | null;
  onUseDefault: () => void;
  portraitError: string | null;
  suggestion: CharacterSuggestion | null;
}) {
  const previews = useLocalFaceSheets(files);
  const faceSheets = suggestion?.faceSheets ?? [];
  const [activeSheetKey, setActiveSheetKey] = useState(() =>
    initialFaceSheetKey(credit, suggestion),
  );
  const selectedUpload = previews.find(
    (preview) => preview.sha256 === credit.portrait?.blobSha256,
  );
  const effectiveActiveSheetKey =
    activeSheetKey ??
    (selectedUpload ? localFaceSheetKey(selectedUpload.sha256) : null) ??
    (previews[0] ? localFaceSheetKey(previews[0].sha256) : null);

  const activeLibrarySheet =
    faceSheets.find(
      (sheet) => faceSheetKey(sheet) === effectiveActiveSheetKey,
    ) ?? null;
  const activeUpload =
    previews.find(
      (preview) =>
        localFaceSheetKey(preview.sha256) === effectiveActiveSheetKey,
    ) ?? null;
  const activeSha256 =
    activeUpload?.sha256 ?? activeLibrarySheet?.blobSha256 ?? null;
  const effectivePortrait =
    credit.portrait ?? suggestion?.defaultPortrait ?? null;
  const selectedCell =
    activeSha256 && effectivePortrait?.blobSha256 === activeSha256
      ? { row: effectivePortrait.row, column: effectivePortrait.column }
      : null;
  const activeName = activeUpload
    ? activeUpload.file.name
    : activeLibrarySheet
      ? faceSheetName(activeLibrarySheet)
      : "尚未选择素材表";
  const activeDimensions = activeUpload
    ? faceSheetDimensions(activeUpload.width, activeUpload.height)
    : activeLibrarySheet
      ? faceSheetDimensions(activeLibrarySheet.width, activeLibrarySheet.height)
      : null;
  const defaultSheet = suggestion?.defaultPortrait
    ? (faceSheets.find(
        (sheet) => sheet.id === suggestion.defaultPortrait?.faceSheetId,
      ) ??
      faceSheets.find(
        (sheet) => sheet.blobSha256 === suggestion.defaultPortrait?.blobSha256,
      ) ??
      null)
    : null;

  function useDefaultPortrait() {
    if (defaultSheet) setActiveSheetKey(faceSheetKey(defaultSheet));
    onUseDefault();
  }

  return (
    <div className="grid min-h-0 grid-cols-[18rem_minmax(0,1fr)]">
      <aside
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-r border-border"
        aria-label="选择脸图素材表"
      >
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <strong className="text-sm">素材表</strong>
          <span className="text-xs text-muted">
            {faceSheets.length + files.length} 张
          </span>
        </header>

        <div className="min-h-0 overflow-y-auto p-2">
          {files.map((file, index) => {
            const preview = previews.find((item) => item.file === file) ?? null;
            return (
              <FaceSheetChoice
                active={Boolean(
                  preview &&
                    effectiveActiveSheetKey ===
                      localFaceSheetKey(preview.sha256),
                )}
                currentLabel={portraitSourceLabel(
                  preview?.sha256 ?? null,
                  credit,
                  suggestion,
                )}
                height={preview?.height ?? 48}
                key={
                  preview?.sha256 ??
                  `${file.name}:${file.size}:${file.lastModified}:${index}`
                }
                label={file.name}
                meta={
                  preview
                    ? `${faceSheetDimensions(preview.width, preview.height)} · 新上传`
                    : "正在读取…"
                }
                onClick={() => {
                  if (preview)
                    setActiveSheetKey(localFaceSheetKey(preview.sha256));
                }}
                src={preview?.src ?? null}
                width={preview?.width ?? 48}
              />
            );
          })}
          {faceSheets.map((sheet) => (
            <FaceSheetChoice
              active={effectiveActiveSheetKey === faceSheetKey(sheet)}
              currentLabel={portraitSourceLabel(
                sheet.blobSha256,
                credit,
                suggestion,
              )}
              height={sheet.height}
              key={sheet.id}
              label={faceSheetName(sheet)}
              meta={faceSheetMeta(sheet)}
              onClick={() => setActiveSheetKey(faceSheetKey(sheet))}
              src={`/api/media/blobs/${sheet.blobSha256}`}
              width={sheet.width}
            />
          ))}
          {!files.length && !faceSheets.length ? (
            <EmptyState
              title="这个角色还没有脸图素材表"
              variant="plain"
              className="h-full min-h-28 place-items-center px-3 text-center"
            />
          ) : null}
        </div>

        {onUpload || portraitError ? (
          <footer className="grid gap-2 border-t border-border p-2">
            {onUpload ? (
              <Label
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "w-full cursor-pointer",
                  disabled && "pointer-events-none opacity-50",
                )}
              >
                添加脸图素材表
                <input
                  accept="image/png"
                  className="sr-only"
                  disabled={disabled}
                  onChange={(event) => {
                    const nextFiles = Array.from(
                      event.currentTarget.files ?? [],
                    );
                    event.currentTarget.value = "";
                    if (nextFiles.length) {
                      void onUpload(nextFiles).then((hashes) => {
                        if (hashes[0])
                          setActiveSheetKey(localFaceSheetKey(hashes[0]));
                      });
                    }
                  }}
                  multiple
                  type="file"
                />
              </Label>
            ) : null}
            {activeUpload ? (
              <Button
                disabled={disabled}
                onClick={() => {
                  const next = previews.find(
                    (preview) => preview.file !== activeUpload.file,
                  );
                  setActiveSheetKey(
                    next
                      ? localFaceSheetKey(next.sha256)
                      : faceSheets[0]
                        ? faceSheetKey(faceSheets[0])
                        : null,
                  );
                  onRemoveUpload(activeUpload.file, activeUpload.sha256);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                移除当前上传素材表
              </Button>
            ) : null}
            {portraitError ? (
              <span className="text-xs font-semibold text-red-700" role="alert">
                {portraitError}
              </span>
            ) : null}
          </footer>
        ) : null}
      </aside>

      <section
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
        aria-label="选择头像坐标"
      >
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <strong className="block truncate text-sm" title={activeName}>
              {activeName}
            </strong>
            {activeDimensions ? (
              <span className="block text-xs text-muted">
                {activeDimensions}
              </span>
            ) : null}
          </div>
          <Button
            disabled={disabled || !suggestion?.defaultPortrait}
            onClick={useDefaultPortrait}
            size="sm"
            type="button"
            variant="outline"
          >
            沿用角色默认头像
          </Button>
        </header>

        <div className="grid min-h-0 place-items-center overflow-auto bg-muted/5 p-4">
          {activeUpload ? (
            <FaceSheetCanvas
              height={activeUpload.height}
              label={`在 ${activeUpload.file.name} 中选择本作头像`}
              onSelectCell={(row, column) =>
                onChooseUploaded(row, column, activeUpload.sha256)
              }
              scale={Math.min(
                2.5,
                480 / Math.max(activeUpload.width, activeUpload.height),
              )}
              selectedCell={selectedCell}
              src={activeUpload.src}
              width={activeUpload.width}
            />
          ) : activeLibrarySheet ? (
            <FaceSheetCanvas
              blobSha256={activeLibrarySheet.blobSha256}
              height={activeLibrarySheet.height}
              label={`在 ${faceSheetName(activeLibrarySheet)} 中选择本作头像`}
              onSelectCell={(row, column) =>
                onChooseExisting(activeLibrarySheet, row, column)
              }
              scale={Math.min(
                2.5,
                480 /
                  Math.max(activeLibrarySheet.width, activeLibrarySheet.height),
              )}
              selectedCell={selectedCell}
              width={activeLibrarySheet.width}
            />
          ) : (
            <EmptyState
              title={onUpload ? "请先上传脸图素材表" : "没有可选的脸图素材表"}
              variant="plain"
            />
          )}
        </div>

        <footer className="flex min-h-12 items-center border-t border-border px-3 py-2">
          <strong className="text-sm">
            {selectedCell
              ? `${credit.portrait ? "本作已选" : "角色默认"}：第 ${selectedCell.row + 1} 行，第 ${selectedCell.column + 1} 列`
              : "未选择头像"}
          </strong>
        </footer>
      </section>
    </div>
  );
}

function FaceSheetChoice({
  active,
  currentLabel,
  height,
  label,
  meta,
  onClick,
  src,
  width,
}: {
  active: boolean;
  currentLabel: string | null;
  height: number;
  label: string;
  meta: string;
  onClick: () => void;
  src: string | null;
  width: number;
}) {
  return (
    <Button
      aria-pressed={active}
      className={cn(
        "mb-2 grid h-auto w-full grid-cols-[88px_minmax(0,1fr)] items-center justify-stretch gap-2 rounded-sm border p-1.5 text-left font-normal last:mb-0",
        active
          ? "border-primary bg-primary/10 ring-1 ring-primary"
          : "border-border bg-card",
      )}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <span className="grid size-[88px] place-items-center overflow-hidden border border-foreground/10 bg-muted/10">
        {src ? (
          <img
            alt=""
            className="size-[88px] object-contain [image-rendering:pixelated]"
            height={height}
            src={src}
            width={width}
            loading="lazy"
          />
        ) : (
          <span className="text-xs text-muted">读取中</span>
        )}
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-sm" title={label}>
          {label}
        </strong>
        <span className="block truncate text-xs text-muted">{meta}</span>
        {currentLabel ? (
          <span className="block text-xs font-semibold text-primary">
            {currentLabel}
          </span>
        ) : null}
      </span>
    </Button>
  );
}

function initialFaceSheetKey(
  credit: CharacterCreditSelection,
  suggestion: CharacterSuggestion | null,
): string | null {
  const effectivePortrait =
    credit.portrait ?? suggestion?.defaultPortrait ?? null;
  const selectedSheet = effectivePortrait
    ? suggestion?.faceSheets.find(
        (sheet) => sheet.blobSha256 === effectivePortrait.blobSha256,
      )
    : null;
  return selectedSheet
    ? faceSheetKey(selectedSheet)
    : suggestion?.faceSheets[0]
      ? faceSheetKey(suggestion.faceSheets[0])
      : null;
}

function faceSheetKey(sheet: CharacterFaceSheet): string {
  return `sheet:${sheet.id}`;
}

function localFaceSheetKey(sha256: string): string {
  return `upload:${sha256}`;
}

function faceSheetName(sheet: CharacterFaceSheet): string {
  return (
    sheet.sourcePageTitle || sheet.sourceSectionTitle || `素材表 #${sheet.id}`
  );
}

function faceSheetDimensions(width: number, height: number): string {
  return `${width / 48} 列 × ${height / 48} 行`;
}

function faceSheetMeta(sheet: CharacterFaceSheet): string {
  const section =
    sheet.sourceSectionTitle &&
    sheet.sourceSectionTitle !== sheet.sourcePageTitle
      ? `${sheet.sourceSectionTitle} · `
      : "";
  return `${section}#${sheet.id} · ${faceSheetDimensions(sheet.width, sheet.height)}`;
}

function portraitSourceLabel(
  sha256: string | null,
  credit: CharacterCreditSelection,
  suggestion: CharacterSuggestion | null,
): string | null {
  if (!sha256) return null;
  if (credit.portrait?.blobSha256 === sha256) return "本作使用";
  if (!credit.portrait && suggestion?.defaultPortrait?.blobSha256 === sha256) {
    return "角色默认";
  }
  return null;
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
