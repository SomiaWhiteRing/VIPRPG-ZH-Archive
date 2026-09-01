"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
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
const EMPTY_PORTRAIT_FILES: Record<string, File> = {};

export function CharacterPicker({
  disabled = false,
  id,
  name,
  onChange,
  onPortraitFileChange,
  portraitFiles = EMPTY_PORTRAIT_FILES,
  suggestions,
  values,
}: {
  disabled?: boolean;
  id: string;
  name?: string;
  onChange: (values: CharacterCreditSelection[]) => void;
  onPortraitFileChange?: (selection: CharacterSelection, file: File | null) => void;
  portraitFiles?: Record<string, File>;
  suggestions: CharacterSuggestion[];
  values: CharacterCreditSelection[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createQuery, setCreateQuery] = useState("");
  const [newOriginalName, setNewOriginalName] = useState("");
  const [newChineseName, setNewChineseName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [portraitKey, setPortraitKey] = useState<string | null>(null);
  const [portraitErrors, setPortraitErrors] = useState<Record<string, string>>({});
  const suggestionsById = useMemo(
    () => new Map(suggestions.map((suggestion) => [suggestion.id, suggestion])),
    [suggestions],
  );
  const selectedKeys = useMemo(
    () => new Set(values.map((credit) => characterSelectionKey(credit.selection))),
    [values],
  );
  const options = useMemo<CharacterOption[]>(() => {
    const queryKey = characterNameKey(query);
    if (!queryKey) return [];
    const matches = suggestions
      .filter((suggestion) => !selectedKeys.has(`existing:${suggestion.id}`))
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
  }, [query, selectedKeys, suggestions]);
  const recommended = suggestions
    .filter((item) => !selectedKeys.has(`existing:${item.id}`))
    .slice(0, 6);
  const activeCredit = portraitKey
    ? values.find((credit) => characterSelectionKey(credit.selection) === portraitKey) ?? null
    : null;
  const activeSuggestion = activeCredit?.selection.kind === "existing"
    ? suggestionsById.get(activeCredit.selection.characterId) ?? null
    : null;
  const menuId = `${id}-options`;

  function addExisting(selection: Extract<CharacterSelection, { kind: "existing" }>) {
    if (selectedKeys.has(`existing:${selection.characterId}`)) return;
    onChange([...values, { selection, portrait: null }]);
    setQuery("");
    setActiveIndex(0);
    setOpen(false);
  }

  function remove(selection: CharacterSelection) {
    const key = characterSelectionKey(selection);
    onPortraitFileChange?.(selection, null);
    onChange(values.filter((item) => characterSelectionKey(item.selection) !== key));
  }

  function updatePortrait(
    credit: CharacterCreditSelection,
    portrait: CharacterCreditSelection["portrait"],
  ) {
    const key = characterSelectionKey(credit.selection);
    onPortraitFileChange?.(credit.selection, null);
    onChange(
      values.map((item) =>
        characterSelectionKey(item.selection) === key ? { ...item, portrait } : item,
      ),
    );
  }

  function startCreate(rawQuery: string) {
    const originalName = normalizeEntityName(rawQuery);
    setCreateQuery(originalName);
    setNewOriginalName(originalName);
    setNewChineseName("");
    setCreateError(null);
    setOpen(false);
    setCreateOpen(true);
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const originalName = normalizeEntityName(newOriginalName);
    const displayName = normalizeEntityName(newChineseName);
    if (!originalName || !displayName) {
      setCreateError("请填写日语名和中文名。");
      return;
    }
    const selection: CharacterSelection = { kind: "new", originalName, displayName };
    if (selectedKeys.has(characterSelectionKey(selection))) {
      setCreateError("这个日语名已经加入本次上传。");
      return;
    }
    onChange([...values, { selection, portrait: null }]);
    setQuery("");
    setActiveIndex(0);
    setCreateOpen(false);
    setPortraitKey(characterSelectionKey(selection));
  }

  async function choosePortraitFile(selection: CharacterSelection, file: File | null) {
    if (!onPortraitFileChange) return;
    const key = characterSelectionKey(selection);
    if (!file) {
      onPortraitFileChange(selection, null);
      setPortraitErrors((current) => omitKey(current, key));
      return;
    }
    try {
      await assertPortraitFile(file);
      onPortraitFileChange(selection, file);
      onChange(
        values.map((item) =>
          characterSelectionKey(item.selection) === key
            ? { ...item, portrait: null }
            : item,
        ),
      );
      setPortraitErrors((current) => omitKey(current, key));
    } catch (error) {
      onPortraitFileChange(selection, null);
      setPortraitErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "无法读取角色头像。",
      }));
    }
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
            {values.map((credit) => {
              const selection = credit.selection;
              const key = characterSelectionKey(selection);
              const suggestion = selection.kind === "existing"
                ? suggestionsById.get(selection.characterId) ?? null
                : null;
              const file = portraitFiles[key] ?? null;
              const portrait = resolvePortrait(credit, suggestion);
              return (
                <div
                  className="grid grid-cols-[48px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border border-border bg-card p-2.5"
                  key={key}
                >
                  <LocalPortraitPreview file={file} portrait={portrait} selection={selection} />
                  <div className="min-w-0">
                    <strong className="block truncate text-sm">{characterSelectionLabel(selection)}</strong>
                    <span className={cn("block truncate text-xs", hasPortrait(credit, suggestion, file) ? "text-muted" : "text-red-700")}>
                      {portraitStatus(credit, suggestion, file)}
                    </span>
                  </div>
                  <Button disabled={disabled} onClick={() => setPortraitKey(key)} size="sm" type="button" variant="outline">
                    选择头像
                  </Button>
                  <Button
                    aria-label={`移除 ${characterSelectionLabel(selection)}`}
                    disabled={disabled}
                    onClick={() => remove(selection)}
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
          <span>已选 {values.length} 个角色</span>
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

      <Dialog.Root open={Boolean(activeCredit)} onOpenChange={(nextOpen) => !nextOpen && setPortraitKey(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100vh-2rem)] w-[min(94vw,64rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-surface">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="m-0 text-lg font-bold">选择本作头像</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-6 text-muted">
                  {activeCredit ? characterSelectionLabel(activeCredit.selection) : ""}。只记录素材表对象与格子坐标。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button aria-label="关闭头像选择" size="icon" type="button" variant="ghost"><X className="size-4" /></Button>
              </Dialog.Close>
            </div>
            {activeCredit ? (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="grid min-w-0 gap-5">
                  {activeSuggestion?.faceSheets.length ? activeSuggestion.faceSheets.map((sheet) => (
                    <FaceSheetCells
                      credit={activeCredit}
                      key={sheet.id}
                      onChoose={(row, column) => updatePortrait(activeCredit, { blobSha256: sheet.blobSha256, row, column })}
                      sheet={sheet}
                    />
                  )) : (
                    <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted">
                      这个角色还没有绑定脸图素材表。
                    </div>
                  )}
                </div>
                <aside className="grid content-start gap-3 rounded-md bg-muted/10 p-4">
                  <strong className="text-sm">选择方式</strong>
                  <Button
                    disabled={!activeSuggestion?.defaultPortrait}
                    onClick={() => updatePortrait(activeCredit, null)}
                    type="button"
                    variant="outline"
                  >
                    沿用角色默认头像
                  </Button>
                  {onPortraitFileChange ? (
                    <Label className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer")}>
                      上传新的 48×48 PNG
                      <input
                        accept="image/png"
                        className="sr-only"
                        onChange={(event) => void choosePortraitFile(activeCredit.selection, event.currentTarget.files?.[0] ?? null)}
                        type="file"
                      />
                    </Label>
                  ) : null}
                  {portraitFiles[characterSelectionKey(activeCredit.selection)] ? (
                    <p className="m-0 text-xs leading-5 text-muted">已选择上传文件；提交后会登记为新的单格脸图。</p>
                  ) : null}
                  {portraitErrors[characterSelectionKey(activeCredit.selection)] ? (
                    <p className="m-0 text-xs leading-5 text-red-700" role="alert">
                      {portraitErrors[characterSelectionKey(activeCredit.selection)]}
                    </p>
                  ) : null}
                </aside>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={createOpen} onOpenChange={(nextOpen) => {
        setCreateOpen(nextOpen);
        if (!nextOpen) setCreateError(null);
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100vh-2rem)] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-surface">
            <Dialog.Title className="m-0 text-lg font-bold">添加角色名称</Dialog.Title>
            <Dialog.Description className="m-0 text-sm leading-6 text-muted">
              未找到“{createQuery}”。若日语名已存在，中文名会成为该角色的别名；否则随作品创建新角色。
            </Dialog.Description>
            <form className="grid gap-4" onSubmit={submitCreate}>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-new-original`}>日语名</Label>
                <Input autoFocus id={`${id}-new-original`} onChange={(event) => {
                  setNewOriginalName(event.target.value);
                  setCreateError(null);
                }} required value={newOriginalName} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-new-chinese`}>中文名</Label>
                <Input id={`${id}-new-chinese`} onChange={(event) => {
                  setNewChineseName(event.target.value);
                  setCreateError(null);
                }} required value={newChineseName} />
              </div>
              {createError ? <p className="m-0 text-sm text-red-700" role="alert">{createError}</p> : null}
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild><Button type="button" variant="outline">取消</Button></Dialog.Close>
                <Button type="submit">加入本次上传</Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function FaceSheetCells({
  credit,
  onChoose,
  sheet,
}: {
  credit: CharacterCreditSelection;
  onChoose: (row: number, column: number) => void;
  sheet: CharacterFaceSheet;
}) {
  const rows = sheet.height / 48;
  const columns = sheet.width / 48;
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-sm">{sheet.sourceSectionTitle || sheet.sourcePageTitle || `素材表 #${sheet.id}`}</strong>
        <span className="text-xs text-muted">{columns} 列 × {rows} 行</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,56px)] gap-2">
        {Array.from({ length: rows * columns }, (_, index) => {
          const row = Math.floor(index / columns);
          const column = index % columns;
          const selected = credit.portrait?.blobSha256 === sheet.blobSha256 &&
            credit.portrait.row === row && credit.portrait.column === column;
          return (
            <Button
              aria-label={`第 ${row + 1} 行，第 ${column + 1} 列`}
              aria-pressed={selected}
              className={cn(
                "grid size-14 place-items-center rounded-md border bg-card transition-colors hover:border-primary",
                selected ? "border-primary ring-2 ring-primary/25" : "border-border",
              )}
              key={`${row}:${column}`}
              onClick={() => onChoose(row, column)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <CharacterPortrait
                displayName={credit.selection.displayName}
                portrait={{
                  faceSheetId: sheet.id,
                  blobSha256: sheet.blobSha256,
                  width: sheet.width,
                  height: sheet.height,
                  row,
                  column,
                }}
                size={48}
                toneKey={credit.selection.kind === "existing" ? credit.selection.characterId : credit.selection.originalName}
              />
            </Button>
          );
        })}
      </div>
    </section>
  );
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
  file: File | null,
): boolean {
  return Boolean(file || credit.portrait || suggestion?.defaultPortrait);
}

function portraitStatus(
  credit: CharacterCreditSelection,
  suggestion: CharacterSuggestion | null,
  file: File | null,
): string {
  if (file) return `新上传：${file.name}`;
  if (credit.portrait) return `本作指定：第 ${credit.portrait.row + 1} 行，第 ${credit.portrait.column + 1} 列`;
  if (suggestion?.defaultPortrait) return "沿用角色默认头像";
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
  file,
  portrait,
  selection,
}: {
  file: File | null;
  portrait: CharacterPortraitValue | null;
  selection: CharacterSelection;
}) {
  const [preview, setPreview] = useState<{ file: File; src: string } | null>(null);
  useEffect(() => {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") setPreview({ file, src: reader.result });
    }, { once: true });
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);
  return (
    <CharacterPortrait
      className="size-12 rounded-md text-base"
      displayName={selection.displayName}
      portrait={portrait}
      previewSrc={preview?.file === file ? preview.src : null}
      size={48}
      toneKey={selection.kind === "existing" ? selection.characterId : selection.originalName}
    />
  );
}

async function assertPortraitFile(file: File): Promise<void> {
  if (file.type.toLowerCase() !== "image/png") throw new Error("角色头像只支持 PNG 文件。");
  if (file.size <= 0 || file.size > 256 * 1024) throw new Error("角色头像不能超过 256 KiB。");
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error("无法读取角色头像，请选择有效的 PNG 文件。");
  }
  const valid = image.width === 48 && image.height === 48;
  image.close();
  if (!valid) throw new Error("角色头像尺寸必须精确为 48×48。");
}

function omitKey<T>(value: Record<string, T>, key: string): Record<string, T> {
  if (!(key in value)) return value;
  const next = { ...value };
  delete next[key];
  return next;
}
