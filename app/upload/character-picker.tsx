"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import {
  CharacterCreateDialog,
  type CharacterNameInput,
} from "@/app/components/characters/character-create-dialog";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { FaceSheetCanvas } from "@/app/components/ui/face-sheet-canvas";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import type {
  CharacterCreditSelection,
  CharacterFaceSheet,
  CharacterNameLanguage,
  CharacterPortrait as CharacterPortraitValue,
  CharacterSelection,
  CharacterSuggestion,
} from "@/lib/character-names";
import {
  characterNameKey,
  characterSelectionKey,
  characterSelectionLabel,
} from "@/lib/character-names";
import { normalizeEntityName } from "@/lib/entity-name";
import { inspectCharacterFaceSheetFile } from "@/lib/ui/character-face-sheet";
import { cn } from "@/lib/ui/cn";

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
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createQuery, setCreateQuery] = useState("");
  const [portraitIndex, setPortraitIndex] = useState<number | null>(null);
  const createReturnFocusRef = useRef<HTMLElement | null>(null);
  const portraitReturnFocusRef = useRef<HTMLElement | null>(null);
  const [portraitErrors, setPortraitErrors] = useState<Record<number, string>>({});
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
      : [...matches, { kind: "create" as const, query: normalizeEntityName(query) }];
  }, [query, suggestions]);
  const selectedCharacterIds = new Set(
    values.flatMap((credit) => credit.selection.kind === "existing"
      ? [credit.selection.characterId]
      : []),
  );
  const recommended = suggestions
    .filter((item) => !selectedCharacterIds.has(item.id))
    .slice(0, 6);
  const activeCredit = portraitIndex === null ? null : values[portraitIndex] ?? null;
  const activeSuggestion = activeCredit?.selection.kind === "existing"
    ? suggestionsById.get(activeCredit.selection.characterId) ?? null
    : null;
  const menuId = `${id}-options`;

  function addExisting(selection: Extract<CharacterSelection, { kind: "existing" }>) {
    onChange([...values, { selection, portrait: null, faceSheetBlobSha256s: [] }]);
    setQuery("");
    setActiveIndex(0);
    setOpen(false);
  }

  function remove(index: number) {
    onFaceSheetFilesRemove?.(index);
    setPortraitErrors((current) => removeIndexedValue(current, index));
    setPortraitIndex((current) => {
      if (current === null || current < index) return current;
      return current === index ? null : current - 1;
    });
    onChange(values.filter((_, itemIndex) => itemIndex !== index));
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
    createReturnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    const originalName = normalizeEntityName(rawQuery);
    setCreateQuery(originalName);
    setOpen(false);
    setCreateOpen(true);
  }

  function addNewCharacter({ originalName, displayName }: CharacterNameInput) {
    const selection: CharacterSelection = { kind: "new", originalName, displayName };
    onChange([...values, { selection, portrait: null, faceSheetBlobSha256s: [] }]);
    setQuery("");
    setActiveIndex(0);
    portraitReturnFocusRef.current = document.getElementById(id);
    setPortraitIndex(values.length);
  }

  async function addFaceSheetFiles(index: number, files: File[]): Promise<string[]> {
    if (!onFaceSheetFilesChange || !files.length) return [];
    try {
      const existing = await Promise.all(
        (faceSheetFiles[index] ?? []).map(async (file) => ({
          file,
          ...await inspectNamedFaceSheet(file),
        })),
      );
      const added = await Promise.all(
        files.map(async (file) => ({
          file,
          ...await inspectNamedFaceSheet(file),
        })),
      );
      const uniqueSheets = [...new Map(
        [...existing, ...added].map((sheet) => [sheet.sha256, sheet]),
      ).values()];
      const hashes = uniqueSheets.map((sheet) => sheet.sha256);
      onFaceSheetFilesChange(index, uniqueSheets.map((sheet) => sheet.file));
      onChange(
        values.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                faceSheetBlobSha256s: hashes,
                portrait: item.portrait ?? (
                  item.selection.kind === "existing" &&
                  suggestionsById.get(item.selection.characterId)?.defaultPortrait
                    ? null
                    : { blobSha256: added[0].sha256, row: 0, column: 0 }
                ),
              }
            : item,
        ),
      );
      setPortraitErrors((current) => omitKey(current, index));
      return added.map((sheet) => sheet.sha256);
    } catch (error) {
      setPortraitErrors((current) => ({
        ...current,
        [index]: error instanceof Error ? error.message : "无法读取脸图素材表。",
      }));
      return [];
    }
  }

  function removeFaceSheetFile(index: number, file: File, sha256: string) {
    const nextFiles = (faceSheetFiles[index] ?? []).filter((item) => item !== file);
    onFaceSheetFilesChange?.(index, nextFiles);
    onChange(values.map((item, itemIndex) => itemIndex === index
      ? {
          ...item,
          faceSheetBlobSha256s: item.faceSheetBlobSha256s.filter((hash) => hash !== sha256),
          portrait: item.portrait?.blobSha256 === sha256 ? null : item.portrait,
        }
      : item));
    setPortraitErrors((current) => omitKey(current, index));
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
      if (!active) return;
      if (active.kind === "create") startCreate(active.query);
      else addExisting(active.selection);
      return;
    }
    if (event.key === "Escape") setOpen(false);
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  return (
    <>
      <div className={cn("grid gap-3", disabled && "opacity-60")} onBlur={onBlur}>
        {name ? <input name={name} readOnly type="hidden" value={JSON.stringify(values)} /> : null}
        <div className="relative">
          <Input
            aria-activedescendant={open && options[activeIndex] ? `${menuId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            aria-controls={menuId}
            aria-expanded={open}
            disabled={disabled}
            id={id}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="输入角色日语原名"
            role="combobox"
            type="text"
            value={query}
          />
          {open && !disabled && options.length ? (
            <div
              className="absolute inset-x-0 top-[calc(100%+0.25rem)] z-30 max-h-72 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-surface"
              id={menuId}
              role="listbox"
            >
              {options.map((option, index) => (
                <Button
                  aria-controls={option.kind === "create" ? `${id}-create-dialog` : undefined}
                  aria-haspopup={option.kind === "create" ? "dialog" : undefined}
                  aria-selected={index === activeIndex}
                  className={cn(
                    "flex min-h-12 w-full items-center justify-between gap-3 rounded-sm px-2.5 py-1.5 text-left text-sm font-normal",
                    index === activeIndex && "bg-primary/10 text-primary",
                  )}
                  id={`${menuId}-${index}`}
                  key={option.kind === "create" ? `create:${option.query}` : option.selection.characterId}
                  onClick={() => option.kind === "create" ? startCreate(option.query) : addExisting(option.selection)}
                  onMouseDown={(event) => event.preventDefault()}
                  role="option"
                  type="button"
                  variant="ghost"
                >
                  {option.kind === "create" ? (
                    <>
                      <span>新增角色“{option.query}”</span>
                      <span className="shrink-0 text-xs text-muted">填写中文名</span>
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
                        <span className="truncate">{characterSelectionLabel(option.selection)}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{option.meta}</span>
                    </>
                  )}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        {values.length ? (
          <div className="grid gap-2">
            {values.map((credit, index) => {
              const selection = credit.selection;
              const key = characterSelectionKey(selection);
              const suggestion = selection.kind === "existing"
                ? suggestionsById.get(selection.characterId) ?? null
                : null;
              const files = faceSheetFiles[index] ?? [];
              const portrait = resolvePortrait(credit, suggestion);
              return (
                <div
                  className="grid grid-cols-[48px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-border bg-card p-2.5"
                  key={`${key}:${index}`}
                >
                  <LocalPortraitPreview credit={credit} files={files} portrait={portrait} />
                  <div className="min-w-0">
                    <strong className="block truncate text-sm">{characterSelectionLabel(selection)}</strong>
                    <span className={cn("block truncate text-xs", hasPortrait(credit, suggestion) ? "text-muted" : "text-red-700")}>
                      {portraitStatus(credit, suggestion, files)}
                    </span>
                  </div>
                  <Button
                    aria-controls={`${id}-portrait-dialog`}
                    aria-expanded={portraitIndex === index}
                    aria-haspopup="dialog"
                    disabled={disabled}
                    onClick={(event) => {
                      portraitReturnFocusRef.current = event.currentTarget;
                      setPortraitIndex(index);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    选择头像
                  </Button>
                  <Button
                    aria-label={`移除 ${characterSelectionLabel(selection)}`}
                    disabled={disabled}
                    onClick={() => remove(index)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>已选 {values.length} 项登场</span>
          <span>先选角色，再确定本作使用的脸图</span>
        </div>
        {recommended.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted">常用角色</span>
            {recommended.map((item) => (
              <Button
                className="min-h-8 rounded-full border-dashed px-2.5 text-xs font-normal text-muted hover:border-primary hover:text-primary"
                disabled={disabled}
                key={item.id}
                onClick={() => addExisting({
                  kind: "existing",
                  characterId: item.id,
                  originalName: item.originalName,
                  displayName: item.primaryName,
                })}
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
                {item.originalName} · {item.primaryName}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <Dialog.Root open={Boolean(activeCredit)} onOpenChange={(nextOpen) => !nextOpen && setPortraitIndex(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 grid h-[min(720px,calc(100vh-2rem))] w-[min(96vw,72rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-surface"
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
                <Dialog.Title className="m-0 text-lg font-bold">选择本作头像</Dialog.Title>
                <Dialog.Description className="mt-0.5 text-sm text-muted">
                  {activeCredit ? characterSelectionLabel(activeCredit.selection) : ""} · 左侧选素材表，右侧选格子
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button aria-label="关闭头像选择" size="icon" type="button" variant="ghost"><X className="size-4" /></Button>
              </Dialog.Close>
            </div>
            {activeCredit ? (
              <PortraitSelectionWorkbench
                credit={activeCredit}
                disabled={disabled}
                files={faceSheetFiles[portraitIndex ?? -1] ?? []}
                key={`${characterSelectionKey(activeCredit.selection)}:${portraitIndex}`}
                onChooseExisting={(sheet, row, column) => updatePortrait(portraitIndex ?? -1, {
                  blobSha256: sheet.blobSha256,
                  row,
                  column,
                })}
                onChooseUploaded={(row, column, blobSha256) => onChange(
                  values.map((item, itemIndex) =>
                    itemIndex === portraitIndex
                      ? { ...item, portrait: { blobSha256, row, column } }
                      : item,
                  ),
                )}
                onRemoveUpload={(file, sha256) =>
                  removeFaceSheetFile(portraitIndex ?? -1, file, sha256)}
                onUpload={onFaceSheetFilesChange
                  ? (files) => addFaceSheetFiles(portraitIndex ?? -1, files)
                  : null}
                onUseDefault={() => updatePortrait(portraitIndex ?? -1, null)}
                portraitError={portraitErrors[portraitIndex ?? -1] ?? null}
                suggestion={activeSuggestion}
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <CharacterCreateDialog
        description={<>未找到“{createQuery}”。若日语名已存在，中文名会成为该角色的别名；否则随作品创建新角色。</>}
        initialOriginalName={createQuery}
        onCreate={addNewCharacter}
        onOpenChange={setCreateOpen}
        open={createOpen}
        returnFocus={() => createReturnFocusRef.current?.isConnected
          ? createReturnFocusRef.current
          : document.getElementById(id)}
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
  onChooseExisting: (sheet: CharacterFaceSheet, row: number, column: number) => void;
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
  const effectiveActiveSheetKey = activeSheetKey
    ?? (selectedUpload ? localFaceSheetKey(selectedUpload.sha256) : null)
    ?? (previews[0] ? localFaceSheetKey(previews[0].sha256) : null);

  const activeLibrarySheet = faceSheets.find(
    (sheet) => faceSheetKey(sheet) === effectiveActiveSheetKey,
  ) ?? null;
  const activeUpload = previews.find(
    (preview) => localFaceSheetKey(preview.sha256) === effectiveActiveSheetKey,
  ) ?? null;
  const activeSha256 = activeUpload?.sha256 ?? activeLibrarySheet?.blobSha256 ?? null;
  const effectivePortrait = credit.portrait ?? suggestion?.defaultPortrait ?? null;
  const selectedCell = activeSha256 && effectivePortrait?.blobSha256 === activeSha256
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
    ? faceSheets.find((sheet) => sheet.id === suggestion.defaultPortrait?.faceSheetId)
      ?? faceSheets.find((sheet) => sheet.blobSha256 === suggestion.defaultPortrait?.blobSha256)
      ?? null
    : null;

  function useDefaultPortrait() {
    if (defaultSheet) setActiveSheetKey(faceSheetKey(defaultSheet));
    onUseDefault();
  }

  return (
    <div className="grid min-h-0 grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-r border-border" aria-label="选择脸图素材表">
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <strong className="text-sm">素材表</strong>
          <span className="text-xs text-muted">{faceSheets.length + files.length} 张</span>
        </header>

        <div className="min-h-0 overflow-y-auto p-2">
          {files.map((file, index) => {
            const preview = previews.find((item) => item.file === file) ?? null;
            return (
              <FaceSheetChoice
                active={Boolean(preview && effectiveActiveSheetKey === localFaceSheetKey(preview.sha256))}
                currentLabel={portraitSourceLabel(preview?.sha256 ?? null, credit, suggestion)}
                height={preview?.height ?? 48}
                key={preview?.sha256 ?? `${file.name}:${file.size}:${file.lastModified}:${index}`}
                label={file.name}
                meta={preview ? `${faceSheetDimensions(preview.width, preview.height)} · 新上传` : "正在读取…"}
                onClick={() => {
                  if (preview) setActiveSheetKey(localFaceSheetKey(preview.sha256));
                }}
                src={preview?.src ?? null}
                width={preview?.width ?? 48}
              />
            );
          })}
          {faceSheets.map((sheet) => (
            <FaceSheetChoice
              active={effectiveActiveSheetKey === faceSheetKey(sheet)}
              currentLabel={portraitSourceLabel(sheet.blobSha256, credit, suggestion)}
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
            <div className="grid h-full min-h-28 place-items-center px-3 text-center text-sm text-muted">
              这个角色还没有脸图素材表
            </div>
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
                    const nextFiles = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    if (nextFiles.length) {
                      void onUpload(nextFiles).then((hashes) => {
                        if (hashes[0]) setActiveSheetKey(localFaceSheetKey(hashes[0]));
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
                  const next = previews.find((preview) => preview.file !== activeUpload.file);
                  setActiveSheetKey(next
                    ? localFaceSheetKey(next.sha256)
                    : faceSheets[0]
                      ? faceSheetKey(faceSheets[0])
                      : null);
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
              <span className="text-xs font-semibold text-red-700" role="alert">{portraitError}</span>
            ) : null}
          </footer>
        ) : null}
      </aside>

      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]" aria-label="选择头像坐标">
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <strong className="block truncate text-sm" title={activeName}>{activeName}</strong>
            {activeDimensions ? <span className="block text-xs text-muted">{activeDimensions}</span> : null}
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
              onSelectCell={(row, column) => onChooseUploaded(row, column, activeUpload.sha256)}
              scale={Math.min(2.5, 480 / Math.max(activeUpload.width, activeUpload.height))}
              selectedCell={selectedCell}
              src={activeUpload.src}
              width={activeUpload.width}
            />
          ) : activeLibrarySheet ? (
            <FaceSheetCanvas
              blobSha256={activeLibrarySheet.blobSha256}
              height={activeLibrarySheet.height}
              label={`在 ${faceSheetName(activeLibrarySheet)} 中选择本作头像`}
              onSelectCell={(row, column) => onChooseExisting(activeLibrarySheet, row, column)}
              scale={Math.min(2.5, 480 / Math.max(activeLibrarySheet.width, activeLibrarySheet.height))}
              selectedCell={selectedCell}
              width={activeLibrarySheet.width}
            />
          ) : (
            <span className="text-sm text-muted">
              {onUpload ? "请先上传脸图素材表" : "没有可选的脸图素材表"}
            </span>
          )}
        </div>

        <footer className="flex min-h-12 items-center border-t border-border px-3 py-2">
          <strong className="text-sm">
            {selectedCell
              ? `${credit.portrait ? "本作已选" : "角色默认"}：第 ${selectedCell.row + 1} 行，第 ${selectedCell.column + 1} 列`
              : "点击原图中的头像格子"}
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
        active ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-card",
      )}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <span className="grid size-[88px] place-items-center overflow-hidden border border-foreground/10 bg-muted/10">
        {src ? (
          <Image
            alt=""
            className="size-[88px] object-contain [image-rendering:pixelated]"
            height={height}
            src={src}
            unoptimized
            width={width}
          />
        ) : (
          <span className="text-xs text-muted">读取中</span>
        )}
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-sm" title={label}>{label}</strong>
        <span className="block truncate text-xs text-muted">{meta}</span>
        {currentLabel ? <span className="block text-xs font-semibold text-primary">{currentLabel}</span> : null}
      </span>
    </Button>
  );
}

function initialFaceSheetKey(
  credit: CharacterCreditSelection,
  suggestion: CharacterSuggestion | null,
): string | null {
  const effectivePortrait = credit.portrait ?? suggestion?.defaultPortrait ?? null;
  const selectedSheet = effectivePortrait
    ? suggestion?.faceSheets.find((sheet) => sheet.blobSha256 === effectivePortrait.blobSha256)
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
  return sheet.sourcePageTitle || sheet.sourceSectionTitle || `素材表 #${sheet.id}`;
}

function faceSheetDimensions(width: number, height: number): string {
  return `${width / 48} 列 × ${height / 48} 行`;
}

function faceSheetMeta(sheet: CharacterFaceSheet): string {
  const section = sheet.sourceSectionTitle && sheet.sourceSectionTitle !== sheet.sourcePageTitle
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
  return sheet ? {
    faceSheetId: sheet.id,
    blobSha256: sheet.blobSha256,
    width: sheet.width,
    height: sheet.height,
    row: credit.portrait.row,
    column: credit.portrait.column,
  } : null;
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
  const localFile = localIndex >= 0 ? files[localIndex] ?? null : null;
  if (localFile && credit.portrait) {
    return `新上传：${localFile.name} · 第 ${credit.portrait.row + 1} 行，第 ${credit.portrait.column + 1} 列`;
  }
  if (credit.portrait) return `本作指定：第 ${credit.portrait.row + 1} 行，第 ${credit.portrait.column + 1} 列`;
  if (suggestion?.defaultPortrait) return "沿用角色默认头像";
  if (files.length) return `已添加 ${files.length} 张素材表，尚未选择头像`;
  return "尚未选择头像";
}

function optionForSuggestion(
  suggestion: CharacterSuggestion,
  queryKey: string,
): ExistingOption | null {
  const match = characterNames(suggestion)
    .map((name) => ({ ...name, rank: matchRank(characterNameKey(name.name), queryKey) }))
    .filter((name) => name.rank < 3)
    .sort((left, right) => left.rank - right.rank || left.order - right.order)[0];
  if (!match) return null;
  const displayName = match.language === "zh" ? match.name : suggestion.primaryName;
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
    ...suggestion.aliases.map((alias, index) => ({ ...alias, order: index + 2 })),
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
  const preview = previews.find(
    (item) => item.sha256 === credit.portrait?.blobSha256,
  ) ?? null;
  const localPortrait = preview && credit.portrait?.blobSha256 === preview.sha256
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
      className="size-12 rounded-md text-base"
      displayName={selection.displayName}
      portrait={localPortrait}
      previewSrc={preview?.src ?? null}
      size={48}
      toneKey={selection.kind === "existing" ? selection.characterId : selection.originalName}
    />
  );
}

function useLocalFaceSheets(files: File[]): Array<ReturnType<typeof localFaceSheetPreview>> {
  const [previews, setPreviews] = useState<Array<ReturnType<typeof localFaceSheetPreview>>>([]);
  useEffect(() => {
    let active = true;
    const pending = files.map((file) => ({ file, src: URL.createObjectURL(file) }));
    void Promise.all(
      pending.map(async ({ file, src }) =>
        localFaceSheetPreview(file, src, await inspectCharacterFaceSheetFile(file))),
    ).then((nextPreviews) => {
      if (active) setPreviews(nextPreviews);
    }).catch(() => {
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
    const detail = error instanceof Error ? error.message : "无法读取脸图素材表。";
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
