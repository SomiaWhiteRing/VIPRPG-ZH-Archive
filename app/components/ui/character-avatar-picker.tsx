import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useSourceFacePages } from "@/app/components/emojis/source-pages";
import { EmojiSourcePicker } from "@/app/components/emojis/source-picker";
import type { CharacterPortrait as Portrait } from "@/lib/character-names";
import type { EmojiCharacter } from "@/lib/face-emojis";
import { cn } from "@/lib/ui/cn";
import { Button } from "./button";
import { CharacterPortrait } from "./character-portrait";
import * as Dialog from "./dialog";
import { FaceSheetGrid } from "./face-sheet-grid";
import { Rm2kButton } from "./rm2k-button";

export function CharacterAvatarPicker({
  disabled,
  shape,
  onSave,
}: {
  disabled: boolean;
  shape: "round" | "square";
  onSave: (portrait: Portrait) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [character, setCharacter] = useState<EmojiCharacter>();
  const [selected, setSelected] = useState<Portrait | null>(null);
  const scrollTop = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const { items, more, loading, error, loadPage, retryPage } = useSourceFacePages(
    character ? { kind: "character", character } : null,
    open,
  );

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
    setOpen(next);
    if (!next) setSelected(null);
  }

  async function save() {
    if (!selected || disabled) return;
    if (await onSave(selected)) {
      setOpen(false);
      setSelected(null);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          选择角色头像
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
              <Dialog.Title>选择角色头像</Dialog.Title>
              <Dialog.Description className="m-0 mt-1 text-sm text-muted">
                选择角色后，点击脸图中的头像。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="关闭角色头像选择" disabled={disabled}>
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </header>
          <div className="shrink-0 border-b border-border p-4">
            <EmojiSourcePicker
              character={character}
              label={character?.name ?? "选择角色"}
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
            {!character ? <p className="m-0 text-sm text-muted">搜索角色名称，或从分类中选择角色。</p> : null}
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
            {character && !loading && !error && !items.length ? <p className="text-sm text-muted">该角色暂无可用脸图。</p> : null}
            {loading && !items.length ? <p role="status" className="text-sm text-muted">正在加载角色脸图…</p> : null}
            {error ? (
              <div role="alert" className="flex items-center gap-3 text-sm">
                {error}
                <Button type="button" size="sm" variant="outline" disabled={disabled || loading} onClick={() => retryPage()}>重试</Button>
              </div>
            ) : null}
            {more && !error ? (
              <Button type="button" size="sm" variant="outline" className="mt-4" disabled={disabled || loading} onClick={() => void loadPage()}>
                {loading ? "正在加载…" : "加载更多"}
              </Button>
            ) : null}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex min-w-0 items-center gap-3" role="status" aria-live="polite">
              {selected ? (
                <>
                  <CharacterPortrait displayName={character?.name ?? "所选角色"} portrait={selected} size={64} className={cn("size-16", shape === "round" && "rounded-full")} />
                  <span className="text-sm">头像预览</span>
                  <CharacterPortrait displayName={character?.name ?? "所选角色"} portrait={selected} size={32} className={cn("size-8", shape === "round" && "rounded-full")} />
                </>
              ) : <span className="text-sm text-muted">请选择一个头像</span>}
            </div>
            <div className="ml-auto flex gap-2">
              <Rm2kButton type="button" disabled={disabled} onClick={() => changeOpen(false)}>取消</Rm2kButton>
              <Rm2kButton type="button" disabled={disabled || !selected} onClick={() => void save()}>{disabled ? "正在保存…" : "保存头像"}</Rm2kButton>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
