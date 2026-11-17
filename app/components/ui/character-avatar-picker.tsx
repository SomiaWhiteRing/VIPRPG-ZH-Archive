import { useMessages } from "@/lib/i18n/react";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useSourceFacePages } from "@/app/components/emojis/source-pages";
import { emojiRequest } from "@/app/components/emojis/client";
import { EmojiSourcePicker } from "@/app/components/emojis/source-picker";
import type { CharacterPortrait as Portrait } from "@/lib/character-names";
import type { EmojiCharacter } from "@/lib/face-emojis";
import { cn } from "@/lib/ui/cn";
import { Button } from "./button";
import { CharacterPortrait } from "./character-portrait";
import * as Dialog from "./dialog";
import { FaceSheetGrid } from "./face-sheet-grid";

export type CharacterAvatarSelection = Portrait & { character?: Pick<EmojiCharacter, "id" | "name" | "originalName"> };

export function CharacterAvatarPicker({
  disabled,
  shape,
  sourceEndpoint,
  initialPortrait,
  onSave,
}: {
  disabled: boolean;
  shape: "round" | "square";
  sourceEndpoint?: string;
  initialPortrait?: CharacterAvatarSelection | null;
  onSave: (portrait: CharacterAvatarSelection) => Promise<boolean>;
}) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const [character, setCharacter] = useState<EmojiCharacter>();
  const [selected, setSelected] = useState<Portrait | null>(null);
  const scrollTop = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const { items, more, loading, error, loadPage, retryPage } = useSourceFacePages(
    character ? { kind: "character", character } : null,
    open,
    sourceEndpoint,
  );

  useEffect(() => {
    if (!open || character || !initialPortrait || !sourceEndpoint) return;
    const request = new AbortController();
    const { faceSheetId, row, column } = initialPortrait;
    void emojiRequest<{ character: EmojiCharacter | null }>(
      `${sourceEndpoint}?op=character&faceSheetId=${faceSheetId}&row=${row}&column=${column}`,
      undefined,
      request.signal,
    ).then(result => {
      if (!request.signal.aborted && result.character) {
        setCharacter(current => current ?? result.character ?? undefined);
      }
    }).catch(() => { /* Manual character selection remains available. */ });
    return () => request.abort();
  }, [open, character, initialPortrait, sourceEndpoint]);

  function resetScroll() {
    scrollTop.current = 0;
    if (viewport.current) viewport.current.scrollTop = 0;
  }

  function chooseCharacter(next: EmojiCharacter) {
    if (next.id === character?.id) return;
    setCharacter(next);
    setSelected(null);
    resetScroll();
  }

  function changeOpen(next: boolean) {
    if (disabled) return;
    if (next && initialPortrait !== undefined) {
      setCharacter(initialPortrait?.character);
      setSelected(initialPortrait);
      resetScroll();
    }
    setOpen(next);
    if (!next) setSelected(null);
  }

  async function save() {
    if (!selected || disabled) return;
    if (await onSave({
      ...selected,
      character: character && { id: character.id, name: character.name, originalName: character.originalName },
    })) {
      setOpen(false);
      setSelected(null);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          {t("sea.avatar.title")}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          className="inset-x-0 bottom-0 flex h-[min(42rem,90dvh)] flex-col overflow-hidden rounded-t-lg sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(48rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg"
          onEscapeKeyDown={(event) => {
            if (disabled) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title>{t("sea.avatar.title")}</Dialog.Title>
              <Dialog.Description className="m-0 mt-1 text-sm text-muted">
                {t("sea.avatar.instructions")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t("sea.avatar.close")} disabled={disabled}>
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </header>
          <div className="shrink-0 border-b border-border p-4">
            <EmojiSourcePicker
              sourceEndpoint={sourceEndpoint}
              character={character}
              label={character?.name ?? t("sea.avatar.character")}
              disabled={disabled}
              onSelect={chooseCharacter}
            />
          </div>
          <div
            ref={(node) => {
              viewport.current = node;
              if (node) node.scrollTop = scrollTop.current;
            }}
            onScroll={(event) => {
              scrollTop.current = event.currentTarget.scrollTop;
            }}
            className="emoji-scroll-viewport min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
            aria-busy={loading}
          >
            {!character ? <p className="m-0 text-sm text-muted">{t("sea.avatar.search")}</p> : null}
            {items.length ? (
              <FaceSheetGrid
                sheets={items}
                className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                fillWidth
                disabled={disabled}
                onSelectCell={(sheet, row, column) => setSelected({ faceSheetId: sheet.id, blobSha256: sheet.blobSha256, width: sheet.width, height: sheet.height, row, column })}
                cellState={(sheet, row, column) => ({ selected: selected?.blobSha256 === sheet.blobSha256 && selected.row === row && selected.column === column })}
              />
            ) : null}
            {character && !loading && !error && !items.length ? <p className="text-sm text-muted">{t("upload.portrait.empty")}</p> : null}
            {loading && !items.length ? <p role="status" className="text-sm text-muted">{t("sea.avatar.loading")}</p> : null}
            {error ? (
              <div role="alert" className="flex items-center gap-3 text-sm">
                {error}
                <Button type="button" size="sm" variant="outline" disabled={disabled || loading} onClick={() => retryPage()}>{t("core.action.retry")}</Button>
              </div>
            ) : null}
            {more && !error ? (
              <Button type="button" size="sm" variant="outline" className="mt-4" disabled={disabled || loading} onClick={() => void loadPage()}>
                {loading ? t("admin.portraits.loading") : t("sea.avatar.more")}
              </Button>
            ) : null}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex min-w-0 items-center gap-3" role="status" aria-live="polite">
              {selected ? (
                <>
                  <CharacterPortrait displayName={character?.name ?? t("sea.avatar.selected")} portrait={selected} size={64} className={cn("size-16", shape === "round" && "rounded-full")} />
                  <span className="text-sm">{t("sea.avatar.preview")}</span>
                  <CharacterPortrait displayName={character?.name ?? t("sea.avatar.selected")} portrait={selected} size={32} className={cn("size-8", shape === "round" && "rounded-full")} />
                </>
              ) : <span className="text-sm text-muted">{t("sea.avatar.pick")}</span>}
            </div>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" disabled={disabled} onClick={() => changeOpen(false)}>{t("play.save.cancel")}</Button>
              <Button type="button" disabled={disabled || !selected} onClick={() => void save()}>{disabled ? t("upload.cover.processing") : t("sea.avatar.use")}</Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
