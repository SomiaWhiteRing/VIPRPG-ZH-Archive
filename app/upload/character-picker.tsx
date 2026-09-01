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
  CharacterNameLanguage,
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
  meta: string;
  portraitBlobSha256: string | null;
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
  onChange: (values: CharacterSelection[]) => void;
  onPortraitFileChange?: (selection: CharacterSelection, file: File | null) => void;
  portraitFiles?: Record<string, File>;
  suggestions: CharacterSuggestion[];
  values: CharacterSelection[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createQuery, setCreateQuery] = useState("");
  const [newOriginalName, setNewOriginalName] = useState("");
  const [newChineseName, setNewChineseName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [portraitErrors, setPortraitErrors] = useState<Record<string, string>>({});
  const selectedKeys = useMemo(
    () => new Set(values.map(characterSelectionKey)),
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
  const missingPortraits = values.filter(
    (value) => !value.portraitBlobSha256,
  );
  const menuId = `${id}-options`;

  function addExisting(selection: Extract<CharacterSelection, { kind: "existing" }>) {
    if (selectedKeys.has(`existing:${selection.characterId}`)) return;
    onChange([...values, selection]);
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  function remove(selection: CharacterSelection) {
    const key = characterSelectionKey(selection);
    onChange(values.filter((item) => characterSelectionKey(item) !== key));
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
    const selection: CharacterSelection = {
      kind: "new",
      originalName,
      displayName,
      portraitBlobSha256: null,
    };
    if (selectedKeys.has(characterSelectionKey(selection))) {
      setCreateError("这个日语名已经加入本次上传。");
      return;
    }
    onChange([...values, selection]);
    setQuery("");
    setActiveIndex(0);
    setCreateOpen(false);
  }

  async function choosePortrait(
    selection: CharacterSelection,
    file: File | null,
  ) {
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
    <>
      <div className={cn("grid gap-2", disabled && "opacity-60")} onBlur={onBlur}>
        {name ? (
          <input name={name} readOnly type="hidden" value={JSON.stringify(values)} />
        ) : null}
        <div className="relative">
          <div
            className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
            onClick={() => document.getElementById(id)?.focus()}
          >
            {values.map((value) => (
              <span
                className="inline-flex min-h-7 items-center gap-1 rounded-full bg-primary/10 px-2.5 text-xs font-semibold text-primary"
                key={characterSelectionKey(value)}
              >
                <CharacterPortrait
                  className="size-5 rounded-sm text-[10px]"
                  displayName={value.displayName}
                  portraitBlobSha256={value.portraitBlobSha256}
                  size={20}
                  toneKey={value.kind === "existing" ? value.characterId : value.originalName}
                />
                {characterSelectionLabel(value)}
                {value.kind === "new" ? (
                  <span className="font-normal text-muted">待提交</span>
                ) : null}
                <Button
                  aria-label={`移除 ${characterSelectionLabel(value)}`}
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
              aria-activedescendant={
                open && options[activeIndex] ? `${menuId}-${activeIndex}` : undefined
              }
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
              placeholder={values.length ? "继续输入日语原名" : "先输入角色日语原名"}
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
                  key={
                    option.kind === "create"
                      ? `create:${characterNameKey(option.query)}`
                      : `existing:${option.selection.characterId}`
                  }
                  onClick={() => {
                    if (option.kind === "create") startCreate(option.query);
                    else addExisting(option.selection);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  role="option"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {option.kind === "create" ? (
                    <>
                      <span>新增角色名称“{option.query}”…</span>
                      <span className="shrink-0 text-xs text-muted">填写双语名称</span>
                    </>
                  ) : (
                    <>
                      <span className="flex min-w-0 items-center gap-2">
                        <CharacterPortrait
                          className="size-9 rounded-md text-sm"
                          displayName={option.selection.displayName}
                          portraitBlobSha256={option.portraitBlobSha256}
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>已选 {values.length} 项</span>
          <span>按日语原名查找角色</span>
        </div>
        {recommended.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted">常用角色</span>
            {recommended.map((item) => (
              <Button
                className="min-h-7 rounded-full border-dashed px-2.5 text-xs font-normal text-muted hover:border-primary hover:text-primary"
                disabled={disabled}
                key={item.id}
                onClick={() =>
                  addExisting({
                    kind: "existing",
                    characterId: item.id,
                    originalName: item.originalName,
                    displayName: item.primaryName,
                    portraitBlobSha256: item.portraitBlobSha256,
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <CharacterPortrait
                  className="size-6 rounded-sm text-[11px]"
                  displayName={item.primaryName}
                  portraitBlobSha256={item.portraitBlobSha256}
                  size={24}
                  toneKey={item.id}
                />
                {item.originalName} · {item.primaryName}
              </Button>
            ))}
          </div>
        ) : null}
        {onPortraitFileChange && missingPortraits.length ? (
          <div aria-label="待补角色头像" className="grid gap-2 border-t border-border pt-3">
            {missingPortraits.map((selection) => {
              const key = characterSelectionKey(selection);
              const file = portraitFiles[key] ?? null;
              const inputId = `${id}-portrait-${safeId(key)}`;
              return (
                <div
                  className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-muted/10 p-2.5"
                  key={key}
                >
                  <LocalPortraitPreview file={file} selection={selection} />
                  <div className="min-w-0">
                    <strong className="block truncate text-sm">
                      {characterSelectionLabel(selection)}
                    </strong>
                    <span className="block truncate text-xs text-muted">
                      {file?.name ?? "该角色还没有头像"}
                    </span>
                    {portraitErrors[key] ? (
                      <span className="mt-1 block text-xs text-red-700" role="alert">
                        {portraitErrors[key]}
                      </span>
                    ) : null}
                  </div>
                  <Label
                    className={cn(
                      buttonVariants({ size: "sm", variant: "outline" }),
                      "cursor-pointer",
                    )}
                    htmlFor={inputId}
                  >
                    {file ? "更换头像" : "上传头像"}
                    <input
                      accept="image/png"
                      className="sr-only"
                      disabled={disabled}
                      id={inputId}
                      onChange={(event) =>
                        void choosePortrait(selection, event.currentTarget.files?.[0] ?? null)
                      }
                      required={!file}
                      type="file"
                    />
                  </Label>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <Dialog.Root
        open={createOpen}
        onOpenChange={(nextOpen) => {
          setCreateOpen(nextOpen);
          if (!nextOpen) setCreateError(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <Dialog.Content
            aria-describedby="character-create-description"
            className="fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100vh-2rem)] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-surface"
          >
            <Dialog.Title className="m-0 text-lg font-bold">添加角色名称</Dialog.Title>
            <Dialog.Description
              className="m-0 text-sm leading-6 text-muted"
              id="character-create-description"
            >
              未找到“{createQuery}”。若日语名已存在，中文名会成为该角色的别名；否则随游戏创建新角色。
            </Dialog.Description>
            <form className="grid gap-4" onSubmit={submitCreate}>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-new-original`}>日语名</Label>
                <Input
                  autoFocus
                  id={`${id}-new-original`}
                  onChange={(event) => {
                    setNewOriginalName(event.target.value);
                    setCreateError(null);
                  }}
                  required
                  value={newOriginalName}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-new-chinese`}>中文名</Label>
                <Input
                  id={`${id}-new-chinese`}
                  onChange={(event) => {
                    setNewChineseName(event.target.value);
                    setCreateError(null);
                  }}
                  required
                  value={newChineseName}
                />
              </div>
              {createError ? (
                <p className="m-0 text-sm text-red-700" role="alert">
                  {createError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">取消</Button>
                </Dialog.Close>
                <Button type="submit">加入本次上传</Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
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
      portraitBlobSha256: suggestion.portraitBlobSha256,
    },
    meta: `${suggestion.workCount} 部作品`,
    portraitBlobSha256: suggestion.portraitBlobSha256,
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
  selection,
}: {
  file: File | null;
  selection: CharacterSelection;
}) {
  const [preview, setPreview] = useState<{ file: File; src: string } | null>(null);
  useEffect(() => {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        if (typeof reader.result === "string") {
          setPreview({ file, src: reader.result });
        }
      },
      { once: true },
    );
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);

  const src = preview?.file === file ? preview.src : null;

  if (src) {
    return (
      <CharacterPortrait
        className="size-12 rounded-md text-base"
        displayName={selection.displayName}
        previewSrc={src}
        size={48}
        toneKey={selection.kind === "existing" ? selection.characterId : selection.originalName}
      />
    );
  }
  return (
    <CharacterPortrait
      className="size-12 rounded-md text-base"
      displayName={selection.displayName}
      size={48}
      toneKey={selection.kind === "existing" ? selection.characterId : selection.originalName}
    />
  );
}

async function assertPortraitFile(file: File): Promise<void> {
  if (file.type.toLowerCase() !== "image/png") {
    throw new Error("角色头像只支持 PNG 文件。");
  }
  if (file.size <= 0 || file.size > 256 * 1024) {
    throw new Error("角色头像不能超过 256 KiB。");
  }
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

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, "-");
}
